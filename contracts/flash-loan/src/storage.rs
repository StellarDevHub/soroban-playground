use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    TotalLoans,
    TotalFees,
    Balance,
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

pub fn get_total_loans(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::TotalLoans).unwrap_or(0)
}

pub fn increment_loans(env: &Env) {
    let count = get_total_loans(env);
    env.storage().instance().set(&DataKey::TotalLoans, &(count + 1));
}

pub fn get_total_fees(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalFees).unwrap_or(0)
}

pub fn add_fees(env: &Env, amount: i128) {
    let total = get_total_fees(env);
    env.storage().instance().set(&DataKey::TotalFees, &(total + amount));
}

pub fn get_balance(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Balance).unwrap_or(0)
}

pub fn set_balance(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::Balance, &amount);
}
