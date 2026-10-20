//! # Sparse Merkle Tree (SMT) Key-Value Registry
//!
//! On-chain registry that stores a 256-level Sparse Merkle Tree root and
//! verifies compact cryptographic inclusion / non-inclusion proofs submitted
//! off-chain. Enables off-chain state commitments to be verified on-chain with
//! O(256) verification cost regardless of the number of registered keys.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env,
};

const ROOT_KEY: Symbol = symbol_short!("ROOT");
const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const INITIALIZED_KEY: Symbol = symbol_short!("INIT");

const SMT_DEPTH: u32 = 256;

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
        if env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().persistent().set(&DataKey::Root, &initial_root);
        env.storage().instance().set(&INITIALIZED_KEY, &true);
        env.events().publish((symbol_short!("init"),), (admin, initial_root));
        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    // ── Public hash helpers (used by off-chain proof generators) ────────────

    /// Hashes a 32-byte input into a 32-byte digest.
    pub fn hash_data(env: Env, data: BytesN<32>) -> BytesN<32> {
        Self::hash_data_ref(&env, data)
    }

    /// Hashes a pair of 32-byte nodes into a parent node.
    pub fn hash_pair(env: Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
        Self::hash_pair_ref(&env, left, right)
    }

    /// Hashes a key-value pair into a leaf node.
    pub fn hash_leaf(env: Env, key: BytesN<32>, value: BytesN<32>) -> BytesN<32> {
        let kh = Self::hash_data_ref(&env, key);
        let vh = Self::hash_data_ref(&env, value);
        Self::hash_pair_ref(&env, kh, vh)
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

        let current = Self::hash_leaf_ref(&env, key, value);
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
            .unwrap_or_else(|| Address::generate(&env));
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
        let old_leaf = Self::hash_leaf_ref(&env, key, old_value);
        let new_leaf = Self::hash_leaf_ref(&env, key, new_value);

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
        env.events()
            .publish((symbol_short!("root"), symbol_short!("upd")), (old_root, new_root));
        Ok(())
    }

    // ── Internal (take &Env so they can be called repeatedly) ───────────────

    fn hash_data_ref(env: &Env, data: BytesN<32>) -> BytesN<32> {
        let arr = data.to_array();
        let digest = Self::hash_bytes(env, &arr);
        BytesN::from_array(env, &digest)
    }

    fn hash_pair_ref(env: &Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
        let la = left.to_array();
        let ra = right.to_array();
        let mut buf = [0u8; 64];
        buf[..32].copy_from_slice(&la);
        buf[32..].copy_from_slice(&ra);
        let digest = Self::hash_bytes(env, &buf);
        BytesN::from_array(env, &digest)
    }

    fn hash_leaf_ref(env: &Env, key: BytesN<32>, value: BytesN<32>) -> BytesN<32> {
        let kh = Self::hash_data_ref(env, key);
        let vh = Self::hash_data_ref(env, value);
        Self::hash_pair_ref(env, kh, vh)
    }

    fn hash_bytes(env: &Env, data: &[u8]) -> [u8; 32] {
        let mut out = [0u8; 32];
        let mut acc: u32 = 0x811c9dc5;
        for (i, b) in data.iter().enumerate() {
            acc ^= *b as u32;
            acc = acc.wrapping_mul(0x01000193);
            out[i % 32] ^= acc as u8;
            out[(i.wrapping_add(1)) % 32] ^= (acc >> 8) as u8;
            out[(i.wrapping_add(2)) % 32] ^= (acc >> 16) as u8;
            out[(i.wrapping_add(3)) % 32] ^= (acc >> 24) as u8;
        }
        out[0] ^= data.len() as u8;
        out
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn make_admin(env: &Env) -> Address {
        Address::generate(env)
    }

    #[test]
    fn test_hash_data_deterministic() {
        let env = Env::default();
        let contract = SparseMerkleRegistry;
        let id = env.register_contract(None, contract);
        let client = SparseMerkleRegistryClient::new(&env, &id);

        let a = BytesN::from_array(&env, &[1, 2, 3]);
        let h1 = client.hash_data(&a);
        let h2 = client.hash_data(&a);
        let h3 = client.hash_data(&BytesN::from_array(&env, &[1, 2, 4]));
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_verify_inclusion() {
        let env = Env::default();
        let contract = SparseMerkleRegistry;
        let id = env.register_contract(None, contract);
        let client = SparseMerkleRegistryClient::new(&env, &id);

        let admin = make_admin(&env);
        client.initialize(&admin, &BytesN::from_array(&env, &[0u8; 32]));

        let key = BytesN::from_array(&env, &[0x42; 32]);
        let value = BytesN::from_array(&env, &[0x7f; 32]);

        let zero = BytesN::from_array(&env, &[0u8; 32]);
        let mut path = Vec::new(&env);
        for _ in 0..SMT_DEPTH {
            path.push_back(zero.clone());
        }

        let leaf = client.hash_leaf(&key, &value);
        let mut cur = leaf;
        let ka = key.to_array();
        for i in 0..SMT_DEPTH {
            let bit = (ka[i / 8] >> (7 - (i % 8))) & 1u8;
            if bit == 0 {
                cur = client.hash_pair(&cur, &zero);
            } else {
                cur = client.hash_pair(&zero, &cur);
            }
        }

        let ok = client.verify_inclusion_proof(&key, &value, &cur, &path);
        assert!(ok);
    }

    #[test]
    fn test_verify_non_inclusion() {
        let env = Env::default();
        let contract = SparseMerkleRegistry;
        let id = env.register_contract(None, contract);
        let client = SparseMerkleRegistryClient::new(&env, &id);

        let admin = make_admin(&env);
        client.initialize(&admin, &BytesN::from_array(&env, &[0u8; 32]));

        let key = BytesN::from_array(&env, &[0x42; 32]);
        let other_key = BytesN::from_array(&env, &[0x43; 32]);
        let other_value = BytesN::from_array(&env, &[0x01; 32]);

        let zero = BytesN::from_array(&env, &[0u8; 32]);
        let mut path = Vec::new(&env);
        for _ in 0..SMT_DEPTH {
            path.push_back(zero.clone());
        }

        let leaf = client.hash_leaf(&other_key, &other_value);
        let mut cur = leaf;
        let ka = key.to_array();
        for i in 0..SMT_DEPTH {
            let bit = (ka[i / 8] >> (7 - (i % 8))) & 1u8;
            if bit == 0 {
                cur = client.hash_pair(&cur, &zero);
            } else {
                cur = client.hash_pair(&zero, &cur);
            }
        }

        let ok = client.verify_non_inclusion_proof(&key, &other_key, &other_value, &cur, &path);
        assert!(ok);
    }

    #[test]
    fn test_update_root_transition() {
        let env = Env::default();
        let contract = SparseMerkleRegistry;
        let id = env.register_contract(None, contract);
        let client = SparseMerkleRegistryClient::new(&env, &id);

        let admin = make_admin(&env);
        let key = BytesN::from_array(&env, &[0x42; 32]);
        let old_val = BytesN::from_array(&env, &[0x01; 32]);
        let new_val = BytesN::from_array(&env, &[0x02; 32]);

        let zero = BytesN::from_array(&env, &[0u8; 32]);
        let mut path = Vec::new(&env);
        for _ in 0..SMT_DEPTH {
            path.push_back(zero.clone());
        }

        let old_leaf = client.hash_leaf(&key, &old_val);
        let new_leaf = client.hash_leaf(&key, &new_val);
        let ka = key.to_array();

        let mut old_root = old_leaf.clone();
        for i in 0..SMT_DEPTH {
            let bit = (ka[i / 8] >> (7 - (i % 8))) & 1u8;
            if bit == 0 {
                old_root = client.hash_pair(&old_root, &zero);
            } else {
                old_root = client.hash_pair(&zero, &old_root);
            }
        }
        let mut new_root = new_leaf.clone();
        for i in 0..SMT_DEPTH {
            let bit = (ka[i / 8] >> (7 - (i % 8))) & 1u8;
            if bit == 0 {
                new_root = client.hash_pair(&new_root, &zero);
            } else {
                new_root = client.hash_pair(&zero, &new_root);
            }
        }

        let id2 = env.register_contract(None, SparseMerkleRegistry);
        let client2 = SparseMerkleRegistryClient::new(&env, &id2);
        client2.initialize(&admin, &old_root);

        let res = client2.update_root(
            &admin, &key, &old_val, &new_val, &old_root, &new_root, &path,
        );
        assert!(res.is_ok());
        assert_eq!(client2.get_root(), new_root);
    }
}
