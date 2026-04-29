// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg_attr(not(test), no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Bytes,
    BytesN, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    AlreadyClaimed = 5,
    InvalidAmount = 6,
    InvalidProof = 7,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    MerkleRoot,
    Paused,
    TotalClaimed,
    Claim(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofNode {
    pub hash: BytesN<32>,
    pub is_left: bool,
}

#[contract]
pub struct TokenAirdrop;

#[contractimpl]
impl TokenAirdrop {
    /// Initialize contract with admin, token address, and Merkle root.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        merkle_root: BytesN<32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::MerkleRoot, &merkle_root);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::TotalClaimed, &0i128);

        env.events().publish(
            (symbol_short!("init"),),
            (admin, token, merkle_root),
        );

        Ok(())
    }

    /// Update the Merkle root (admin only).
    pub fn set_merkle_root(
        env: Env,
        admin: Address,
        merkle_root: BytesN<32>,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::MerkleRoot, &merkle_root);

        env.events()
            .publish((symbol_short!("root"),), merkle_root);

        Ok(())
    }

    /// Transfer admin role to a new address.
    pub fn transfer_admin(
        env: Env,
        admin: Address,
        new_admin: Address,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (symbol_short!("admin"),),
            (admin, new_admin),
        );

        Ok(())
    }

    /// Pause claim execution (admin only).
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    /// Unpause claim execution (admin only).
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    /// Claim tokens by providing a valid Merkle proof.
    pub fn claim(
        env: Env,
        claimant: Address,
        amount: i128,
        proof: Vec<ProofNode>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        claimant.require_auth();

        if is_paused(&env) {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if has_claimed(&env, &claimant) {
            return Err(Error::AlreadyClaimed);
        }

        if !verify_proof(&env, &claimant, amount, proof) {
            return Err(Error::InvalidProof);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &claimant, &amount);

        env.storage()
            .persistent()
            .set(&DataKey::Claim(claimant.clone()), &true);

        let mut total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalClaimed)
            .unwrap_or(0i128);
        total += amount;
        env.storage().instance().set(&DataKey::TotalClaimed, &total);

        env.events()
            .publish((symbol_short!("claim"), claimant), amount);

        Ok(())
    }

    /// Check if a claim is eligible without marking it as claimed.
    pub fn is_eligible(
        env: Env,
        claimant: Address,
        amount: i128,
        proof: Vec<ProofNode>,
    ) -> bool {
        if !is_initialized(&env) || is_paused(&env) || amount <= 0 {
            return false;
        }
        if has_claimed(&env, &claimant) {
            return false;
        }
        verify_proof(&env, &claimant, amount, proof)
    }

    pub fn has_claimed(env: Env, claimant: Address) -> bool {
        has_claimed(&env, &claimant)
    }

    pub fn get_root(env: Env) -> Result<BytesN<32>, Error> {
        env.storage()
            .instance()
            .get(&DataKey::MerkleRoot)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_token(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }

    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn total_claimed(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalClaimed)
            .unwrap_or(0i128)
    }
}

fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn assert_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    ensure_initialized(env)?;
    admin.require_auth();
    let current: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    if &current != admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn has_claimed(env: &Env, claimant: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Claim(claimant.clone()))
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

fn verify_proof(env: &Env, claimant: &Address, amount: i128, proof: Vec<ProofNode>) -> bool {
    let root: BytesN<32> = match env.storage().instance().get(&DataKey::MerkleRoot) {
        Some(r) => r,
        None => return false,
    };

    let mut current = hash_leaf(env, claimant, amount);
    for node in proof.iter() {
        current = if node.is_left {
            hash_pair(env, &node.hash, &current)
        } else {
            hash_pair(env, &current, &node.hash)
        };
    }

    current == root
}

fn hash_leaf(env: &Env, claimant: &Address, amount: i128) -> BytesN<32> {
    let address = claimant.to_string();
    let mut address_buf = [0u8; 64];
    let address_len = address.len() as usize;
    address.copy_into_slice(&mut address_buf[..address_len]);
    let address_bytes = Bytes::from_slice(env, &address_buf[..address_len]);
    let amount_bytes = decimal_bytes(env, amount);

    let mut input = Bytes::new(env);
    input.append(&address_bytes);
    input.push_back(58u8); // ':'
    input.append(&amount_bytes);

    env.crypto().sha256(&input).into()
}

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(&left.to_array());
    combined[32..].copy_from_slice(&right.to_array());
    let bytes = Bytes::from_slice(env, &combined);
    env.crypto().sha256(&bytes).into()
}

fn decimal_bytes(env: &Env, value: i128) -> Bytes {
    let mut buf = [0u8; 40];
    let mut idx = buf.len();

    let mut n = value as u128;
    if n == 0 {
        idx -= 1;
        buf[idx] = b'0';
    } else {
        while n > 0 {
            let digit = (n % 10) as u8;
            idx -= 1;
            buf[idx] = b'0' + digit;
            n /= 10;
        }
    }

    Bytes::from_slice(env, &buf[idx..])
}

mod test;
