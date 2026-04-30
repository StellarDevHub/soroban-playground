use soroban_sdk::{Address, Env, Symbol};

use crate::types::{Credential, Error, Identity};

const ADMIN_KEY: &str = "admin";
const CRED_COUNT_KEY: &str = "cred_cnt";

fn identity_key(env: &Env, owner: &Address) -> Symbol {
    // Encode first 10 chars of address string as key prefix
    let s = owner.to_string();
    let short = if s.len() >= 10 { &s[..10] } else { &s };
    Symbol::new(env, &format!("id_{}", short))
}

fn credential_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &format!("cr_{}", id))
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&Symbol::new(env, ADMIN_KEY))
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&Symbol::new(env, ADMIN_KEY), admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, ADMIN_KEY))
        .ok_or(Error::NotInitialized)
}

pub fn save_identity(env: &Env, identity: &Identity) {
    env.storage()
        .persistent()
        .set(&identity_key(env, &identity.owner), identity);
}

pub fn load_identity(env: &Env, owner: &Address) -> Result<Identity, Error> {
    env.storage()
        .persistent()
        .get(&identity_key(env, owner))
        .ok_or(Error::IdentityNotFound)
}

pub fn has_identity(env: &Env, owner: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&identity_key(env, owner))
}

pub fn next_credential_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&Symbol::new(env, CRED_COUNT_KEY))
        .unwrap_or(0u32)
        + 1;
    env.storage()
        .instance()
        .set(&Symbol::new(env, CRED_COUNT_KEY), &id);
    id
}

pub fn credential_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, CRED_COUNT_KEY))
        .unwrap_or(0u32)
}

pub fn save_credential(env: &Env, cred: &Credential) {
    env.storage()
        .persistent()
        .set(&credential_key(env, cred.id), cred);
}

pub fn load_credential(env: &Env, id: u32) -> Result<Credential, Error> {
    env.storage()
        .persistent()
        .get(&credential_key(env, id))
        .ok_or(Error::CredentialNotFound)
}
