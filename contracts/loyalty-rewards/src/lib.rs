// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Loyalty Rewards Contract
//!
//! Decentralised loyalty-points system with:
//! - Multi-merchant registration and management
//! - Points earning per merchant purchase
//! - Cross-merchant redemption (any active merchant accepts points)
//! - Per-user analytics (total earned / redeemed)
//! - Admin pause / unpause (emergency circuit-breaker)
//! - Checks-effects-interactions pattern throughout

#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

use crate::storage::{
    get_admin, get_balance, get_merchant, get_merchant_count, get_user_stats, is_initialized,
    is_paused, set_admin, set_balance, set_merchant, set_merchant_count, set_paused,
    set_user_stats,
};
use crate::types::{EarnRecord, Error, Merchant, RedeemRecord, UserStats};

#[contract]
pub struct LoyaltyRewards;

#[contractimpl]
impl LoyaltyRewards {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_paused(&env, false);
        Ok(())
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    /// Pause all earn/redeem operations (emergency circuit-breaker).
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_paused(&env, true);
        env.events()
            .publish(("loyalty", "paused"), caller);
        Ok(())
    }

    /// Resume operations.
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_paused(&env, false);
        env.events()
            .publish(("loyalty", "unpaused"), caller);
        Ok(())
    }

    // ── Merchant management ───────────────────────────────────────────────────

    /// Register a new merchant. Returns the new merchant ID.
    pub fn register_merchant(
        env: Env,
        caller: Address,
        name: String,
    ) -> Result<u32, Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        if name.is_empty() {
            return Err(Error::InvalidAmount);
        }
        let id = get_merchant_count(&env) + 1;
        let merchant = Merchant {
            id,
            owner: caller.clone(),
            name: name.clone(),
            active: true,
            total_issued: 0,
            registered_at: env.ledger().timestamp(),
        };
        set_merchant(&env, &merchant);
        set_merchant_count(&env, id);
        env.events()
            .publish(("loyalty", "merchant_registered"), (id, caller, name));
        Ok(id)
    }

    /// Deactivate a merchant (admin only).
    pub fn deactivate_merchant(env: Env, caller: Address, merchant_id: u32) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        let mut merchant = get_merchant(&env, merchant_id)?;
        merchant.active = false;
        set_merchant(&env, &merchant);
        env.events()
            .publish(("loyalty", "merchant_deactivated"), merchant_id);
        Ok(())
    }

    // ── Points operations ─────────────────────────────────────────────────────

    /// Award points to a user for a purchase at `merchant_id`.
    /// Only the merchant owner (or admin) may call this.
    pub fn earn_points(
        env: Env,
        caller: Address,
        user: Address,
        merchant_id: u32,
        points: i128,
    ) -> Result<i128, Error> {
        if is_paused(&env) {
            return Err(Error::Paused);
        }
        if points <= 0 {
            return Err(Error::InvalidAmount);
        }
        caller.require_auth();

        let admin = get_admin(&env)?;
        let mut merchant = get_merchant(&env, merchant_id)?;
        if !merchant.active {
            return Err(Error::MerchantInactive);
        }
        // Only merchant owner or admin may issue points
        if caller != merchant.owner && caller != admin {
            return Err(Error::Unauthorized);
        }

        // Effects
        let new_balance = get_balance(&env, &user) + points;
        set_balance(&env, &user, new_balance);

        let mut stats = get_user_stats(&env, &user);
        stats.total_earned += points;
        stats.last_activity = env.ledger().timestamp();
        set_user_stats(&env, &user, &stats);

        merchant.total_issued += points;
        set_merchant(&env, &merchant);

        // Event
        let record = EarnRecord {
            user: user.clone(),
            merchant_id,
            points,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish(("loyalty", "points_earned"), record);

        Ok(new_balance)
    }

    /// Redeem points at any active merchant (cross-merchant redemption).
    pub fn redeem_points(
        env: Env,
        user: Address,
        merchant_id: u32,
        points: i128,
    ) -> Result<i128, Error> {
        if is_paused(&env) {
            return Err(Error::Paused);
        }
        if points <= 0 {
            return Err(Error::InvalidAmount);
        }
        user.require_auth();

        let merchant = get_merchant(&env, merchant_id)?;
        if !merchant.active {
            return Err(Error::MerchantInactive);
        }

        // Checks
        let balance = get_balance(&env, &user);
        if balance < points {
            return Err(Error::InsufficientPoints);
        }

        // Effects
        let new_balance = balance - points;
        set_balance(&env, &user, new_balance);

        let mut stats = get_user_stats(&env, &user);
        stats.total_redeemed += points;
        stats.last_activity = env.ledger().timestamp();
        set_user_stats(&env, &user, &stats);

        // Event
        let record = RedeemRecord {
            user: user.clone(),
            merchant_id,
            points,
            timestamp: env.ledger().timestamp(),
        };
        env.events().publish(("loyalty", "points_redeemed"), record);

        Ok(new_balance)
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_balance(env: Env, user: Address) -> i128 {
        get_balance(&env, &user)
    }

    pub fn get_user_stats(env: Env, user: Address) -> UserStats {
        get_user_stats(&env, &user)
    }

    pub fn get_merchant(env: Env, merchant_id: u32) -> Result<Merchant, Error> {
        get_merchant(&env, merchant_id)
    }

    pub fn merchant_count(env: Env) -> u32 {
        get_merchant_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, LoyaltyRewardsClient<'static>) {
        let env = Env::default();
        let contract_id = env.register_contract(None, LoyaltyRewards);
        let client = LoyaltyRewardsClient::new(&env, &contract_id);
        (env, client)
    }

    #[test]
    fn test_initialize() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin).unwrap();
        assert!(!client.is_paused());
    }

    #[test]
    fn test_double_initialize_fails() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin).unwrap();
        assert_eq!(client.initialize(&admin), Err(Error::AlreadyInitialized));
    }

    #[test]
    fn test_register_merchant() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin).unwrap();
        let id = client
            .register_merchant(&admin, &soroban_sdk::String::from_str(&env, "CoffeeShop"))
            .unwrap();
        assert_eq!(id, 1);
        assert_eq!(client.merchant_count(), 1);
    }

    #[test]
    fn test_earn_and_redeem() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin).unwrap();
        let mid = client
            .register_merchant(&admin, &soroban_sdk::String::from_str(&env, "Shop"))
            .unwrap();

        let bal = client.earn_points(&admin, &user, &mid, &100).unwrap();
        assert_eq!(bal, 100);
        assert_eq!(client.get_balance(&user), 100);

        let bal2 = client.redeem_points(&user, &mid, &40).unwrap();
        assert_eq!(bal2, 60);

        let stats = client.get_user_stats(&user);
        assert_eq!(stats.total_earned, 100);
        assert_eq!(stats.total_redeemed, 40);
    }

    #[test]
    fn test_insufficient_points() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin).unwrap();
        let mid = client
            .register_merchant(&admin, &soroban_sdk::String::from_str(&env, "Shop"))
            .unwrap();
        client.earn_points(&admin, &user, &mid, &10).unwrap();
        assert_eq!(
            client.redeem_points(&user, &mid, &50),
            Err(Error::InsufficientPoints)
        );
    }

    #[test]
    fn test_pause_blocks_operations() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin).unwrap();
        let mid = client
            .register_merchant(&admin, &soroban_sdk::String::from_str(&env, "Shop"))
            .unwrap();
        client.pause(&admin).unwrap();
        assert!(client.is_paused());
        assert_eq!(
            client.earn_points(&admin, &user, &mid, &10),
            Err(Error::Paused)
        );
        client.unpause(&admin).unwrap();
        assert!(!client.is_paused());
        client.earn_points(&admin, &user, &mid, &10).unwrap();
    }

    #[test]
    fn test_cross_merchant_redemption() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin).unwrap();
        let m1 = client
            .register_merchant(&admin, &soroban_sdk::String::from_str(&env, "MerchantA"))
            .unwrap();
        let m2 = client
            .register_merchant(&admin, &soroban_sdk::String::from_str(&env, "MerchantB"))
            .unwrap();

        // Earn at merchant 1
        client.earn_points(&admin, &user, &m1, &200).unwrap();
        // Redeem at merchant 2 (cross-merchant)
        let bal = client.redeem_points(&user, &m2, &150).unwrap();
        assert_eq!(bal, 50);
    }
}
