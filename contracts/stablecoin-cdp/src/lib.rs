#![cfg_attr(not(test), no_std)]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub struct Vault {
    pub owner: Address,
    pub collateral: i128,
    pub debt: i128,
}

#[contracttype]
pub enum DataKey {
    Vault(u64),
    NextVaultId,
    MCR, // minimum collateral ratio (basis points, e.g. 15000 = 150%)
    StabilityFeeBps,
    Treasury,
}

#[contract]
pub struct StablecoinCdp;

#[contractimpl]
impl StablecoinCdp {
    pub fn initialize(env: Env, mcr_bps: u32, stability_fee_bps: u32) {
        env.storage().instance().set(&DataKey::NextVaultId, &0u64);
        env.storage().instance().set(&DataKey::MCR, &mcr_bps);
        env.storage().instance().set(&DataKey::StabilityFeeBps, &stability_fee_bps);
    }

    pub fn open_vault(env: Env, owner: Address) -> u64 {
        owner.require_auth();
        let id: u64 = env.storage().instance().get(&DataKey::NextVaultId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextVaultId, &(id + 1));
        env.storage().persistent().set(&DataKey::Vault(id), &Vault { owner, collateral: 0, debt: 0 });
        id
    }

    pub fn deposit_collateral(env: Env, vault_id: u64, amount: i128) {
        let mut v: Vault = env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap();
        v.owner.require_auth();
        v.collateral += amount;
        env.storage().persistent().set(&DataKey::Vault(vault_id), &v);
    }

    pub fn mint(env: Env, vault_id: u64, amount: i128) {
        let mut v: Vault = env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap();
        v.owner.require_auth();
        v.debt += amount;
        let mcr: u32 = env.storage().instance().get(&DataKey::MCR).unwrap_or(15000);
        // enforce MCR: collateral * 10000 >= debt * mcr
        if v.collateral * 10000 < v.debt * mcr as i128 {
            panic!("below MCR");
        }
        env.storage().persistent().set(&DataKey::Vault(vault_id), &v);
    }

    pub fn repay(env: Env, vault_id: u64, amount: i128) {
        let mut v: Vault = env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap();
        v.owner.require_auth();
        v.debt -= amount;
        if v.debt < 0 { v.debt = 0; }
        env.storage().persistent().set(&DataKey::Vault(vault_id), &v);
    }

    pub fn withdraw_collateral(env: Env, vault_id: u64, amount: i128) {
        let mut v: Vault = env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap();
        v.owner.require_auth();
        v.collateral -= amount;
        let mcr: u32 = env.storage().instance().get(&DataKey::MCR).unwrap_or(15000);
        if v.collateral * 10000 < v.debt * mcr as i128 {
            panic!("below MCR");
        }
        env.storage().persistent().set(&DataKey::Vault(vault_id), &v);
    }

    pub fn liquidate(env: Env, vault_id: u64) {
        let v: Vault = env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap();
        let mcr: u32 = env.storage().instance().get(&DataKey::MCR).unwrap_or(15000);
        if v.collateral * 10000 >= v.debt * mcr as i128 {
            panic!("not liquidatable");
        }
        // absorb debt into stability pool (simplified: clear vault)
        env.storage().persistent().remove(&DataKey::Vault(vault_id));
    }

    pub fn redeem(env: Env, vault_id: u64, amount: i128) {
        let mut v: Vault = env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap();
        v.debt -= amount;
        if v.debt < 0 { v.debt = 0; }
        // release collateral worth amount (1:1)
        v.collateral -= amount;
        if v.collateral < 0 { v.collateral = 0; }
        env.storage().persistent().set(&DataKey::Vault(vault_id), &v);
    }

    pub fn get_vault(env: Env, vault_id: u64) -> Vault {
        env.storage().persistent().get(&DataKey::Vault(vault_id)).unwrap()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn open_and_mint() {
        let env = Env::default();
        let contract_id = env.register(StablecoinCdp, ());
        let client = StablecoinCdpClient::new(&env, &contract_id);
        client.initialize(&15000, &100);
        let owner = Address::generate(&env);
        let id = client.open_vault(&owner);
        client.deposit_collateral(&id, &1000);
        client.mint(&id, &500);
        let v = client.get_vault(&id);
        assert_eq!(v.debt, 500);
    }
}
