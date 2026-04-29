#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    ContractPaused = 4,
    RuleNotFound = 5,
    InsufficientBalance = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused,
    Rule(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rule {
    pub token: Address,
    pub min_balance: i128,
}

#[contract]
pub struct TokenGatedAccess;

#[contractimpl]
impl TokenGatedAccess {
    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Set or update a gating rule for a resource.
    pub fn set_rule(
        env: Env,
        resource: Symbol,
        token: Address,
        min_balance: i128,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let rule = Rule {
            token,
            min_balance,
        };
        env.storage().persistent().set(&DataKey::Rule(resource.clone()), &rule);

        env.events().publish(
            (symbol_short!("rule_upd"), resource),
            (rule.token, rule.min_balance),
        );

        Ok(())
    }

    /// Remove a gating rule.
    pub fn remove_rule(env: Env, resource: Symbol) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if !env.storage().persistent().has(&DataKey::Rule(resource.clone())) {
            return Err(Error::RuleNotFound);
        }

        env.storage().persistent().remove(&DataKey::Rule(resource.clone()));

        env.events().publish((symbol_short!("rule_rem"), resource), ());

        Ok(())
    }

    /// Check if a user has access to a resource.
    pub fn check_access(env: Env, user: Address, resource: Symbol) -> Result<bool, Error> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(Error::ContractPaused);
        }

        let rule: Rule = env
            .storage()
            .persistent()
            .get(&DataKey::Rule(resource.clone()))
            .ok_or(Error::RuleNotFound)?;

        // In a real scenario, we would call the token contract's balance_of function.
        // For this playground example, we'll assume a standard token interface.
        // We'll use a cross-contract call to check balance.
        
        let client = soroban_sdk::token::Client::new(&env, &rule.token);
        let balance = client.balance(&user);

        let allowed = balance >= rule.min_balance;

        env.events().publish(
            (symbol_short!("access"), resource, user),
            allowed,
        );

        Ok(allowed)
    }

    /// Pause or unpause the contract (Admin only).
    pub fn set_pause(env: Env, paused: bool) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish(symbol_short!("paused"), paused);

        Ok(())
    }

    /// Transfer admin rights (Admin only).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish(symbol_short!("adm_trf"), new_admin);

        Ok(())
    }

    /// Get current admin.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Get rule for a resource.
    pub fn get_rule(env: Env, resource: Symbol) -> Result<Rule, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Rule(resource))
            .ok_or(Error::RuleNotFound)
    }
}

mod test;
