//! # Sparse Merkle Tree (SMT) Key-Value Registry
//!
//! On-chain registry that stores a 256-level Sparse Merkle Tree root and
//! verifies compact cryptographic inclusion / non-inclusion proofs submitted
//! off-chain. Enables off-chain state commitments to be verified on-chain with
//! O(256) verification cost regardless of the number of registered keys.
//!
//! ## Hashing scheme
//!
//! All hashes are SHA-256 with domain separation so interior nodes can never be
//! confused with leaves (second-preimage resistance):
//!
//! * leaf     = `sha256(0x00 || key || value)`
//! * interior = `sha256(0x01 || left || right)`
//!
//! Unlike a plain (set-membership) Merkle tree, sibling pairs are **not** sorted
//! here: in a sparse Merkle tree the position of a node is fixed by the bits of
//! the key, so `left`/`right` carry meaning and sorting would make distinct
//! trees collide. Set-membership trees (e.g. the allowlist contract) use sorted
//! pair hashing instead.

#![no_std]
// `update_root` takes both roots, both values and the proof by design.
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    Symbol, Vec,
};

const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const INITIALIZED_KEY: Symbol = symbol_short!("INIT");

const SMT_DEPTH: u32 = 256;

/// Domain-separation prefix for leaf hashes.
const LEAF_PREFIX: u8 = 0x00;
/// Domain-separation prefix for interior-node hashes.
const NODE_PREFIX: u8 = 0x01;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidProof = 4,
    RootMismatch = 5,
    ProofTooShort = 6,
    KeyCollision = 7,
}

// ── Storage key ─────────────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    Root,
}

#[contract]
pub struct SparseMerkleRegistry;

