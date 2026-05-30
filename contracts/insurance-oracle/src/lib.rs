#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

const ADMIN: symbol_short::Symbol = symbol_short!("ADMIN");
const VERIFICATION_THRESHOLD: symbol_short::Symbol = symbol_short!("THRESHOLD");
const CIRCUIT_BREAKER: symbol_short::Symbol = symbol_short!("BREAKER");
const MAX_SOURCES: u32 = 20;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidInput = 2,
    NotFound = 3,
    CapExceeded = 4,
    CircuitOpen = 5,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RiskData {
    pub source: Address,
    pub risk_type: String,
    pub value: i128,
    pub confidence: u32,
    pub timestamp: u64,
    pub metadata: String,
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.instance().get(&ADMIN).ok_or(Error::Unauthorized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.instance().set(&ADMIN, admin);
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !env.instance().has::<Address>(&ADMIN) {
        return Err(Error::NotFound);
    }
    Ok(())
}

fn get_sources(env: &Env) -> Vec<Address> {
    env.storage().persistent().get(&symbol_short!("SOURCES")).unwrap_or_else(|| Vec::new(env))
}

#[contract]
pub struct InsuranceOracle;

#[contractimpl]
impl InsuranceOracle {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.instance().has::<Address>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.instance().set(&VERIFICATION_THRESHOLD, &3u32);
        env.storage().persistent().set(&symbol_short!("SOURCES"), &Vec::<Address>::new(&env));
        env.instance().set(&CIRCUIT_BREAKER, &false);
        Ok(())
    }

    // ── Risk Data Management ────────────────────────────────────────────────────

    pub fn submit_risk_data(env: Env, data: RiskData) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sources = get_sources(&env);
        
        if !sources.contains(data.source) {
            return Err(Error::Unauthorized);
        }
        
        if data.confidence > 100 {
            return Err(Error::InvalidInput);
        }
        
        let breaker: bool = env.instance().get(&CIRCUIT_BREAKER).unwrap_or(false);
        if breaker {
            return Err(Error::CircuitOpen);
        }
        
        if data.risk_type.to_bytes().len() > 64 {
            return Err(Error::InvalidInput);
        }
        
        if data.metadata.to_bytes().len() > 256 {
            return Err(Error::InvalidInput);
        }
        
        let key: symbol_short::Symbol = symbol_short!("RD");
        let mut all_data: Vec<RiskData> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(&env));
        all_data.push_back(data.clone());
        env.storage().persistent().set(&key, &all_data);
        
        env.events().publish(
            (symbol_short!("RiskDataSubmitted"),),
            (&data.risk_type, &data.value),
        );
        
        Ok(())
    }

    pub fn get_risk_data(env: Env, _risk_type: String) -> Result<Vec<RiskData>, Error> {
        ensure_initialized(&env)?;
        let key: symbol_short::Symbol = symbol_short!("RD");
        Ok(env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(&env)))
    }

    pub fn get_historical_claims(env: Env, _risk_type: String, from: u64, to: u64) -> Result<Vec<RiskData>, Error> {
        ensure_initialized(&env)?;
        let key: symbol_short::Symbol = symbol_short!("RD");
        let all_data: Vec<RiskData> = env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(&env));
        let mut result: Vec<RiskData> = Vec::new(&env);
        for data in all_data.iter() {
            if data.timestamp >= from && data.timestamp <= to {
                result.push_back(data);
            }
        }
        Ok(result)
    }

    // ── Source Management ─────────────────────────────────────────────────────

    pub fn add_data_source(env: Env, admin: Address, source: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        
        let mut sources = get_sources(&env);
        if sources.contains(source) {
            return Ok(());
        }
        if sources.len() >= MAX_SOURCES {
            return Err(Error::CapExceeded);
        }
        
        sources.push_back(source);
        env.storage().persistent().set(&symbol_short!("SOURCES"), &sources);
        Ok(())
    }

    pub fn remove_data_source(env: Env, admin: Address, source: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        
        let mut sources = get_sources(&env);
        let mut found = false;
        let mut new_sources: Vec<Address> = Vec::new(&env);
        for s in sources.iter() {
            if s != source {
                new_sources.push_back(s);
            } else {
                found = true;
            }
        }
        if !found {
            return Err(Error::NotFound);
        }
        env.storage().persistent().set(&symbol_short!("SOURCES"), &new_sources);
        Ok(())
    }

    pub fn set_verification_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        
        if threshold < 1 || threshold > 20 {
            return Err(Error::InvalidInput);
        }
        
        env.instance().set(&VERIFICATION_THRESHOLD, &threshold);
        Ok(())
    }

    // ── Circuit Breaker ─────────────────────────────────────────────────────────

    pub fn activate_circuit_breaker(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        
        env.instance().set(&CIRCUIT_BREAKER, &true);
        env.events().publish((symbol_short!("CircuitBreakerActivated"),), &());
        Ok(())
    }

    pub fn deactivate_circuit_breaker(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }
        
        env.instance().set(&CIRCUIT_BREAKER, &false);
        env.events().publish((symbol_short!("CircuitBreakerDeactivated"),), &());
        Ok(())
    }

    // ── Read-only ───────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_threshold_fn(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(env.instance().get(&VERIFICATION_THRESHOLD).unwrap_or(3))
    }

    pub fn get_sources_fn(env: Env) -> Result<Vec<Address>, Error> {
        ensure_initialized(&env)?;
        Ok(get_sources(&env))
    }
}