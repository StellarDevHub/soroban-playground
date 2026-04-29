#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

use crate::storage::{
    add_burn_record, add_purchase_record, get_admin, get_config, get_stats, get_treasury_balance,
    is_initialized, next_record_id, set_admin, set_config, set_stats, set_treasury_balance,
};
use crate::types::{BurnRecord, BuybackConfig, BuybackStats, Error, PurchaseRecord};

#[contract]
pub struct TokenBuyback;

#[contractimpl]
impl TokenBuyback {
    /// Initialize the buyback program with an admin and configuration.
    pub fn initialize(
        env: Env,
        admin: Address,
        token_address: Address,
        buyback_bps: u32,
        min_buyback_amount: i128,
        max_buyback_amount: i128,
        frequency_seconds: u64,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        if buyback_bps == 0 || buyback_bps > 10_000 {
            return Err(Error::InvalidConfig);
        }
        if min_buyback_amount <= 0 || max_buyback_amount < min_buyback_amount {
            return Err(Error::InvalidConfig);
        }
        if frequency_seconds == 0 {
            return Err(Error::InvalidConfig);
        }

        set_admin(&env, &admin);

        let config = BuybackConfig {
            token_address,
            buyback_bps,
            min_buyback_amount,
            max_buyback_amount,
            frequency_seconds,
            paused: false,
        };
        set_config(&env, &config);

        let stats = BuybackStats {
            total_purchased: 0,
            total_burned: 0,
            total_revenue_used: 0,
            buyback_count: 0,
            last_buyback_timestamp: 0,
        };
        set_stats(&env, &stats);
        set_treasury_balance(&env, 0i128);

        env.events().publish(
            (soroban_sdk::symbol_short!("init"),),
            (admin,),
        );

        Ok(())
    }

    /// Deposit revenue into the treasury for future buybacks.
    pub fn deposit_revenue(
        env: Env,
        depositor: Address,
        payment_token: Address,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        depositor.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        let current = get_treasury_balance(&env);
        set_treasury_balance(&env, current + amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("deposit"),),
            (depositor, amount),
        );

        Ok(())
    }

    /// Execute a buyback: purchase tokens from the market and burn them.
    /// In production this would integrate with a DEX; here we simulate the purchase.
    pub fn execute_buyback(env: Env, caller: Address) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        caller.require_auth();

        let config = get_config(&env)?;
        if config.paused {
            return Err(Error::Paused);
        }

        let mut stats = get_stats(&env)?;
        let now = env.ledger().timestamp();

        // Enforce frequency schedule
        if stats.last_buyback_timestamp > 0
            && now < stats.last_buyback_timestamp + config.frequency_seconds
        {
            return Err(Error::TooEarly);
        }

        let treasury = get_treasury_balance(&env);
        if treasury <= 0 {
            return Err(Error::InsufficientTreasury);
        }

        // Calculate buyback amount from treasury using configured percentage
        let raw_amount = treasury * (config.buyback_bps as i128) / 10_000i128;
        let buyback_amount = raw_amount
            .max(config.min_buyback_amount)
            .min(config.max_buyback_amount)
            .min(treasury);

        if buyback_amount <= 0 {
            return Err(Error::InsufficientTreasury);
        }

        // Simulate market purchase with 0.5% slippage protection
        // tokens_received = buyback_amount * (1 - slippage) / price
        // For the playground we use a 1:1 ratio with 0.5% slippage
        let slippage_bps: i128 = 50; // 0.5%
        let tokens_received = buyback_amount * (10_000 - slippage_bps) / 10_000;

        // Deduct from treasury
        set_treasury_balance(&env, treasury - buyback_amount);

        // Record the purchase
        let record_id = next_record_id(&env);
        let purchase = PurchaseRecord {
            id: record_id,
            amount_spent: buyback_amount,
            tokens_received,
            timestamp: now,
            executor: caller.clone(),
        };
        add_purchase_record(&env, &purchase);

        // Burn the purchased tokens
        let burn_record = BurnRecord {
            id: record_id,
            tokens_burned: tokens_received,
            purchase_id: record_id,
            timestamp: now,
        };
        add_burn_record(&env, &burn_record);

        // Update stats
        stats.total_purchased += tokens_received;
        stats.total_burned += tokens_received;
        stats.total_revenue_used += buyback_amount;
        stats.buyback_count += 1;
        stats.last_buyback_timestamp = now;
        set_stats(&env, &stats);

        env.events().publish(
            (soroban_sdk::symbol_short!("buyback"),),
            (record_id, buyback_amount, tokens_received, now),
        );

        env.events().publish(
            (soroban_sdk::symbol_short!("burn"),),
            (record_id, tokens_received, now),
        );

        Ok(record_id)
    }

    /// Update buyback configuration (admin only).
    pub fn update_config(
        env: Env,
        admin: Address,
        buyback_bps: u32,
        min_buyback_amount: i128,
        max_buyback_amount: i128,
        frequency_seconds: u64,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let stored_admin = get_admin(&env)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }
        admin.require_auth();

        if buyback_bps == 0 || buyback_bps > 10_000 {
            return Err(Error::InvalidConfig);
        }
        if min_buyback_amount <= 0 || max_buyback_amount < min_buyback_amount {
            return Err(Error::InvalidConfig);
        }
        if frequency_seconds == 0 {
            return Err(Error::InvalidConfig);
        }

        let mut config = get_config(&env)?;
        config.buyback_bps = buyback_bps;
        config.min_buyback_amount = min_buyback_amount;
        config.max_buyback_amount = max_buyback_amount;
        config.frequency_seconds = frequency_seconds;
        set_config(&env, &config);

        env.events().publish(
            (soroban_sdk::symbol_short!("cfg_upd"),),
            (admin, buyback_bps),
        );

        Ok(())
    }

    /// Pause or unpause the buyback program (admin only).
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let stored_admin = get_admin(&env)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }
        admin.require_auth();

        let mut config = get_config(&env)?;
        config.paused = paused;
        set_config(&env, &config);

        env.events().publish(
            (soroban_sdk::symbol_short!("paused"),),
            (admin, paused),
        );

        Ok(())
    }

    /// Get current buyback statistics.
    pub fn get_stats(env: Env) -> Result<BuybackStats, Error> {
        ensure_initialized(&env)?;
        get_stats(&env)
    }

    /// Get current buyback configuration.
    pub fn get_config(env: Env) -> Result<BuybackConfig, Error> {
        ensure_initialized(&env)?;
        get_config(&env)
    }

    /// Get current treasury balance.
    pub fn get_treasury_balance(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_treasury_balance(&env))
    }

    /// Get recent purchase history (up to last 10).
    pub fn get_purchase_history(env: Env) -> Result<Vec<PurchaseRecord>, Error> {
        ensure_initialized(&env)?;
        Ok(storage::get_purchase_history(&env))
    }

    /// Get recent burn history (up to last 10).
    pub fn get_burn_history(env: Env) -> Result<Vec<BurnRecord>, Error> {
        ensure_initialized(&env)?;
        Ok(storage::get_burn_history(&env))
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}
