#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

const ADMIN: Symbol = symbol_short!("ADMIN");

#[contracttype]
pub enum DataKey {
    Allow(Address),
}

#[contract]
pub struct AllowlistContract;

#[contractimpl]
impl AllowlistContract {
    /// Initialize the contract with an admin user.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic!("already initialized");
        }
        env.storage().instance().set(&ADMIN, &admin);
    }

    /// Add a user to the allowlist. Only the admin is allowed to call this.
    pub fn add(env: Env, admin: Address, user: Address) {
        // 1. Get the current admin.
        let current_admin: Address = env.storage().instance().get(&ADMIN).expect("not initialized");

        // 2. Ensure the provided admin address matches the stored admin.
        if admin != current_admin {
            panic!("unauthorized");
        }

        // 3. Require authentication from the admin.
        admin.require_auth();

        // 4. Add the user to the allowlist in persistent storage.
        env.storage().persistent().set(&DataKey::Allow(user), &());
    }

    /// Remove a user from the allowlist. Only the admin is allowed to call this.
    pub fn remove(env: Env, admin: Address, user: Address) {
        // 1. Get the current admin.
        let current_admin: Address = env.storage().instance().get(&ADMIN).expect("not initialized");

        // 2. Ensure the provided admin address matches the stored admin.
        if admin != current_admin {
            panic!("unauthorized");
        }

        // 3. Require authentication from the admin.
        admin.require_auth();

        // 4. Remove the user from the allowlist.
        env.storage().persistent().remove(&DataKey::Allow(user));
    }

    /// Check if a user is in the allowlist.
    pub fn is_allowed(env: Env, user: Address) -> bool {
        env.storage().persistent().has(&DataKey::Allow(user))
    }

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN).expect("not initialized")
    }
}

mod test;