#[contractimpl]
impl SparseMerkleRegistry {
    // ── Initialisation ──────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, initial_root: BytesN<32>) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&INITIALIZED_KEY)
            .unwrap_or(false)
        {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::Root, &initial_root);
        env.storage().instance().set(&INITIALIZED_KEY, &true);
        env.events()
            .publish((symbol_short!("init"),), (admin, initial_root));
        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env
            .storage()
            .instance()
            .get(&INITIALIZED_KEY)
            .unwrap_or(false)
        {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    // ── Public hash helpers (used by off-chain proof generators) ────────────

    /// Hashes a 32-byte input into a 32-byte SHA-256 digest.
    pub fn hash_data(env: Env, data: BytesN<32>) -> BytesN<32> {
        Self::hash_data_ref(&env, data)
    }

    /// Hashes a pair of 32-byte nodes into a parent: `sha256(0x01 || left || right)`.
    pub fn hash_pair(env: Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
        Self::hash_pair_ref(&env, left, right)
    }

    /// Hashes a key-value pair into a leaf node: `sha256(0x00 || key || value)`.
    pub fn hash_leaf(env: Env, key: BytesN<32>, value: BytesN<32>) -> BytesN<32> {
        Self::hash_leaf_ref(&env, key, value)
    }

    // ── Queries ─────────────────────────────────────────────────────────────

    pub fn get_root(env: Env) -> BytesN<32> {
        Self::ensure_initialized(&env).ok();
        env.storage()
            .persistent()
            .get(&DataKey::Root)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]))
    }

    // ── Inclusion proof ─────────────────────────────────────────────────────

    /// Verifies an inclusion proof: proves that `key` maps to `value` in the
    /// current root. `proof_path` holds 256 sibling hashes (leaf-to-root).
    pub fn verify_inclusion_proof(
        env: Env,
        key: BytesN<32>,
        value: BytesN<32>,
        root: BytesN<32>,
        proof_path: Vec<BytesN<32>>,
    ) -> Result<bool, Error> {
        Self::ensure_initialized(&env)?;
        if proof_path.len() != SMT_DEPTH {
            return Err(Error::ProofTooShort);
        }

        let current = Self::hash_leaf_ref(&env, key.clone(), value);
        let key_arr = key.to_array();

        let mut cur = current;
        for i in 0..SMT_DEPTH {
            let bit = (key_arr[(i / 8) as usize] >> (7u32 - (i % 8))) & 1u8;
            let sibling = proof_path.get(i).ok_or(Error::InvalidProof)?;
            if bit == 0 {
                cur = Self::hash_pair_ref(&env, cur, sibling.clone());
            } else {
                cur = Self::hash_pair_ref(&env, sibling.clone(), cur);
            }
        }

        Ok(cur == root)
    }

    // ── Non-inclusion proof ─────────────────────────────────────────────────

    /// Verifies a non-inclusion proof: proves that `key` is NOT registered.
    ///
    /// `conflicting_key`/`conflicting_value` is the leaf that occupies the
    /// position where `key` would resolve; the proof walks `key`'s bit-path to
    /// that leaf, validates it against `root`, and confirms the occupying key
    /// differs from `key`. Since each SMT position holds exactly one leaf,
    /// `key` is provably absent.
    pub fn verify_non_inclusion_proof(
        env: Env,
        key: BytesN<32>,
        conflicting_key: BytesN<32>,
        conflicting_value: BytesN<32>,
        root: BytesN<32>,
        proof_path: Vec<BytesN<32>>,
    ) -> Result<bool, Error> {
        Self::ensure_initialized(&env)?;
        if proof_path.len() != SMT_DEPTH {
            return Err(Error::ProofTooShort);
        }
        if key == conflicting_key {
            return Err(Error::KeyCollision);
        }

        let key_arr = key.to_array();
        let mut cur = Self::hash_leaf_ref(&env, conflicting_key, conflicting_value);

        for i in 0..SMT_DEPTH {
            let bit = (key_arr[(i / 8) as usize] >> (7u32 - (i % 8))) & 1u8;
            let sibling = proof_path.get(i).ok_or(Error::InvalidProof)?;
            if bit == 0 {
                cur = Self::hash_pair_ref(&env, cur, sibling.clone());
            } else {
                cur = Self::hash_pair_ref(&env, sibling.clone(), cur);
            }
        }

        Ok(cur == root)
    }

    // ── Atomic root transition ──────────────────────────────────────────────

    /// Atomically updates the root from `old_root` to `new_root` by proving
    /// that exactly one leaf changed from `old_value` to `new_value` for
    /// `key`. Uses a single proof_path valid for both roots (siblings are
    /// unchanged when only one leaf is modified).
    pub fn update_root(
        env: Env,
        caller: Address,
        key: BytesN<32>,
        old_value: BytesN<32>,
        new_value: BytesN<32>,
        old_root: BytesN<32>,
        new_root: BytesN<32>,
        proof_path: Vec<BytesN<32>>,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::NotInitialized)?;
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        if proof_path.len() != SMT_DEPTH {
            return Err(Error::ProofTooShort);
        }

        let current_root: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::Root)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));
        if current_root != old_root {
            return Err(Error::RootMismatch);
        }

        let key_arr = key.to_array();
        let old_leaf = Self::hash_leaf_ref(&env, key.clone(), old_value);
        let new_leaf = Self::hash_leaf_ref(&env, key.clone(), new_value);

        // Walk old_root with old_leaf.
        let mut cur = old_leaf;
        for i in 0..SMT_DEPTH {
            let bit = (key_arr[(i / 8) as usize] >> (7u32 - (i % 8))) & 1u8;
            let sibling = proof_path.get(i).ok_or(Error::InvalidProof)?;
            if bit == 0 {
                cur = Self::hash_pair_ref(&env, cur, sibling.clone());
            } else {
                cur = Self::hash_pair_ref(&env, sibling.clone(), cur);
            }
        }
        if cur != old_root {
            return Err(Error::InvalidProof);
        }

        // Walk new_root with new_leaf (same siblings).
        cur = new_leaf;
        for i in 0..SMT_DEPTH {
            let bit = (key_arr[(i / 8) as usize] >> (7u32 - (i % 8))) & 1u8;
            let sibling = proof_path.get(i).ok_or(Error::InvalidProof)?;
            if bit == 0 {
                cur = Self::hash_pair_ref(&env, cur, sibling.clone());
            } else {
                cur = Self::hash_pair_ref(&env, sibling.clone(), cur);
            }
        }
        if cur != new_root {
            return Err(Error::InvalidProof);
        }

        env.storage().persistent().set(&DataKey::Root, &new_root);
        env.events().publish(
            (symbol_short!("root"), symbol_short!("upd")),
            (old_root, new_root),
        );
        Ok(())
    }

    // ── Internal (take &Env so they can be called repeatedly) ───────────────

    fn hash_data_ref(env: &Env, data: BytesN<32>) -> BytesN<32> {
        let bytes = Bytes::from_array(env, &data.to_array());
        env.crypto().sha256(&bytes).to_bytes()
    }

    fn hash_pair_ref(env: &Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
        let mut buf = Bytes::from_array(env, &[NODE_PREFIX]);
        buf.append(&Bytes::from_array(env, &left.to_array()));
        buf.append(&Bytes::from_array(env, &right.to_array()));
        env.crypto().sha256(&buf).to_bytes()
    }

    fn hash_leaf_ref(env: &Env, key: BytesN<32>, value: BytesN<32>) -> BytesN<32> {
        let mut buf = Bytes::from_array(env, &[LEAF_PREFIX]);
        buf.append(&Bytes::from_array(env, &key.to_array()));
        buf.append(&Bytes::from_array(env, &value.to_array()));
        env.crypto().sha256(&buf).to_bytes()
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    // Known-answer vectors computed independently with Python's hashlib:
    //   LEAF    = sha256(0x00 || [0x42; 32] || [0x7f; 32])
    //   NODE_ZZ = sha256(0x01 || [0; 32] || [0; 32])
    //   DATA_Z  = sha256([0; 32])
    const LEAF: [u8; 32] = [
        0x21, 0x22, 0x91, 0xbe, 0x09, 0xe1, 0x9a, 0x3e, 0x02, 0xe4, 0xe0, 0xff, 0xb2, 0x7d, 0x10,
        0x69, 0x96, 0x4b, 0x07, 0x89, 0xf7, 0xc7, 0x7e, 0x93, 0x85, 0x86, 0x0e, 0xa3, 0xa1, 0x52,
        0xb8, 0x3b,
    ];
    const NODE_ZZ: [u8; 32] = [
        0xae, 0x07, 0x98, 0xd0, 0xec, 0xae, 0xd2, 0xb7, 0x78, 0xed, 0xde, 0xbf, 0x18, 0xf0, 0x71,
        0xa5, 0x61, 0xc5, 0x36, 0x58, 0xc0, 0x5e, 0x76, 0xce, 0xde, 0xcc, 0x27, 0xca, 0xfb, 0xdb,
        0xc5, 0x77,
    ];
    const DATA_Z: [u8; 32] = [
        0x66, 0x68, 0x7a, 0xad, 0xf8, 0x62, 0xbd, 0x77, 0x6c, 0x8f, 0xc1, 0x8b, 0x8e, 0x9f, 0x8e,
        0x20, 0x08, 0x97, 0x14, 0x85, 0x6e, 0xe2, 0x33, 0xb3, 0x90, 0x2a, 0x59, 0x1d, 0x0d, 0x5f,
        0x29, 0x25,
    ];

    fn setup(env: &Env) -> SparseMerkleRegistryClient<'_> {
        env.mock_all_auths();
        let id = env.register_contract(None, SparseMerkleRegistry);
        SparseMerkleRegistryClient::new(env, &id)
    }

    fn bn(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    fn zero_path(env: &Env) -> Vec<BytesN<32>> {
        let zero = bn(env, 0);
        let mut path = Vec::new(env);
        for _ in 0..SMT_DEPTH {
            path.push_back(zero.clone());
        }
        path
    }

    /// Walks `start` up the tree along `key`'s bit-path with all-zero siblings.
    fn root_from(
        client: &SparseMerkleRegistryClient,
        env: &Env,
        key: &BytesN<32>,
        start: BytesN<32>,
    ) -> BytesN<32> {
        let zero = bn(env, 0);
        let ka = key.to_array();
        let mut cur = start;
        for i in 0..SMT_DEPTH as usize {
            let bit = (ka[i / 8] >> (7 - (i % 8))) & 1u8;
            cur = if bit == 0 {
                client.hash_pair(&cur, &zero)
            } else {
                client.hash_pair(&zero, &cur)
            };
        }
        cur
    }

    #[test]
    fn test_hashes_match_known_vectors() {
        let env = Env::default();
        let client = setup(&env);

        assert_eq!(
            client.hash_data(&bn(&env, 0)),
            BytesN::from_array(&env, &DATA_Z)
        );
        assert_eq!(
            client.hash_pair(&bn(&env, 0), &bn(&env, 0)),
            BytesN::from_array(&env, &NODE_ZZ)
        );
        assert_eq!(
            client.hash_leaf(&bn(&env, 0x42), &bn(&env, 0x7f)),
            BytesN::from_array(&env, &LEAF)
        );
    }

    #[test]
    fn test_hash_data_deterministic_and_collision_free_for_distinct_inputs() {
        let env = Env::default();
        let client = setup(&env);

        let a = bn(&env, 1);
        assert_eq!(client.hash_data(&a), client.hash_data(&a));
        assert_ne!(client.hash_data(&a), client.hash_data(&bn(&env, 2)));
    }

    #[test]
    fn test_leaf_and_node_hashes_are_domain_separated() {
        let env = Env::default();
        let client = setup(&env);

        let a = bn(&env, 0x11);
        let b = bn(&env, 0x22);
        // Same 64 input bytes, different role: must produce different digests.
        assert_ne!(client.hash_leaf(&a, &b), client.hash_pair(&a, &b));
        // Pair hashing is ordered in an SMT: position carries meaning.
        assert_ne!(client.hash_pair(&a, &b), client.hash_pair(&b, &a));
    }

    #[test]
    fn test_verify_inclusion() {
        let env = Env::default();
        let client = setup(&env);
        client.initialize(&Address::generate(&env), &bn(&env, 0));

        let key = bn(&env, 0x42);
        let value = bn(&env, 0x7f);
        let root = root_from(&client, &env, &key, client.hash_leaf(&key, &value));

        assert!(client.verify_inclusion_proof(&key, &value, &root, &zero_path(&env)));
    }

    #[test]
    fn test_inclusion_rejects_wrong_value_key_root_and_tampered_path() {
        let env = Env::default();
        let client = setup(&env);
        client.initialize(&Address::generate(&env), &bn(&env, 0));

        let key = bn(&env, 0x42);
        let value = bn(&env, 0x7f);
        let root = root_from(&client, &env, &key, client.hash_leaf(&key, &value));
        let path = zero_path(&env);

        assert!(!client.verify_inclusion_proof(&key, &bn(&env, 0x80), &root, &path));
        assert!(!client.verify_inclusion_proof(&bn(&env, 0x43), &value, &root, &path));
        assert!(!client.verify_inclusion_proof(&key, &value, &bn(&env, 0x99), &path));

        let mut tampered = zero_path(&env);
        tampered.set(10, bn(&env, 0x01));
        assert!(!client.verify_inclusion_proof(&key, &value, &root, &tampered));
    }

    #[test]
    fn test_inclusion_rejects_wrong_proof_length() {
        let env = Env::default();
        let client = setup(&env);
        client.initialize(&Address::generate(&env), &bn(&env, 0));

        let mut short = zero_path(&env);
        short.pop_back();
        assert_eq!(
            client.try_verify_inclusion_proof(&bn(&env, 1), &bn(&env, 2), &bn(&env, 3), &short),
            Err(Ok(Error::ProofTooShort))
        );
    }

    #[test]
    fn test_interior_node_cannot_pass_as_leaf() {
        let env = Env::default();
        let client = setup(&env);
        client.initialize(&Address::generate(&env), &bn(&env, 0));

        // Attacker treats an interior node (zero, zero) as if it were the leaf for
        // (key, value) = (zero, zero) — the domain prefixes make the hashes differ.
        let zero = bn(&env, 0);
        assert_ne!(
            client.hash_leaf(&zero, &zero),
            client.hash_pair(&zero, &zero)
        );
    }

    #[test]
    fn test_verify_non_inclusion() {
        let env = Env::default();
        let client = setup(&env);
        client.initialize(&Address::generate(&env), &bn(&env, 0));

        let key = bn(&env, 0x42);
        let other_key = bn(&env, 0x43);
        let other_value = bn(&env, 0x01);
        let root = root_from(
            &client,
            &env,
            &key,
            client.hash_leaf(&other_key, &other_value),
        );
        let path = zero_path(&env);

        assert!(client.verify_non_inclusion_proof(&key, &other_key, &other_value, &root, &path));
        // A wrong occupant does not validate against the root.
        assert!(!client.verify_non_inclusion_proof(
            &key,
            &other_key,
            &bn(&env, 0x02),
            &root,
            &path
        ));
    }

    #[test]
    fn test_non_inclusion_rejects_key_equal_to_conflicting_key() {
        let env = Env::default();
        let client = setup(&env);
        client.initialize(&Address::generate(&env), &bn(&env, 0));

        let key = bn(&env, 0x42);
        assert_eq!(
            client.try_verify_non_inclusion_proof(
                &key,
                &key,
                &bn(&env, 1),
                &bn(&env, 2),
                &zero_path(&env)
            ),
            Err(Ok(Error::KeyCollision))
        );
    }

    #[test]
    fn test_update_root_transition() {
        let env = Env::default();
        let client = setup(&env);
        let admin = Address::generate(&env);

        let key = bn(&env, 0x42);
        let old_val = bn(&env, 0x01);
        let new_val = bn(&env, 0x02);
        let path = zero_path(&env);

        let old_root = root_from(&client, &env, &key, client.hash_leaf(&key, &old_val));
        let new_root = root_from(&client, &env, &key, client.hash_leaf(&key, &new_val));

        client.initialize(&admin, &old_root);
        client.update_root(
            &admin, &key, &old_val, &new_val, &old_root, &new_root, &path,
        );
        assert_eq!(client.get_root(), new_root);
    }

    #[test]
    fn test_update_root_rejects_non_admin_stale_root_and_bad_proof() {
        let env = Env::default();
        let client = setup(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        let key = bn(&env, 0x42);
        let old_val = bn(&env, 0x01);
        let new_val = bn(&env, 0x02);
        let path = zero_path(&env);
        let old_root = root_from(&client, &env, &key, client.hash_leaf(&key, &old_val));
        let new_root = root_from(&client, &env, &key, client.hash_leaf(&key, &new_val));
        client.initialize(&admin, &old_root);

        assert_eq!(
            client
                .try_update_root(&attacker, &key, &old_val, &new_val, &old_root, &new_root, &path),
            Err(Ok(Error::Unauthorized))
        );
        assert_eq!(
            client.try_update_root(
                &admin,
                &key,
                &old_val,
                &new_val,
                &bn(&env, 9),
                &new_root,
                &path
            ),
            Err(Ok(Error::RootMismatch))
        );
        assert_eq!(
            client.try_update_root(
                &admin,
                &key,
                &old_val,
                &new_val,
                &old_root,
                &bn(&env, 9),
                &path
            ),
            Err(Ok(Error::InvalidProof))
        );
        assert_eq!(client.get_root(), old_root);
    }
}
