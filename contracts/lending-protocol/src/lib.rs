#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env};
use crate::storage::{
    get_admin, get_position, get_total_borrowed, get_total_deposited, is_initialized,
    set_admin, set_initialized, set_position, set_total_borrowed, set_total_deposited,
};
use crate::types::{Error, PoolStats, UserPosition};

#[contract]
pub struct LendingProtocol;

#[contractimpl]
impl LendingProtocol {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_initialized(&env);
        Ok(())
    }

    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);
        pos.deposited += amount;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let total = get_total_deposited(&env);
        set_total_deposited(&env, total + amount);

        Ok(())
    }

    pub fn withdraw(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        let mut pos = get_position(&env, &user);
        if pos.deposited < amount {
            return Err(Error::InsufficientBalance);
        }

        // Check health factor (simplified: collateral > 1.5 * borrowed)
        if pos.borrowed > 0 && (pos.deposited - amount) * 100 < pos.borrowed * 150 {
            return Err(Error::InsufficientCollateral);
        }

        pos.deposited -= amount;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let total = get_total_deposited(&env);
        set_total_deposited(&env, total - amount);

        Ok(())
    }

    pub fn borrow(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        let mut pos = get_position(&env, &user);
        
        // Simplified health factor check
        if (pos.borrowed + amount) * 150 > pos.deposited * 100 {
            return Err(Error::InsufficientCollateral);
        }

        pos.borrowed += amount;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let total = get_total_borrowed(&env);
        set_total_borrowed(&env, total + amount);

        Ok(())
    }

    pub fn repay(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        let mut pos = get_position(&env, &user);
        let actual_repay = if amount > pos.borrowed { pos.borrowed } else { amount };

        pos.borrowed -= actual_repay;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let total = get_total_borrowed(&env);
        set_total_borrowed(&env, total - actual_repay);

        Ok(())
    }

    pub fn liquidate(env: Env, liquidator: Address, user: Address, amount: i128) -> Result<(), Error> {
        liquidator.require_auth();
        let mut pos = get_position(&env, &user);

        // Check if user is underwater (borrowed * 110 > deposited * 100)
        if pos.borrowed * 110 <= pos.deposited * 100 {
            return Err(Error::PositionNotUndercollateralized);
        }

        let actual_repay = if amount > pos.borrowed { pos.borrowed } else { amount };
        let collateral_to_seize = (actual_repay * 110) / 100; // 10% bonus

        pos.borrowed -= actual_repay;
        pos.deposited -= collateral_to_seize;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        // Update liquidator
        let mut liq_pos = get_position(&env, &liquidator);
        liq_pos.deposited += collateral_to_seize;
        set_position(&env, &liquidator, &liq_pos);

        let total_b = get_total_borrowed(&env);
        set_total_borrowed(&env, total_b - actual_repay);
        
        let total_d = get_total_deposited(&env);
        set_total_deposited(&env, total_d - collateral_to_seize);

        Ok(())
    }

    pub fn get_stats(env: Env) -> PoolStats {
        let total_d = get_total_deposited(&env);
        let total_b = get_total_borrowed(&env);
        let rate = if total_d > 0 { (total_b * 1000) / total_d } else { 0 };

        PoolStats {
            total_deposited: total_d,
            total_borrowed: total_b,
            interest_rate: rate,
        }
    }

    pub fn get_user_position(env: Env, user: Address) -> UserPosition {
        get_position(&env, &user)
    }
}
