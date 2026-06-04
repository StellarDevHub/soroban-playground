#![no_std]

mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryEntry {
    pub contract_address: Address,
    pub owner: Address,
    pub metadata: String,
    pub registered_at: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 0,
    AlreadyRegistered = 1,
    NotRegistered = 2,
    Unauthorized = 3,
    InvalidMetadata = 4,
    NotActive = 5,
}

#[contract]
pub struct RegistryIntegrationContract;

#[contractimpl]
impl RegistryIntegrationContract {
    /// Initialise the registry integration contract and set the admin.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        let admin_key = symbol_short!("admin");
        if env.storage().persistent().get(&admin_key).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&admin_key, &admin);
        Ok(())
    }

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Option<Address> {
        let admin_key = symbol_short!("admin");
        env.storage().persistent().get(&admin_key)
    }

    /// Register a contract with the central registry.
    pub fn register_with_registry(
        env: Env,
        caller: Address,
        contract_address: Address,
        metadata: String,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::validate_metadata(&metadata)?;
        if let Some(entry) = Self::get_raw_entry(&env, &contract_address) {
            if entry.active {
                return Err(Error::AlreadyRegistered);
            }
        }

        let entry = RegistryEntry {
            contract_address: contract_address.clone(),
            owner: caller.clone(),
            metadata: metadata.clone(),
            registered_at: env.ledger().timestamp(),
            active: true,
        };

        env.storage().persistent().set(&contract_address, &entry);
        env.events().publish((symbol_short!("registered"), contract_address), (caller, metadata));
        Ok(())
    }

    /// Unregister a contract from the central registry.
    pub fn unregister_from_registry(
        env: Env,
        caller: Address,
        contract_address: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        let mut entry = Self::get_raw_entry(&env, &contract_address).ok_or(Error::NotRegistered)?;
        if !entry.active {
            return Err(Error::NotActive);
        }
        Self::assert_owner_or_admin(&env, &caller, &entry)?;

        entry.active = false;
        env.storage().persistent().set(&contract_address, &entry);
        env.events().publish((symbol_short!("unregistered"), contract_address), caller);
        Ok(())
    }

    /// Revoke an active registration using admin authority.
    pub fn revoke_registration(
        env: Env,
        admin: Address,
        contract_address: Address,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut entry = Self::get_raw_entry(&env, &contract_address).ok_or(Error::NotRegistered)?;
        if !entry.active {
            return Err(Error::NotActive);
        }

        entry.active = false;
        env.storage().persistent().set(&contract_address, &entry);
        env.events().publish((symbol_short!("revoked"), contract_address), admin);
        Ok(())
    }

    /// Return registry metadata for an active registered contract.
    pub fn get_registry_metadata(env: Env, contract_address: Address) -> Option<String> {
        Self::get_active_entry(&env, &contract_address).map(|entry| entry.metadata)
    }

    /// Return registry information for an active registered contract.
    pub fn get_registry_info(env: Env, contract_address: Address) -> Option<RegistryEntry> {
        Self::get_active_entry(&env, &contract_address)
    }

    /// Update metadata for an active registered contract.
    pub fn set_registry_metadata(
        env: Env,
        caller: Address,
        contract_address: Address,
        metadata: String,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::validate_metadata(&metadata)?;
        let mut entry = Self::get_raw_entry(&env, &contract_address).ok_or(Error::NotRegistered)?;
        if !entry.active {
            return Err(Error::NotActive);
        }
        Self::assert_owner_or_admin(&env, &caller, &entry)?;

        entry.metadata = metadata.clone();
        env.storage().persistent().set(&contract_address, &entry);
        env.events().publish((symbol_short!("metadata_updated"), contract_address), metadata);
        Ok(())
    }
}

impl RegistryIntegrationContract {
    fn get_raw_entry(env: &Env, contract_address: &Address) -> Option<RegistryEntry> {
        env.storage().persistent().get(contract_address)
    }

    fn get_active_entry(env: &Env, contract_address: &Address) -> Option<RegistryEntry> {
        let entry = env.storage().persistent().get(contract_address)?;
        if entry.active {
            Some(entry)
        } else {
            None
        }
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        caller.require_auth();
        let admin_key = symbol_short!("admin");
        let admin: Address = env.storage().persistent().get(&admin_key).ok_or(Error::Unauthorized)?;
        if admin != *caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_owner_or_admin(
        env: &Env,
        caller: &Address,
        entry: &RegistryEntry,
    ) -> Result<(), Error> {
        if *caller == entry.owner {
            return Ok(());
        }
        Self::assert_admin(env, caller)
    }

    fn validate_metadata(metadata: &String) -> Result<(), Error> {
        let len = metadata.len();
        if len == 0 || len > 1024 {
            return Err(Error::InvalidMetadata);
        }
        Ok(())
    }
}
