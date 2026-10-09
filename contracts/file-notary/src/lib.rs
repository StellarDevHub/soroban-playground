#![cfg_attr(not(test), no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, String, Vec,
};

const PERSISTENT_TTL_THRESHOLD: u32 = 100;
const PERSISTENT_TTL_EXTEND_TO: u32 = 518_400;
const MAX_MERKLE_PROOF_DEPTH: u32 = 32;

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
    /// A batch must contain between one and 2^32 leaves.
    InvalidBatchSize = 6,
    /// The supplied Merkle proof does not match the registered root.
    InvalidProof = 7,
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
#[derive(Clone)]
pub struct BatchRecord {
    pub owner: Address,
    pub timestamp: u64,
    pub metadata: String,
    pub verified: bool,
    pub leaf_count: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Batch(BytesN<32>),
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
        Self::store_batch(env, caller, file_hash, 1, metadata, false)
    }

    /// Register a batch by its Merkle root. Leaves are 32-byte file hashes;
    /// odd-width tree levels promote their final unpaired node unchanged.
    pub fn notarize_batch(
        env: Env,
        caller: Address,
        merkle_root: BytesN<32>,
        leaf_count: u64,
        metadata: String,
    ) -> Result<u64, Error> {
        Self::store_batch(env, caller, merkle_root, leaf_count, metadata, true)
    }

    fn store_batch(
        env: Env,
        caller: Address,
        merkle_root: BytesN<32>,
        leaf_count: u64,
        metadata: String,
        is_batch: bool,
    ) -> Result<u64, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;
        Self::validate_leaf_count(leaf_count)?;

        let key = DataKey::Batch(merkle_root.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyNotarized);
        }

        let timestamp = env.ledger().timestamp();
        let record = BatchRecord {
            owner: caller.clone(),
            timestamp,
            metadata,
            verified: true,
            leaf_count,
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        if is_batch {
            env.events().publish(
                (
                    soroban_sdk::symbol_short!("notary"),
                    soroban_sdk::symbol_short!("batch"),
                ),
                (merkle_root, caller, timestamp, leaf_count),
            );
        } else {
            env.events().publish(
                (
                    soroban_sdk::symbol_short!("notary"),
                    soroban_sdk::symbol_short!("notarized"),
                ),
                (merkle_root, caller, timestamp),
            );
        }

        Ok(timestamp)
    }

    /// Verify a one-file notarization and return its record.
    pub fn verify_file(env: Env, file_hash: BytesN<32>) -> Result<NotaryRecord, Error> {
        let record = Self::get_batch_record(&env, &file_hash)?;
        if record.leaf_count != 1 {
            return Err(Error::NotFound);
        }
        Ok(NotaryRecord {
            owner: record.owner,
            timestamp: record.timestamp,
            metadata: record.metadata,
            verified: record.verified,
        })
    }

    /// Verify an indexed file hash against a registered Merkle root.
    pub fn verify_batch_proof(
        env: Env,
        merkle_root: BytesN<32>,
        leaf: BytesN<32>,
        leaf_index: u64,
        proof: Vec<BytesN<32>>,
    ) -> Result<BatchRecord, Error> {
        let record = Self::get_batch_record(&env, &merkle_root)?;
        if !record.verified {
            return Err(Error::NotFound);
        }
        if leaf_index >= record.leaf_count
            || !Self::verify_merkle_proof(
                &env,
                leaf,
                leaf_index,
                record.leaf_count,
                proof,
                merkle_root,
            )
        {
            return Err(Error::InvalidProof);
        }
        Ok(record)
    }

    /// Revoke a notarization: owner-only, sets verified = false.
    pub fn revoke_notarization(
        env: Env,
        caller: Address,
        file_hash: BytesN<32>,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        let key = DataKey::Batch(file_hash.clone());
        let mut record: BatchRecord = Self::get_batch_record(&env, &file_hash)?;

        if record.owner != caller {
            return Err(Error::Unauthorized);
        }

        record.verified = false;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        env.events().publish(
            (
                soroban_sdk::symbol_short!("notary"),
                soroban_sdk::symbol_short!("revoked"),
            ),
            file_hash,
        );

        Ok(())
    }

    /// Revoke a batch notarization. Existing proofs then fail verification.
    pub fn revoke_batch(env: Env, caller: Address, merkle_root: BytesN<32>) -> Result<(), Error> {
        Self::revoke_notarization(env, caller, merkle_root)
    }

    /// Return batch metadata for a registered root.
    pub fn get_batch(env: Env, merkle_root: BytesN<32>) -> Result<BatchRecord, Error> {
        Self::get_batch_record(&env, &merkle_root)
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

    fn validate_leaf_count(leaf_count: u64) -> Result<(), Error> {
        if leaf_count == 0 || leaf_count > (1u64 << MAX_MERKLE_PROOF_DEPTH) {
            Err(Error::InvalidBatchSize)
        } else {
            Ok(())
        }
    }

    fn get_batch_record(env: &Env, merkle_root: &BytesN<32>) -> Result<BatchRecord, Error> {
        let key = DataKey::Batch(merkle_root.clone());
        let record: BatchRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        Ok(record)
    }

    fn verify_merkle_proof(
        env: &Env,
        leaf: BytesN<32>,
        leaf_index: u64,
        leaf_count: u64,
        proof: Vec<BytesN<32>>,
        expected_root: BytesN<32>,
    ) -> bool {
        if proof.len() > MAX_MERKLE_PROOF_DEPTH {
            return false;
        }

        let mut current = leaf;
        let mut index = leaf_index;
        let mut width = leaf_count;
        let mut proof_index = 0;

        while width > 1 {
            let sibling_index = index ^ 1;
            if sibling_index < width {
                if proof_index >= proof.len() {
                    return false;
                }
                let sibling = proof.get(proof_index).unwrap();
                current = if index % 2 == 0 {
                    Self::hash_pair(env, &current, &sibling)
                } else {
                    Self::hash_pair(env, &sibling, &current)
                };
                proof_index += 1;
            }
            index /= 2;
            width = (width + 1) / 2;
        }

        proof_index == proof.len() && current == expected_root
    }

    fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
        let left_array = left.to_array();
        let right_array = right.to_array();
        let mut preimage = [0u8; 64];
        preimage[..32].copy_from_slice(&left_array);
        preimage[32..].copy_from_slice(&right_array);
        let hash = env.crypto().sha256(&Bytes::from_array(env, &preimage));
        BytesN::from_array(env, &hash.to_array())
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
