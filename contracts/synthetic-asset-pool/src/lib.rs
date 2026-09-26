#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Map};

#[contract]
pub struct SyntheticAssetPool;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    InsufficientCollateral = 3,
    DebtCeilingExceeded = 4,
    LiquidationTriggered = 5,
    InvalidAmount = 6,
    UnsafeRatio = 7,
}

#[contractimpl]
impl SyntheticAssetPool {
    /// Initialize the debt pool with collateral requirements
    pub fn initialize(
        env: Env,
        admin: Address,
        min_collateralization_ratio: u32,
        liquidation_threshold: u32,
    ) -> Result<(), Error> {
        admin.require_auth();

        if min_collateralization_ratio < 100 || liquidation_threshold < min_collateralization_ratio {
            return Err(Error::UnsafeRatio);
        }

        let key = symbol_short!("admin");
        env.storage().instance().set(&key, &admin);

        let min_key = symbol_short!("minCollatRat");
        env.storage().instance().set(&min_key, &min_collateralization_ratio);

        let liq_key = symbol_short!("liqThresh");
        env.storage().instance().set(&liq_key, &liquidation_threshold);

        let supply_key = symbol_short!("debtSupply");
        env.storage().instance().set(&supply_key, &0i128);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Mint synthetic assets backed by collateral
    pub fn mint_synthetic(
        env: Env,
        user: Address,
        collateral_amount: i128,
        synthetic_amount: i128,
    ) -> Result<(), Error> {
        user.require_auth();

        if collateral_amount <= 0 || synthetic_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Check collateralization ratio: (collateral * 100) >= (synthetic * min_ratio)
        let min_ratio: u32 = env.storage()
            .instance()
            .get(&symbol_short!("minCollatRat"))
            .unwrap_or(150);

        let ratio = (collateral_amount * 100) / synthetic_amount;
        if ratio < min_ratio as i128 {
            return Err(Error::InsufficientCollateral);
        }

        // Update debt supply
        let current_supply: i128 = env.storage()
            .instance()
            .get(&symbol_short!("debtSupply"))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&symbol_short!("debtSupply"), &(current_supply + synthetic_amount));

        // Track user collateral
        let collateral_key = (symbol_short!("collat"), user.clone());
        let user_collateral: i128 = env.storage()
            .instance()
            .get(&collateral_key)
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&collateral_key, &(user_collateral + collateral_amount));

        // Track user debt
        let debt_key = (symbol_short!("debt"), user.clone());
        let user_debt: i128 = env.storage()
            .instance()
            .get(&debt_key)
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&debt_key, &(user_debt + synthetic_amount));

        env.events().publish(
            (symbol_short!("mint"),),
            (user, collateral_amount, synthetic_amount),
        );

        Ok(())
    }

    /// Burn synthetic assets and recover collateral
    pub fn burn_synthetic(
        env: Env,
        user: Address,
        synthetic_amount: i128,
    ) -> Result<i128, Error> {
        user.require_auth();

        if synthetic_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Get user debt
        let debt_key = (symbol_short!("debt"), user.clone());
        let user_debt: i128 = env.storage()
            .instance()
            .get(&debt_key)
            .unwrap_or(0);

        if user_debt < synthetic_amount {
            return Err(Error::InvalidAmount);
        }

        // Proportional collateral recovery
        let collateral_key = (symbol_short!("collat"), user.clone());
        let user_collateral: i128 = env.storage()
            .instance()
            .get(&collateral_key)
            .unwrap_or(0);

        let recovered_collateral = (user_collateral * synthetic_amount) / user_debt;

        // Update state
        env.storage()
            .instance()
            .set(&debt_key, &(user_debt - synthetic_amount));

        env.storage()
            .instance()
            .set(&collateral_key, &(user_collateral - recovered_collateral));

        let current_supply: i128 = env.storage()
            .instance()
            .get(&symbol_short!("debtSupply"))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&symbol_short!("debtSupply"), &(current_supply - synthetic_amount));

        env.events().publish(
            (symbol_short!("burn"),),
            (user, synthetic_amount, recovered_collateral),
        );

        Ok(recovered_collateral)
    }

    /// Check if position needs liquidation
    pub fn check_liquidation(env: Env, user: Address) -> Result<bool, Error> {
        let liq_threshold: u32 = env.storage()
            .instance()
            .get(&symbol_short!("liqThresh"))
            .unwrap_or(200);

        let collateral_key = (symbol_short!("collat"), user.clone());
        let debt_key = (symbol_short!("debt"), user.clone());

        let user_collateral: i128 = env.storage()
            .instance()
            .get(&collateral_key)
            .unwrap_or(0);

        let user_debt: i128 = env.storage()
            .instance()
            .get(&debt_key)
            .unwrap_or(0);

        if user_debt == 0 {
            return Ok(false);
        }

        let ratio = (user_collateral * 100) / user_debt;
        Ok(ratio < liq_threshold as i128)
    }

    /// Liquidate undercollateralized position
    pub fn liquidate(env: Env, target_user: Address, liquidator: Address) -> Result<i128, Error> {
        liquidator.require_auth();

        let is_liquidatable = Self::check_liquidation(env.clone(), target_user.clone())?;
        if !is_liquidatable {
            return Err(Error::LiquidationTriggered);
        }

        let collateral_key = (symbol_short!("collat"), target_user.clone());
        let debt_key = (symbol_short!("debt"), target_user.clone());

        let collateral: i128 = env.storage()
            .instance()
            .get(&collateral_key)
            .unwrap_or(0);

        let debt: i128 = env.storage()
            .instance()
            .get(&debt_key)
            .unwrap_or(0);

        // Liquidation penalty: 10% of collateral goes to liquidator
        let liquidation_reward = (collateral * 10) / 100;
        let remaining_collateral = collateral - liquidation_reward;

        // Clear position
        env.storage().instance().set(&collateral_key, &0i128);
        env.storage().instance().set(&debt_key, &0i128);

        let current_supply: i128 = env.storage()
            .instance()
            .get(&symbol_short!("debtSupply"))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&symbol_short!("debtSupply"), &(current_supply - debt));

        env.events().publish(
            (symbol_short!("liquidated"),),
            (target_user, liquidator.clone(), liquidation_reward),
        );

        Ok(liquidation_reward)
    }

    /// Get user position
    pub fn get_position(env: Env, user: Address) -> Result<(i128, i128), Error> {
        let collateral: i128 = env.storage()
            .instance()
            .get(&(symbol_short!("collat"), user.clone()))
            .unwrap_or(0);

        let debt: i128 = env.storage()
            .instance()
            .get(&(symbol_short!("debt"), user))
            .unwrap_or(0);

        Ok((collateral, debt))
    }

    /// Get total debt pool
    pub fn get_total_debt(env: Env) -> Result<i128, Error> {
        Ok(env.storage()
            .instance()
            .get(&symbol_short!("debtSupply"))
            .unwrap_or(0))
    }
}
