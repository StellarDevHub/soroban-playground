//! Token-Gated Access Control with Membership NFTs
//!
//! Provides tiered membership NFT minting, access verification, and
//! community analytics with admin pause/unpause capability.

#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const NEXT_ID: Symbol = symbol_short!("NEXT_ID");
const TOTAL_MEM: Symbol = symbol_short!("TOTAL_MEM");

// ── Types ─────────────────────────────────────────────────────────────────────

/// Membership tier determines access level.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum Tier {
    Bronze,
    Silver,
    Gold,
}

/// On-chain NFT metadata stored per token.
#[contracttype]
#[derive(Clone)]
pub struct MembershipNft {
    pub owner: Address,
    pub tier: Tier,
    pub issued_at: u64,
    pub metadata_uri: String,
}

/// Per-address analytics record.
#[contracttype]
#[derive(Clone)]
pub struct MemberStats {
    pub access_count: u64,
    pub last_access: u64,
}

#[contracttype]
pub enum DataKey {
    Nft(u64),           // token_id → MembershipNft
    OwnerToken(Address), // owner   → token_id
    Stats(Address),     // address → MemberStats
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenGatedAccess;

#[contractimpl]
impl TokenGatedAccess {
    // ── Admin / lifecycle ─────────────────────────────────────────────────

    /// Initialize with an admin address. Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic!("already initialized");
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&NEXT_ID, &1u64);
        env.storage().instance().set(&TOTAL_MEM, &0u64);

        env.events()
            .publish((symbol_short!("init"),), (admin,));
    }

    /// Pause the contract (admin only). Blocks mint and check_access.
    pub fn pause(env: Env, admin: Address) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&PAUSED, &true);
        env.events().publish((symbol_short!("paused"),), ());
    }

    /// Unpause the contract (admin only).
    pub fn unpause(env: Env, admin: Address) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&PAUSED, &false);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    // ── NFT minting ───────────────────────────────────────────────────────

    /// Mint a membership NFT for `recipient`. Admin only.
    /// Each address may hold at most one NFT.
    pub fn mint(
        env: Env,
        admin: Address,
        recipient: Address,
        tier: Tier,
        metadata_uri: String,
    ) -> u64 {
        Self::require_not_paused(&env);
        Self::require_admin(&env, &admin);

        if env
            .storage()
            .persistent()
            .has(&DataKey::OwnerToken(recipient.clone()))
        {
            panic!("already has membership");
        }

        let token_id: u64 = env.storage().instance().get(&NEXT_ID).unwrap_or(1);
        let nft = MembershipNft {
            owner: recipient.clone(),
            tier: tier.clone(),
            issued_at: env.ledger().timestamp(),
            metadata_uri,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Nft(token_id), &nft);
        env.storage()
            .persistent()
            .set(&DataKey::OwnerToken(recipient.clone()), &token_id);

        env.storage().instance().set(&NEXT_ID, &(token_id + 1));
        let total: u64 = env.storage().instance().get(&TOTAL_MEM).unwrap_or(0);
        env.storage().instance().set(&TOTAL_MEM, &(total + 1));

        env.events()
            .publish((symbol_short!("minted"),), (token_id, recipient, tier));

        token_id
    }

    /// Revoke (burn) a membership NFT. Admin only.
    pub fn revoke(env: Env, admin: Address, recipient: Address) {
        Self::require_admin(&env, &admin);

        let token_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerToken(recipient.clone()))
            .expect("no membership");

        env.storage()
            .persistent()
            .remove(&DataKey::Nft(token_id));
        env.storage()
            .persistent()
            .remove(&DataKey::OwnerToken(recipient.clone()));

        let total: u64 = env.storage().instance().get(&TOTAL_MEM).unwrap_or(1);
        env.storage()
            .instance()
            .set(&TOTAL_MEM, &total.saturating_sub(1));

        env.events()
            .publish((symbol_short!("revoked"),), (token_id, recipient));
    }

    // ── Access control ────────────────────────────────────────────────────

    /// Verify caller has at least `required_tier` membership.
    /// Records an access event and returns true/false.
    pub fn check_access(env: Env, caller: Address, required_tier: Tier) -> bool {
        Self::require_not_paused(&env);
        caller.require_auth();

        let has_access = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::OwnerToken(caller.clone()))
            .and_then(|token_id| {
                env.storage()
                    .persistent()
                    .get::<DataKey, MembershipNft>(&DataKey::Nft(token_id))
            })
            .map(|nft| Self::tier_level(&nft.tier) >= Self::tier_level(&required_tier))
            .unwrap_or(false);

        // Update analytics
        let mut stats: MemberStats = env
            .storage()
            .persistent()
            .get(&DataKey::Stats(caller.clone()))
            .unwrap_or(MemberStats {
                access_count: 0,
                last_access: 0,
            });
        stats.access_count += 1;
        stats.last_access = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::Stats(caller.clone()), &stats);

        env.events()
            .publish((symbol_short!("access"),), (caller, has_access));

        has_access
    }

    // ── Queries ───────────────────────────────────────────────────────────

    /// Return the NFT for a given token id.
    pub fn get_nft(env: Env, token_id: u64) -> Option<MembershipNft> {
        env.storage().persistent().get(&DataKey::Nft(token_id))
    }

    /// Return the token id owned by `owner`, if any.
    pub fn get_token_id(env: Env, owner: Address) -> Option<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnerToken(owner))
    }

    /// Return access analytics for an address.
    pub fn get_stats(env: Env, member: Address) -> Option<MemberStats> {
        env.storage().persistent().get(&DataKey::Stats(member))
    }

    /// Return total active memberships.
    pub fn total_members(env: Env) -> u64 {
        env.storage().instance().get(&TOTAL_MEM).unwrap_or(0)
    }

    /// Return whether the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED).unwrap_or(false)
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN).expect("not initialized")
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    fn require_admin(env: &Env, admin: &Address) {
        let current: Address = env.storage().instance().get(&ADMIN).expect("not initialized");
        if *admin != current {
            panic!("unauthorized");
        }
        admin.require_auth();
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&PAUSED).unwrap_or(false);
        if paused {
            panic!("contract paused");
        }
    }

    fn tier_level(tier: &Tier) -> u32 {
        match tier {
            Tier::Bronze => 1,
            Tier::Silver => 2,
            Tier::Gold => 3,
        }
    }
}

mod test;
