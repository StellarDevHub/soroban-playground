#![no_std]
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec,
};

mod merkle;

const ADMIN: Symbol = symbol_short!("ADMIN");

#[contracttype]
pub enum DataKey {
    Allow(Address),
    MerkleRoot,
}

#[contract]
pub struct AllowlistContract;

#[contractimpl]
impl AllowlistContract {
    /// Initialize the contract with an admin user.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic!("already initialized");
        }
        env.storage().instance().set(&ADMIN, &admin);
    }

    /// Add a user to the allowlist. Only the admin is allowed to call this.
    pub fn add(env: Env, admin: Address, user: Address) {
        // 1. Get the current admin.
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");

        // 2. Ensure the provided admin address matches the stored admin.
        if admin != current_admin {
            panic!("unauthorized");
        }

        // 3. Require authentication from the admin.
        admin.require_auth();

        // 4. Add the user to the allowlist in persistent storage.
        env.storage().persistent().set(&DataKey::Allow(user), &());
    }

    /// Remove a user from the allowlist. Only the admin is allowed to call this.
    pub fn remove(env: Env, admin: Address, user: Address) {
        // 1. Get the current admin.
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");

        // 2. Ensure the provided admin address matches the stored admin.
        if admin != current_admin {
            panic!("unauthorized");
        }

        // 3. Require authentication from the admin.
        admin.require_auth();

        // 4. Remove the user from the allowlist.
        env.storage().persistent().remove(&DataKey::Allow(user));
    }

    /// Check if a user is in the allowlist.
    pub fn is_allowed(env: Env, user: Address) -> bool {
        env.storage().persistent().has(&DataKey::Allow(user))
    }

    /// Set the Merkle root of an off-chain allowlist. Only the admin may call this.
    ///
    /// Leaves are `0x00`-prefixed hashes of each address's XDR encoding and
    /// interior nodes are `0x01`-prefixed sorted-pair hashes (see `merkle.rs`).
    pub fn set_merkle_root(env: Env, admin: Address, root: BytesN<32>) {
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        if admin != current_admin {
            panic!("unauthorized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::MerkleRoot, &root);
    }

    /// Get the configured Merkle root, if any.
    pub fn get_merkle_root(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::MerkleRoot)
    }

    /// Hash raw leaf data with the leaf domain-separation prefix.
    pub fn hash_leaf(env: Env, data: Bytes) -> BytesN<32> {
        merkle::hash_leaf(&env, &data)
    }

    /// Hash two sibling nodes (sorted) with the interior-node prefix.
    pub fn hash_node(env: Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
        merkle::hash_node(&env, &a, &b)
    }

    /// Verify a Merkle proof for arbitrary leaf data against `root`.
    pub fn verify_merkle_proof(
        env: Env,
        root: BytesN<32>,
        leaf_data: Bytes,
        proof: Vec<BytesN<32>>,
    ) -> bool {
        merkle::verify(&env, &root, &leaf_data, &proof)
    }

    /// Check whether `user` is on the Merkle allowlist (or the direct allowlist).
    pub fn is_allowed_by_proof(env: Env, user: Address, proof: Vec<BytesN<32>>) -> bool {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Allow(user.clone()))
        {
            return true;
        }
        let root: Option<BytesN<32>> = env.storage().instance().get(&DataKey::MerkleRoot);
        match root {
            Some(root) => merkle::verify(&env, &root, &user.to_xdr(&env), &proof),
            None => false,
        }
    }

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized")
    }
}

mod test;
