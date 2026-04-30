#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use crate::storage::{
    get_admin, get_signer, get_signer_count, get_threshold, get_tx, get_tx_count, has_approved,
    has_signer, is_initialized, is_paused, record_approval, remove_signer, role_of, set_admin,
    set_paused, set_signer, set_signer_count, set_threshold, set_tx, set_tx_count,
};
use crate::types::{Error, Role, Signer, Transaction, TxStatus};

const TIMELOCK_SECS: u64 = 86_400; // 24 hours
const EXPIRY_SECS: u64 = 604_800; // 7 days

#[contract]
pub struct DaoTreasury;

#[contractimpl]
impl DaoTreasury {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, owner: Address, threshold: u32) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        owner.require_auth();
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        set_admin(&env, &owner);
        set_threshold(&env, threshold);

        set_signer(
            &env,
            &Signer {
                address: owner.clone(),
                role: Role::Owner,
            },
        );
        set_signer_count(&env, 1);
        Ok(())
    }

    // ── Pause / Unpause ───────────────────────────────────────────────────────

    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;
        set_paused(&env, true);
        env.events()
            .publish((soroban_sdk::symbol_short!("paused"),), caller);
        Ok(())
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;
        set_paused(&env, false);
        env.events()
            .publish((soroban_sdk::symbol_short!("unpaused"),), caller);
        Ok(())
    }

    // ── Deposits ──────────────────────────────────────────────────────────────

    /// Deposit tokens into the treasury. Anyone can deposit.
    pub fn deposit(env: Env, from: Address, token: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        from.require_auth();

        let client = token::Client::new(&env, &token);
        client.transfer(&from, &env.current_contract_address(), &amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("deposit"), token),
            (from, amount),
        );
        Ok(())
    }

    // ── Signer management ─────────────────────────────────────────────────────

    pub fn add_signer(
        env: Env,
        caller: Address,
        new_signer: Address,
        role: Role,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;

        if has_signer(&env, &new_signer) {
            return Err(Error::SignerAlreadyExists);
        }
        if role > role_of(&env, &caller)? {
            return Err(Error::Unauthorized);
        }
        set_signer(
            &env,
            &Signer {
                address: new_signer.clone(),
                role: role.clone(),
            },
        );
        set_signer_count(&env, get_signer_count(&env) + 1);

        env.events()
            .publish((soroban_sdk::symbol_short!("add_sgn"),), new_signer);
        Ok(())
    }

    pub fn remove_signer(env: Env, caller: Address, target: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Owner)?;

        if !has_signer(&env, &target) {
            return Err(Error::SignerNotFound);
        }
        let count = get_signer_count(&env);
        if count - 1 < get_threshold(&env) {
            return Err(Error::InvalidThreshold);
        }
        remove_signer(&env, &target);
        set_signer_count(&env, count - 1);

        env.events()
            .publish((soroban_sdk::symbol_short!("rm_sgn"),), target);
        Ok(())
    }

    pub fn change_threshold(env: Env, caller: Address, new_threshold: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Owner)?;

        if new_threshold == 0 || new_threshold > get_signer_count(&env) {
            return Err(Error::InvalidThreshold);
        }
        set_threshold(&env, new_threshold);
        Ok(())
    }

    // ── Transaction lifecycle ─────────────────────────────────────────────────

    pub fn propose(
        env: Env,
        proposer: Address,
        description: String,
        amount: i128,
        recipient: Option<Address>,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        proposer.require_auth();
        require_min_role(&env, &proposer, Role::Operator)?;

        if description.is_empty() {
            return Err(Error::EmptyDescription);
        }

        let now = env.ledger().timestamp();
        let id = get_tx_count(&env);
        let tx = Transaction {
            id,
            proposer: proposer.clone(),
            description,
            amount,
            recipient,
            status: TxStatus::Pending,
            approvals: 0,
            created_at: now,
            execute_after: now + TIMELOCK_SECS,
            expires_at: now + EXPIRY_SECS,
        };
        set_tx(&env, &tx);
        set_tx_count(&env, id + 1);

        env.events()
            .publish((soroban_sdk::symbol_short!("proposed"),), id);
        Ok(id)
    }

    pub fn approve(env: Env, signer: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        signer.require_auth();
        require_min_role(&env, &signer, Role::Operator)?;

        let mut tx = get_tx(&env, tx_id)?;
        let now = env.ledger().timestamp();

        if tx.status != TxStatus::Pending {
            return Err(Error::TransactionNotPending);
        }
        if now > tx.expires_at {
            tx.status = TxStatus::Expired;
            set_tx(&env, &tx);
            return Err(Error::TransactionExpired);
        }
        if has_approved(&env, tx_id, &signer) {
            return Err(Error::AlreadyApproved);
        }

        record_approval(&env, tx_id, &signer);
        tx.approvals += 1;

        if tx.approvals >= get_threshold(&env) {
            tx.status = TxStatus::Queued;
            env.events()
                .publish((soroban_sdk::symbol_short!("queued"),), tx_id);
        }
        set_tx(&env, &tx);
        Ok(())
    }

    pub fn execute(
        env: Env,
        caller: Address,
        tx_id: u32,
        token: Option<Address>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;

        let mut tx = get_tx(&env, tx_id)?;
        let now = env.ledger().timestamp();

        if tx.status != TxStatus::Queued {
            return Err(Error::TransactionNotQueued);
        }
        if now < tx.execute_after {
            return Err(Error::TimelockActive);
        }
        if now > tx.expires_at {
            tx.status = TxStatus::Expired;
            set_tx(&env, &tx);
            return Err(Error::TransactionExpired);
        }

        if let Some(recipient) = &tx.recipient {
            if let Some(token_addr) = token {
                let client = token::Client::new(&env, &token_addr);
                let balance = client.balance(&env.current_contract_address());
                if balance < tx.amount {
                    return Err(Error::InsufficientBalance);
                }
                client.transfer(&env.current_contract_address(), recipient, &tx.amount);
            }
        }

        tx.status = TxStatus::Executed;
        set_tx(&env, &tx);

        env.events()
            .publish((soroban_sdk::symbol_short!("executed"),), tx_id);
        Ok(())
    }

    pub fn cancel(env: Env, caller: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status != TxStatus::Pending && tx.status != TxStatus::Queued {
            return Err(Error::TransactionNotPending);
        }
        tx.status = TxStatus::Cancelled;
        set_tx(&env, &tx);

        env.events()
            .publish((soroban_sdk::symbol_short!("cancelled"),), tx_id);
        Ok(())
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn require_min_role(env: &Env, addr: &Address, min: Role) -> Result<(), Error> {
    if role_of(env, addr)? < min {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
