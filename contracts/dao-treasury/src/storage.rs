use crate::types::{DataKey, Role, Signer, Transaction};
use soroban_sdk::{Address, Env};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Result<Address, crate::types::Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(crate::types::Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Threshold)
        .unwrap_or(1)
}

pub fn set_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&DataKey::Threshold, &threshold);
}

pub fn get_signer_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SignerCount)
        .unwrap_or(0)
}

pub fn set_signer_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::SignerCount, &count);
}

pub fn has_signer(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Signer(addr.clone()))
}

pub fn get_signer(env: &Env, addr: &Address) -> Result<Signer, crate::types::Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Signer(addr.clone()))
        .ok_or(crate::types::Error::SignerNotFound)
}

pub fn set_signer(env: &Env, signer: &Signer) {
    env.storage()
        .persistent()
        .set(&DataKey::Signer(signer.address.clone()), signer);
}

pub fn remove_signer(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Signer(addr.clone()));
}

pub fn role_of(env: &Env, addr: &Address) -> Result<Role, crate::types::Error> {
    Ok(get_signer(env, addr)?.role)
}

pub fn get_tx_count(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::TxCount).unwrap_or(0)
}

pub fn set_tx_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::TxCount, &count);
}

pub fn get_tx(env: &Env, id: u32) -> Result<Transaction, crate::types::Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Tx(id))
        .ok_or(crate::types::Error::TransactionNotPending) // using this error as placeholder
}

pub fn set_tx(env: &Env, tx: &Transaction) {
    env.storage().persistent().set(&DataKey::Tx(tx.id), tx);
}

pub fn has_approved(env: &Env, tx_id: u32, signer: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Approval(tx_id, signer.clone()))
}

pub fn record_approval(env: &Env, tx_id: u32, signer: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Approval(tx_id, signer.clone()), &true);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::IsPaused, &paused);
}
