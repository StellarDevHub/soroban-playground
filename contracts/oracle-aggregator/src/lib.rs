#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};
use storage::{
    add_reporter, get_admin, get_max_price_age, get_min_quorum, get_price, get_reporters,
    is_initialized, set_admin, set_max_price_age, set_min_quorum, store_price,
};
use types::{DataKey, Error, OraclePrice, Reporter};

#[contract]
pub struct OracleAggregator;

#[contractimpl]
impl OracleAggregator {
    pub fn initialize(
        env: Env,
        admin: Address,
        max_price_age: Option<u64>,
        min_quorum: Option<u32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);

        if let Some(age) = max_price_age {
            set_max_price_age(&env, age);
        }
        if let Some(quorum) = min_quorum {
            if quorum == 0 {
                return Err(Error::InvalidPrice);
            }
            set_min_quorum(&env, quorum);
        }

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn add_reporter(
        env: Env,
        admin: Address,
        reporter: Address,
        assets: Vec<String>,
    ) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if current_admin != admin {
            return Err(Error::Unauthorized);
        }

        if assets.is_empty() {
            return Err(Error::InvalidPrice);
        }

        add_reporter(&env, &reporter, assets.clone());
        env.events().publish((symbol_short!("addRep"),), (&reporter, &assets));
        Ok(())
    }

    pub fn submit_price(
        env: Env,
        reporter: Address,
        asset_id: String,
        price: i128,
        timestamp: u64,
    ) -> Result<(), Error> {
        reporter.require_auth();

        // Verify reporter is registered
        let reporters = get_reporters(&env);
        if !reporters.iter().any(|r| r == &reporter) {
            return Err(Error::ReporterNotFound);
        }

        // Validate price
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }

        if timestamp == 0 || timestamp > env.ledger().timestamp() {
            return Err(Error::InvalidPrice);
        }

        // Store submission (simplified—real implementation needs aggregation)
        env.events().publish(
            (symbol_short!("price"),),
            (&asset_id, price, reporter, timestamp),
        );

        Ok(())
    }

    pub fn get_price(env: Env, asset_id: String) -> Result<OraclePrice, Error> {
        let (median, deviation, age, count) = get_price(&env, &asset_id)?;

        let max_age = get_max_price_age(&env);
        if age > max_age {
            return Err(Error::StalePrice);
        }

        let quorum = get_min_quorum(&env);
        if count < quorum {
            return Err(Error::InsufficientReporters);
        }

        Ok(OraclePrice {
            asset_id,
            median,
            deviation,
            age_seconds: age,
            reporter_count: count,
        })
    }

    pub fn set_max_price_age(env: Env, admin: Address, max_age: u64) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if current_admin != admin {
            return Err(Error::Unauthorized);
        }

        set_max_price_age(&env, max_age);
        env.events().publish((symbol_short!("maxAge"),), max_age);
        Ok(())
    }

    pub fn set_min_quorum(env: Env, admin: Address, min_quorum: u32) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if current_admin != admin {
            return Err(Error::Unauthorized);
        }

        if min_quorum == 0 {
            return Err(Error::InvalidPrice);
        }

        set_min_quorum(&env, min_quorum);
        env.events().publish((symbol_short!("quorum"),), min_quorum);
        Ok(())
    }

    pub fn get_reporters(env: Env) -> Result<Vec<Address>, Error> {
        Ok(get_reporters(&env))
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_max_price_age(env: Env) -> Result<u64, Error> {
        Ok(get_max_price_age(&env))
    }

    pub fn get_min_quorum(env: Env) -> Result<u32, Error> {
        Ok(get_min_quorum(&env))
    }
}
