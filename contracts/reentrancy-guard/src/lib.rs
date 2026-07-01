#![no_std]

mod test;

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ReentrantCall = 1,
}

#[contract]
pub struct ReentrancyGuardContract;

#[contractimpl]
impl ReentrancyGuardContract {
    pub fn initialize(env: Env) {
        env.storage().instance().set(&symbol_short!("locked"), &false);
    }

    pub fn guarded_action(env: Env) -> Result<u64, Error> {
        Self::enter(&env)?;
        let result = Self::run_critical_section(&env);
        Self::exit(&env);
        result
    }

    pub fn reentrant_call(env: Env) -> Result<u64, Error> {
        Self::enter(&env)?;
        let result = Self::attempt_reentry(&env);
        Self::exit(&env);
        result
    }

    pub fn is_locked(env: Env) -> bool {
        env.storage().instance().get::<_, bool>(&symbol_short!("locked")).unwrap_or(false)
    }

    fn enter(env: &Env) -> Result<(), Error> {
        if env.storage().instance().get::<_, bool>(&symbol_short!("locked")).unwrap_or(false) {
            return Err(Error::ReentrantCall);
        }
        env.storage().instance().set(&symbol_short!("locked"), &true);
        Ok(())
    }

    fn exit(env: &Env) {
        env.storage().instance().set(&symbol_short!("locked"), &false);
    }

    fn run_critical_section(_env: &Env) -> Result<u64, Error> {
        Ok(42)
    }

    fn attempt_reentry(env: &Env) -> Result<u64, Error> {
        Self::run_nested_guarded_action(env)
    }

    fn run_nested_guarded_action(env: &Env) -> Result<u64, Error> {
        Self::enter(env)?;
        Self::exit(env);
        Ok(0)
    }
}
