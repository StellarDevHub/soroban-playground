#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_shares, get_vault_count, get_vault_list, is_initialized, load_vault,
    next_vault_id, save_vault, set_admin, set_shares,
};
use crate::types::{Error, Vault, VaultStatus};

/// Majority threshold for buyout: 51% of shares.
const BUYOUT_THRESHOLD_BPS: i128 = 5100;

#[contract]
pub struct NftFractionalization;

#[contractimpl]
impl NftFractionalization {
    /// Initialize the protocol with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);

        env.events().publish(
            (soroban_sdk::symbol_short!("init"),),
            (admin,),
        );

        Ok(())
    }

    /// Deposit an NFT into a new vault and receive fractional share tokens.
    ///
    /// The depositor receives all `total_shares` initially. They can then
    /// transfer shares to other addresses via `transfer_shares`.
    pub fn create_vault(
        env: Env,
        depositor: Address,
        nft_contract: Address,
        nft_token_id: u64,
        metadata_hash: String,
        total_shares: i128,
        buyout_price: i128,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        depositor.require_auth();

        if total_shares <= 0 {
            return Err(Error::InvalidShares);
        }
        if buyout_price <= 0 {
            return Err(Error::InvalidBuyoutPrice);
        }

        // Transfer NFT into vault custody (1 unit = the NFT)
        let nft_client = token::Client::new(&env, &nft_contract);
        nft_client.transfer(&depositor, &env.current_contract_address(), &1);

        let vault_id = next_vault_id(&env);
        let now = env.ledger().timestamp();

        let vault = Vault {
            id: vault_id,
            depositor: depositor.clone(),
            nft_contract,
            nft_token_id,
            metadata_hash,
            total_shares,
            depositor_shares: total_shares,
            buyout_price,
            status: VaultStatus::Active,
            created_at: now,
            buyout_winner: None,
        };

        save_vault(&env, &vault);
        // Assign all shares to depositor
        set_shares(&env, vault_id, &depositor, total_shares);

        env.events().publish(
            (soroban_sdk::symbol_short!("vault_new"),),
            (vault_id, depositor, total_shares, buyout_price),
        );

        Ok(vault_id)
    }

    /// Transfer fractional shares from one holder to another.
    pub fn transfer_shares(
        env: Env,
        from: Address,
        to: Address,
        vault_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        from.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let vault = load_vault(&env, vault_id)?;
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        let from_shares = get_shares(&env, vault_id, &from);
        if from_shares < amount {
            return Err(Error::InsufficientShares);
        }

        set_shares(&env, vault_id, &from, from_shares - amount);
        let to_shares = get_shares(&env, vault_id, &to);
        set_shares(&env, vault_id, &to, to_shares + amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("sh_xfer"),),
            (vault_id, from, to, amount),
        );

        Ok(())
    }

    /// Initiate a buyout by paying the full buyout price.
    ///
    /// The caller must hold at least 51% of shares (majority) to trigger a buyout.
    /// Payment is distributed proportionally to all other share holders.
    /// The NFT is released to the caller.
    pub fn initiate_buyout(
        env: Env,
        buyer: Address,
        vault_id: u32,
        payment_token: Address,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        buyer.require_auth();

        let mut vault = load_vault(&env, vault_id)?;
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        let buyer_shares = get_shares(&env, vault_id, &buyer);
        let threshold = vault.total_shares * BUYOUT_THRESHOLD_BPS / 10_000;
        if buyer_shares < threshold {
            return Err(Error::BuyoutThresholdNotMet);
        }

        // Collect buyout payment from buyer
        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&buyer, &env.current_contract_address(), &vault.buyout_price);

        // Release NFT to buyer
        let nft_client = token::Client::new(&env, &vault.nft_contract);
        nft_client.transfer(&env.current_contract_address(), &buyer, &1);

        // Mark vault as redeemed
        vault.status = VaultStatus::Redeemed;
        vault.buyout_winner = Some(buyer.clone());
        save_vault(&env, &vault);

        env.events().publish(
            (soroban_sdk::symbol_short!("buyout"),),
            (vault_id, buyer, vault.buyout_price),
        );

        Ok(())
    }

    /// Redeem shares for a proportional payout after a successful buyout.
    ///
    /// Share holders call this to claim their portion of the buyout proceeds.
    pub fn redeem_shares(
        env: Env,
        holder: Address,
        vault_id: u32,
        payment_token: Address,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        holder.require_auth();

        let vault = load_vault(&env, vault_id)?;
        if vault.status != VaultStatus::Redeemed {
            return Err(Error::VaultNotActive);
        }

        let holder_shares = get_shares(&env, vault_id, &holder);
        if holder_shares <= 0 {
            return Err(Error::InsufficientShares);
        }

        // Payout = (holder_shares / total_shares) * buyout_price
        let payout = holder_shares * vault.buyout_price / vault.total_shares;

        // Zero out shares before transfer (checks-effects-interactions)
        set_shares(&env, vault_id, &holder, 0);

        if payout > 0 {
            let token_client = token::Client::new(&env, &payment_token);
            token_client.transfer(&env.current_contract_address(), &holder, &payout);
        }

        env.events().publish(
            (soroban_sdk::symbol_short!("redeem"),),
            (vault_id, holder, holder_shares, payout),
        );

        Ok(payout)
    }

    /// Get vault details.
    pub fn get_vault(env: Env, vault_id: u32) -> Result<Vault, Error> {
        ensure_initialized(&env)?;
        load_vault(&env, vault_id)
    }

    /// Get share balance for a holder in a vault.
    pub fn get_shares(env: Env, vault_id: u32, holder: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_shares(&env, vault_id, &holder))
    }

    /// Get total number of vaults created.
    pub fn get_vault_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_vault_count(&env))
    }

    /// Get list of recent vault IDs (up to 20).
    pub fn get_vault_list(env: Env) -> Result<Vec<u32>, Error> {
        ensure_initialized(&env)?;
        Ok(get_vault_list(&env))
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}
