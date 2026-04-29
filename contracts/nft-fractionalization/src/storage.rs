use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::types::{Error, Vault};

const ADMIN_KEY: &str = "admin";
const VAULT_COUNT_KEY: &str = "v_count";
const MAX_VAULTS_LIST: u32 = 20;

fn vault_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &soroban_sdk::format!(env, "vault_{}", id))
}

fn shares_key(env: &Env, vault_id: u32, holder: &Address) -> soroban_sdk::Val {
    (soroban_sdk::symbol_short!("sh"), vault_id, holder.clone()).into_val(env)
}

fn vault_list_key(env: &Env) -> Symbol {
    Symbol::new(env, "vault_list")
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .has(&Symbol::new(env, ADMIN_KEY))
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, ADMIN_KEY), admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, ADMIN_KEY))
        .ok_or(Error::NotInitialized)
}

pub fn next_vault_id(env: &Env) -> u32 {
    let count: u32 = env
        .storage()
        .instance()
        .get(&Symbol::new(env, VAULT_COUNT_KEY))
        .unwrap_or(0u32)
        + 1;
    env.storage()
        .instance()
        .set(&Symbol::new(env, VAULT_COUNT_KEY), &count);
    count
}

pub fn get_vault_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, VAULT_COUNT_KEY))
        .unwrap_or(0u32)
}

pub fn save_vault(env: &Env, vault: &Vault) {
    env.storage()
        .persistent()
        .set(&vault_key(env, vault.id), vault);

    // Maintain a bounded list of vault IDs for enumeration
    let list_key = vault_list_key(env);
    let mut list: Vec<u32> = env
        .storage()
        .instance()
        .get(&list_key)
        .unwrap_or_else(|| Vec::new(env));

    // Only add if not already present
    let mut found = false;
    for i in 0..list.len() {
        if list.get(i).unwrap() == vault.id {
            found = true;
            break;
        }
    }
    if !found {
        if list.len() >= MAX_VAULTS_LIST {
            let mut trimmed = Vec::new(env);
            for i in 1..list.len() {
                trimmed.push_back(list.get(i).unwrap());
            }
            list = trimmed;
        }
        list.push_back(vault.id);
        env.storage().instance().set(&list_key, &list);
    }
}

pub fn load_vault(env: &Env, id: u32) -> Result<Vault, Error> {
    env.storage()
        .persistent()
        .get(&vault_key(env, id))
        .ok_or(Error::VaultNotFound)
}

pub fn get_vault_list(env: &Env) -> Vec<u32> {
    env.storage()
        .instance()
        .get(&vault_list_key(env))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_shares(env: &Env, vault_id: u32, holder: &Address, shares: i128) {
    let key = (soroban_sdk::symbol_short!("sh"), vault_id, holder.clone());
    env.storage().persistent().set(&key, &shares);
}

pub fn get_shares(env: &Env, vault_id: u32, holder: &Address) -> i128 {
    let key = (soroban_sdk::symbol_short!("sh"), vault_id, holder.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(0i128)
}
