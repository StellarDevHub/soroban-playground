#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

use crate::storage::{
    add_to_allowlist, get_admin, get_count, has_claimed, is_allowlisted, is_initialized,
    is_paused, load_campaign, mark_claimed, next_id, remove_from_allowlist, save_campaign,
    set_admin, set_paused,
};
use crate::types::{AirdropCampaign, AirdropStatus, Error};

#[contract]
pub struct TokenAirdrop;

#[contractimpl]
impl TokenAirdrop {
    // ── Admin setup ───────────────────────────────────────────────────────────

    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    /// Transfer admin role to a new address.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_admin(&env, &new_admin);
        Ok(())
    }

    // ── Emergency pause ───────────────────────────────────────────────────────

    /// Pause all claim operations (admin only).
    pub fn pause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        if is_paused(&env) {
            return Err(Error::Paused);
        }
        set_paused(&env, true);
        Ok(())
    }

    /// Resume claim operations (admin only).
    pub fn unpause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        if !is_paused(&env) {
            return Err(Error::NotPaused);
        }
        set_paused(&env, false);
        Ok(())
    }

    // ── Campaign management ───────────────────────────────────────────────────

    /// Create a new airdrop campaign.
    /// The caller must have approved `total_amount` tokens to this contract.
    pub fn create_campaign(
        env: Env,
        admin: Address,
        token: Address,
        amount_per_claim: i128,
        total_amount: i128,
        start_timestamp: u64,
        end_timestamp: u64,
        require_allowlist: bool,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        admin.require_auth();

        if amount_per_claim <= 0 || total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if end_timestamp <= start_timestamp {
            return Err(Error::InvalidTimestamp);
        }

        // Pull tokens from admin into this contract (checks-effects-interactions)
        let client = token::Client::new(&env, &token);
        client.transfer(&admin, &env.current_contract_address(), &total_amount);

        let id = next_id(&env);
        let campaign = AirdropCampaign {
            id,
            admin,
            token,
            amount_per_claim,
            total_amount,
            claimed_amount: 0,
            start_timestamp,
            end_timestamp,
            require_allowlist,
            status: AirdropStatus::Active,
            created_at: env.ledger().timestamp(),
        };
        save_campaign(&env, &campaign);
        Ok(id)
    }

    /// End a campaign early and return unclaimed tokens to the campaign admin.
    pub fn end_campaign(env: Env, campaign_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let mut campaign = load_campaign(&env, campaign_id)?;
        campaign.admin.require_auth();

        if campaign.status == AirdropStatus::Ended {
            return Err(Error::AirdropEnded);
        }

        let remaining = campaign.total_amount - campaign.claimed_amount;
        if remaining > 0 {
            let client = token::Client::new(&env, &campaign.token);
            client.transfer(&env.current_contract_address(), &campaign.admin, &remaining);
        }

        campaign.status = AirdropStatus::Ended;
        save_campaign(&env, &campaign);
        Ok(remaining)
    }

    // ── Allowlist management ──────────────────────────────────────────────────

    /// Add addresses to a campaign's allowlist (campaign admin only).
    pub fn add_to_allowlist(
        env: Env,
        campaign_id: u32,
        recipients: Vec<Address>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let campaign = load_campaign(&env, campaign_id)?;
        campaign.admin.require_auth();

        if recipients.is_empty() {
            return Err(Error::EmptyRecipients);
        }
        if recipients.len() > 200 {
            return Err(Error::TooManyRecipients);
        }

        for addr in recipients.iter() {
            add_to_allowlist(&env, campaign_id, &addr);
        }
        Ok(())
    }

    /// Remove an address from a campaign's allowlist (campaign admin only).
    pub fn remove_from_allowlist(
        env: Env,
        campaign_id: u32,
        addr: Address,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let campaign = load_campaign(&env, campaign_id)?;
        campaign.admin.require_auth();
        remove_from_allowlist(&env, campaign_id, &addr);
        Ok(())
    }

    // ── Claiming ──────────────────────────────────────────────────────────────

    /// Claim tokens from an airdrop campaign.
    pub fn claim(env: Env, campaign_id: u32, claimer: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        claimer.require_auth();

        let mut campaign = load_campaign(&env, campaign_id)?;

        if campaign.status == AirdropStatus::Ended {
            return Err(Error::AirdropEnded);
        }

        let now = env.ledger().timestamp();
        if now < campaign.start_timestamp {
            return Err(Error::AirdropNotStarted);
        }
        if now > campaign.end_timestamp {
            return Err(Error::AirdropExpired);
        }

        if campaign.require_allowlist && !is_allowlisted(&env, campaign_id, &claimer) {
            return Err(Error::NotEligible);
        }

        if has_claimed(&env, campaign_id, &claimer) {
            return Err(Error::AlreadyClaimed);
        }

        let remaining = campaign.total_amount - campaign.claimed_amount;
        if remaining < campaign.amount_per_claim {
            return Err(Error::InsufficientFunds);
        }

        // Effects before interactions (checks-effects-interactions pattern)
        mark_claimed(&env, campaign_id, &claimer);
        campaign.claimed_amount += campaign.amount_per_claim;
        save_campaign(&env, &campaign);

        // Interaction: transfer tokens
        let client = token::Client::new(&env, &campaign.token);
        client.transfer(
            &env.current_contract_address(),
            &claimer,
            &campaign.amount_per_claim,
        );

        Ok(campaign.amount_per_claim)
    }

    /// Batch distribute tokens to a list of recipients (admin push model).
    /// Useful for gas-efficient distribution without requiring each user to claim.
    pub fn batch_distribute(
        env: Env,
        campaign_id: u32,
        recipients: Vec<Address>,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;

        let mut campaign = load_campaign(&env, campaign_id)?;
        campaign.admin.require_auth();

        if campaign.status == AirdropStatus::Ended {
            return Err(Error::AirdropEnded);
        }
        if recipients.is_empty() {
            return Err(Error::EmptyRecipients);
        }
        if recipients.len() > 100 {
            return Err(Error::TooManyRecipients);
        }

        let now = env.ledger().timestamp();
        if now < campaign.start_timestamp {
            return Err(Error::AirdropNotStarted);
        }
        if now > campaign.end_timestamp {
            return Err(Error::AirdropExpired);
        }

        let client = token::Client::new(&env, &campaign.token);
        let mut distributed: i128 = 0;

        for recipient in recipients.iter() {
            if has_claimed(&env, campaign_id, &recipient) {
                continue; // skip already-claimed, don't fail the batch
            }
            let remaining = campaign.total_amount - campaign.claimed_amount;
            if remaining < campaign.amount_per_claim {
                break; // out of funds, stop distributing
            }
            mark_claimed(&env, campaign_id, &recipient);
            campaign.claimed_amount += campaign.amount_per_claim;
            distributed += campaign.amount_per_claim;
            client.transfer(
                &env.current_contract_address(),
                &recipient,
                &campaign.amount_per_claim,
            );
        }

        save_campaign(&env, &campaign);
        Ok(distributed)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_campaign(env: Env, campaign_id: u32) -> Result<AirdropCampaign, Error> {
        load_campaign(&env, campaign_id)
    }

    pub fn has_claimed(env: Env, campaign_id: u32, addr: Address) -> bool {
        has_claimed(&env, campaign_id, &addr)
    }

    pub fn is_eligible(env: Env, campaign_id: u32, addr: Address) -> Result<bool, Error> {
        let campaign = load_campaign(&env, campaign_id)?;
        if campaign.require_allowlist {
            Ok(is_allowlisted(&env, campaign_id, &addr))
        } else {
            Ok(true)
        }
    }

    pub fn campaign_count(env: Env) -> u32 {
        get_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::Paused);
    }
    Ok(())
}
