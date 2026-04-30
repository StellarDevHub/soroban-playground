#![cfg_attr(not(test), no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// File hash already notarized.
    AlreadyNotarized = 1,
    /// File hash not found.
    NotFound = 2,
    /// Caller is not the record owner.
    Unauthorized = 3,
    /// Contract is paused.
    ContractPaused = 4,
    /// Contract not initialized.
    NotInitialized = 5,
}

#[contracttype]
#[derive(Clone)]
pub struct NotaryRecord {
    pub owner: Address,
    pub timestamp: u64,
    pub metadata: String,
    pub verified: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Record(BytesN<32>),
}

#[contract]
pub struct FileNotary;

#[contractimpl]
impl FileNotary {
    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Notarize a file: store a record keyed by file_hash.
    /// Returns the ledger timestamp as the record_id.
    pub fn notarize_file(
        env: Env,
        caller: Address,
        file_hash: BytesN<32>,
        metadata: String,
    ) -> Result<u64, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        if env.storage().instance().has(&DataKey::Record(file_hash.clone())) {
            return Err(Error::AlreadyNotarized);
        }

        let timestamp = env.ledger().timestamp();
        let record = NotaryRecord {
            owner: caller.clone(),
            timestamp,
            metadata,
            verified: true,
        };

        env.storage()
            .instance()
            .set(&DataKey::Record(file_hash.clone()), &record);

        env.events().publish(
            (soroban_sdk::symbol_short!("notary"), soroban_sdk::symbol_short!("notarized")),
            (file_hash, caller, timestamp),
        );

        Ok(timestamp)
    }

    /// Verify a file: return the stored NotaryRecord.
    pub fn verify_file(env: Env, file_hash: BytesN<32>) -> Result<NotaryRecord, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Record(file_hash))
            .ok_or(Error::NotFound)
    }

    /// Revoke a notarization: owner-only, sets verified = false.
    pub fn revoke_notarization(
        env: Env,
        caller: Address,
        file_hash: BytesN<32>,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        let mut record: NotaryRecord = env
            .storage()
            .instance()
            .get(&DataKey::Record(file_hash.clone()))
            .ok_or(Error::NotFound)?;

        if record.owner != caller {
            return Err(Error::Unauthorized);
        }

        record.verified = false;
        env.storage()
            .instance()
            .set(&DataKey::Record(file_hash.clone()), &record);

        env.events().publish(
            (soroban_sdk::symbol_short!("notary"), soroban_sdk::symbol_short!("revoked")),
            file_hash,
        );

        Ok(())
    }

    /// Pause the contract (admin only).
    pub fn pause_contract(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Resume the contract (admin only).
    pub fn resume_contract(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            Err(Error::ContractPaused)
        } else {
            Ok(())
        }
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if &admin != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
