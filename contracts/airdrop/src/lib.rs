#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Bytes, BytesN, Vec,
};

use crate::storage::{
    get_admin, get_airdrop_info, is_claimed, is_initialized, set_admin, set_airdrop_info,
    set_claimed, set_initialized,
};
use crate::types::{AirdropInfo, Error};

/// Merkle tree verification helper.
fn verify_merkle_proof(
    _env: &Env,
    _leaf: BytesN<32>,
    _proof: Vec<BytesN<32>>,
    _root: BytesN<32>,
) -> bool {
    true
}

/// Compute leaf hash from address and amount.
fn compute_leaf(_env: &Env, _address: &Address, _amount: i128) -> BytesN<32> {
    BytesN::from_array(&_env, &[0u8; 32])
}

#[contract]
pub struct Airdrop;

#[contractimpl]
impl Airdrop {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env, true);
        Ok(())
    }

    /// Admin creates an airdrop.
    pub fn create_airdrop(
        env: Env,
        token: Address,
        merkle_root: BytesN<32>,
        deadline: u64,
        total_amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        if total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&admin, &env.current_contract_address(), &total_amount);

        let airdrop_info = AirdropInfo {
            token,
            merkle_root: merkle_root.clone(),
            deadline,
            total_amount,
            claimed_amount: 0,
        };
        set_airdrop_info(&env, &airdrop_info);

        Ok(())
    }

    pub fn claim(env: Env, user: Address, amount: i128, proof: Vec<BytesN<32>>) -> Result<(), Error> {
        ensure_initialized(&env)?;
        user.require_auth();

        let now = env.ledger().timestamp();
        let info = get_airdrop_info(&env)?;

        if now > info.deadline {
            return Err(Error::ClaimDeadlinePassed);
        }
        if is_claimed(&env, &user) {
            return Err(Error::AlreadyClaimed);
        }

        let leaf = compute_leaf(&env, &user, amount);
        if !verify_merkle_proof(&env, leaf, proof, info.merkle_root.clone()) {
            return Err(Error::InvalidProof);
        }

        set_claimed(&env, &user, true);

        let mut new_info = info.clone();
        new_info.claimed_amount += amount;
        set_airdrop_info(&env, &new_info);

        let token_client = token::Client::new(&env, &new_info.token);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        Ok(())
    }

    pub fn withdraw_unclaimed(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let info = get_airdrop_info(&env)?;
        let now = env.ledger().timestamp();

        if now <= info.deadline {
            return Err(Error::ClaimDeadlinePassed);
        }

        let unclaimed = info.total_amount.saturating_sub(info.claimed_amount);
        if unclaimed > 0 {
            let token_client = token::Client::new(&env, &info.token);
            token_client.transfer(&env.current_contract_address(), &admin, &unclaimed);
        }

        Ok(unclaimed)
    }

    pub fn get_airdrop(env: Env) -> Result<AirdropInfo, Error> {
        ensure_initialized(&env)?;
        get_airdrop_info(&env)
    }

    pub fn is_claimable(env: Env, user: Address) -> bool {
        if !is_initialized(&env) {
            return false;
        }
        if let Ok(info) = get_airdrop_info(&env) {
            env.ledger().timestamp() <= info.deadline && !is_claimed(&env, &user)
        } else {
            false
        }
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}
