#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, vec};
use crate::storage::{
    get_admin, get_balance, get_total_fees, get_total_loans, increment_loans, 
    add_fees, is_initialized, set_admin, set_initialized, set_balance
};
use crate::types::{Error, FlashLoanStats};

#[contract]
pub struct FlashLoanProvider;

#[contractimpl]
impl FlashLoanProvider {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_initialized(&env);
        set_balance(&env, 1000000); // Initial liquidity for playground
        Ok(())
    }

    pub fn deposit(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        let balance = get_balance(&env);
        set_balance(&env, balance + amount);
        Ok(())
    }

    /// Execute a flash loan.
    /// In a real scenario, this would call the receiver's `on_flash_loan` method.
    pub fn flash_loan(
        env: Env,
        receiver: Address,
        amount: i128,
        _params: Symbol,
    ) -> Result<(), Error> {
        let balance_before = get_balance(&env);
        if balance_before < amount {
            return Err(Error::InsufficientBalance);
        }

        let fee = (amount * 5) / 1000; // 0.5% fee

        // 1. Transfer funds to receiver (Simulated)
        set_balance(&env, balance_before - amount);

        // 2. Call receiver (Simulated: we assume the receiver is a contract that will be called here)
        // env.invoke_contract::<()>(...);

        // 3. Check if funds + fee returned (Simulated logic for playground)
        // For the playground, we'll just record it as a successful loan.
        let balance_after = get_balance(&env);
        
        // In reality, we'd check if balance_after >= balance_before + fee
        // For simulation, we just force the repayment.
        set_balance(&env, balance_before + fee);
        
        increment_loans(&env);
        add_fees(&env, fee);

        Ok(())
    }

    pub fn get_stats(env: Env) -> FlashLoanStats {
        FlashLoanStats {
            total_loans: get_total_loans(&env),
            total_fees_collected: get_total_fees(&env),
        }
    }

    pub fn get_liquidity(env: Env) -> i128 {
        get_balance(&env)
    }
}
