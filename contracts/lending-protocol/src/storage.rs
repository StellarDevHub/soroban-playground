use soroban_sdk::{contracttype, Address, Env};
use crate::types::{UserPosition, PoolStats};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Position(Address),
    TotalDeposited,
    TotalBorrowed,
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_position(env: &Env, user: &Address) -> UserPosition {
    env.storage()
        .persistent()
        .get(&DataKey::Position(user.clone()))
        .unwrap_or(UserPosition {
            deposited: 0,
            borrowed: 0,
            last_updated: env.ledger().timestamp(),
        })
}

pub fn set_position(env: &Env, user: &Address, position: &UserPosition) {
    env.storage()
        .persistent()
        .set(&DataKey::Position(user.clone()), position);
}

pub fn get_total_deposited(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalDeposited).unwrap_or(0)
}

pub fn set_total_deposited(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalDeposited, &amount);
}

pub fn get_total_borrowed(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalBorrowed).unwrap_or(0)
}

pub fn set_total_borrowed(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalBorrowed, &amount);
}
