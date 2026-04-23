#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

const ADMIN: Symbol = symbol_short!("ADMIN");
const VALUE: Symbol = symbol_short!("VALUE");

#[contract]
pub struct AdminSetterContract;

#[contractimpl]
impl AdminSetterContract {
    /// Initialize the contract with an admin user.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic!("already initialized");
        }
        env.storage().instance().set(&ADMIN, &admin);
    }

    /// Update the value. Only the admin is allowed to call this.
    pub fn set_value(env: Env, admin: Address, value: u32) {
        // 1. Get the current admin.
        let current_admin: Address = env.storage().instance().get(&ADMIN).expect("not initialized");

        // 2. Ensure the provided admin address matches the stored admin.
        if admin != current_admin {
            panic!("unauthorized");
        }

        // 3. Require authentication from the admin.
        admin.require_auth();

        // 4. Update the value.
        env.storage().instance().set(&VALUE, &value);
    }

    /// Get the current value.
    pub fn get_value(env: Env) -> u32 {
        env.storage().instance().get(&VALUE).unwrap_or(0)
    }

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN).expect("not initialized")
    }
}

mod test;
