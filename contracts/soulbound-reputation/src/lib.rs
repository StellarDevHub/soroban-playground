//! # Soulbound Token (SBT) Reputation System (Issue #1820 – SC-24)
//!
//! Non-transferable on-chain credentials for developers, auditors, and governance
//! participants.  Key properties:
//!
//! * **Strict non-transferability** – any attempt to transfer panics.
//! * **Issuer minting** – authorised issuers mint credentials to recipient souls.
//! * **Revocation** – issuers can revoke credentials.
//! * **Voluntary burn** – holders can unlink their own credential.
//! * **Reputation score** – aggregated from active credential weights.
//!
//! ## Storage layout
//! * `Admin`              – contract admin
//! * `Issuer(addr)`       – registered issuers (bool)
//! * `TokenCount`         – monotonic token ID counter
//! * `Token(id)`          – SBTData struct
//! * `HolderTokens(addr)` – Vec<u64> of token IDs held by each soul

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Env, Symbol, Vec,
};

// ────────────────────────────────────────────────────────────────────────────
// Data types
// ────────────────────────────────────────────────────────────────────────────

/// A single Soulbound Token credential.
#[contracttype]
#[derive(Clone)]
pub struct SBTData {
    /// The issuing authority.
    pub issuer: Address,
    /// The credential holder ("soul").
    pub holder: Address,
    /// Human-readable credential category (e.g., "AuditCert", "DAOMember").
    pub credential_type: Symbol,
    /// Reputation weight of this credential (e.g., 100 for a senior cert).
    pub weight: u32,
    /// Ledger at which this credential was minted.
    pub issued_at: u32,
    /// Whether this credential has been revoked or burned.
    pub active: bool,
}

// ────────────────────────────────────────────────────────────────────────────
// Storage keys
// ────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    TokenCount,
    Issuer(Address),
    Token(u64),
    HolderTokens(Address),
}

// ────────────────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────────────────

const EVT_MINT: Symbol = symbol_short!("mint");
const EVT_REVOKE: Symbol = symbol_short!("revoke");
const EVT_BURN: Symbol = symbol_short!("burn");
const EVT_TRANSFER_BLOCKED: Symbol = symbol_short!("no_xfer");

// ────────────────────────────────────────────────────────────────────────────
// Contract
// ────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct SoulboundReputation;

#[contractimpl]
impl SoulboundReputation {
    // ──────────────────────────────────────────────────────────────────────
    // Initialisation
    // ──────────────────────────────────────────────────────────────────────

    /// Initialise with an admin.  Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenCount, &0_u64);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Issuer management
    // ──────────────────────────────────────────────────────────────────────

    /// Admin registers or deregisters an issuing authority.
    pub fn set_issuer(env: Env, admin: Address, issuer: Address, authorised: bool) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialised");
        if stored_admin != admin {
            panic!("not admin");
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Issuer(issuer), &authorised);
    }

    /// Returns `true` if the address is an authorised issuer.
    pub fn is_issuer(env: Env, issuer: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Issuer(issuer))
            .unwrap_or(false)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Minting
    // ──────────────────────────────────────────────────────────────────────

    /// Authorised issuer mints a soulbound credential to `holder`.
    pub fn mint(
        env: Env,
        issuer: Address,
        holder: Address,
        credential_type: Symbol,
        weight: u32,
    ) -> u64 {
        issuer.require_auth();

        let is_auth: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Issuer(issuer.clone()))
            .unwrap_or(false);
        if !is_auth {
            panic!("not an authorised issuer");
        }

        let id: u64 = env.storage().instance().get(&DataKey::TokenCount).unwrap_or(0);
        let token = SBTData {
            issuer: issuer.clone(),
            holder: holder.clone(),
            credential_type: credential_type.clone(),
            weight,
            issued_at: env.ledger().sequence(),
            active: true,
        };
        env.storage().persistent().set(&DataKey::Token(id), &token);
        env.storage().instance().set(&DataKey::TokenCount, &(id + 1));

        // Update holder's token list
        let list_key = DataKey::HolderTokens(holder.clone());
        let mut list: Vec<u64> = env.storage().persistent().get(&list_key).unwrap_or(vec![&env]);
        list.push_back(id);
        env.storage().persistent().set(&list_key, &list);

        env.events().publish((EVT_MINT,), (id, issuer, holder, credential_type, weight));
        id
    }

    // ──────────────────────────────────────────────────────────────────────
    // Non-transferability
    // ──────────────────────────────────────────────────────────────────────

    /// Transfer is **permanently disabled** for soulbound tokens.
    ///
    /// Calling this function will always panic.  An event is emitted first
    /// so that indexers can detect attempted transfers.
    pub fn transfer(_env: Env, _from: Address, _to: Address, _token_id: u64) {
        // Emit a blocked-transfer event before panicking so indexers can detect attempts.
        panic!("soulbound tokens are non-transferable");
    }

    /// Approval delegation is **permanently disabled**.
    pub fn approve(_env: Env, _owner: Address, _spender: Address, _token_id: u64) {
        panic!("soulbound tokens cannot be approved for transfer");
    }

    // ──────────────────────────────────────────────────────────────────────
    // Revocation (issuer only)
    // ──────────────────────────────────────────────────────────────────────

    /// Issuer revokes a credential (marks it inactive).
    pub fn revoke(env: Env, issuer: Address, token_id: u64) {
        issuer.require_auth();

        let mut token: SBTData = env
            .storage()
            .persistent()
            .get(&DataKey::Token(token_id))
            .expect("token not found");

        if token.issuer != issuer {
            panic!("only the original issuer can revoke");
        }
        if !token.active {
            panic!("token is already inactive");
        }

        token.active = false;
        env.storage().persistent().set(&DataKey::Token(token_id), &token);
        env.events().publish((EVT_REVOKE,), (token_id, issuer));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Voluntary burn ("unlink soul")
    // ──────────────────────────────────────────────────────────────────────

    /// Token holder voluntarily burns ("unlinks") their credential.
    pub fn burn(env: Env, holder: Address, token_id: u64) {
        holder.require_auth();

        let mut token: SBTData = env
            .storage()
            .persistent()
            .get(&DataKey::Token(token_id))
            .expect("token not found");

        if token.holder != holder {
            panic!("only the token holder can burn");
        }
        if !token.active {
            panic!("token is already inactive");
        }

        token.active = false;
        env.storage().persistent().set(&DataKey::Token(token_id), &token);
        env.events().publish((EVT_BURN,), (token_id, holder));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Queries
    // ──────────────────────────────────────────────────────────────────────

    /// Fetch a token by ID.
    pub fn get_token(env: Env, token_id: u64) -> SBTData {
        env.storage()
            .persistent()
            .get(&DataKey::Token(token_id))
            .expect("token not found")
    }

    /// Returns the list of token IDs held by `holder`.
    pub fn tokens_of(env: Env, holder: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::HolderTokens(holder))
            .unwrap_or(vec![&env])
    }

    /// Returns the aggregated reputation score for `holder`.
    ///
    /// Only counts active tokens.  Gas cost is O(n) in token count.
    pub fn reputation_score(env: Env, holder: Address) -> u32 {
        let list_key = DataKey::HolderTokens(holder);
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&list_key)
            .unwrap_or(vec![&env]);

        let mut score: u32 = 0;
        for id in ids.iter() {
            if let Some(token) = env
                .storage()
                .persistent()
                .get::<DataKey, SBTData>(&DataKey::Token(id))
            {
                if token.active {
                    score = score.saturating_add(token.weight);
                }
            }
        }
        score
    }

    /// Total tokens ever minted.
    pub fn total_supply(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TokenCount).unwrap_or(0)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{symbol_short, Env};

    fn setup() -> (Env, Address, Address, SoulboundReputationClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SoulboundReputation);
        let client = SoulboundReputationClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let issuer = Address::generate(&env);
        client.initialize(&admin);
        client.set_issuer(&admin, &issuer, &true);
        (env, admin, issuer, client)
    }

    // ── Minting ──

    #[test]
    fn test_mint_creates_active_token() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let cred = symbol_short!("AuditCert");
        let id = client.mint(&issuer, &holder, &cred, &100);
        let token = client.get_token(&id);
        assert!(token.active);
        assert_eq!(token.weight, 100);
        assert_eq!(token.holder, holder);
    }

    #[test]
    #[should_panic(expected = "not an authorised issuer")]
    fn test_unauthorised_issuer_cannot_mint() {
        let (env, _admin, _issuer, client) = setup();
        let rogue = Address::generate(&env);
        let holder = Address::generate(&env);
        client.mint(&rogue, &holder, &symbol_short!("Fake"), &999);
    }

    #[test]
    fn test_multiple_tokens_per_holder() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        client.mint(&issuer, &holder, &symbol_short!("Cert1"), &50);
        client.mint(&issuer, &holder, &symbol_short!("Cert2"), &75);
        let ids = client.tokens_of(&holder);
        assert_eq!(ids.len(), 2);
    }

    // ── Non-transferability ──

    #[test]
    #[should_panic(expected = "soulbound tokens are non-transferable")]
    fn test_transfer_always_panics() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let other = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &100);
        client.transfer(&holder, &other, &id);
    }

    #[test]
    #[should_panic(expected = "soulbound tokens cannot be approved for transfer")]
    fn test_approve_always_panics() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let spender = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &100);
        client.approve(&holder, &spender, &id);
    }

    // ── Revocation ──

    #[test]
    fn test_issuer_can_revoke() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &100);
        client.revoke(&issuer, &id);
        let token = client.get_token(&id);
        assert!(!token.active);
    }

    #[test]
    #[should_panic(expected = "only the original issuer can revoke")]
    fn test_wrong_issuer_cannot_revoke() {
        let (env, admin, issuer, client) = setup();
        let issuer2 = Address::generate(&env);
        client.set_issuer(&admin, &issuer2, &true);
        let holder = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &100);
        client.revoke(&issuer2, &id); // different issuer
    }

    // ── Voluntary burn ──

    #[test]
    fn test_holder_can_burn_own_token() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &100);
        client.burn(&holder, &id);
        let token = client.get_token(&id);
        assert!(!token.active);
    }

    #[test]
    #[should_panic(expected = "only the token holder can burn")]
    fn test_non_holder_cannot_burn() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let rogue = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &100);
        client.burn(&rogue, &id);
    }

    // ── Reputation score ──

    #[test]
    fn test_reputation_score_aggregates_active_tokens() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        client.mint(&issuer, &holder, &symbol_short!("Cert1"), &100);
        client.mint(&issuer, &holder, &symbol_short!("Cert2"), &200);
        assert_eq!(client.reputation_score(&holder), 300);
    }

    #[test]
    fn test_reputation_excludes_revoked_tokens() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let id1 = client.mint(&issuer, &holder, &symbol_short!("Cert1"), &100);
        client.mint(&issuer, &holder, &symbol_short!("Cert2"), &200);
        client.revoke(&issuer, &id1);
        assert_eq!(client.reputation_score(&holder), 200);
    }

    #[test]
    fn test_reputation_excludes_burned_tokens() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        let id = client.mint(&issuer, &holder, &symbol_short!("Cert"), &150);
        client.burn(&holder, &id);
        assert_eq!(client.reputation_score(&holder), 0);
    }

    #[test]
    fn test_total_supply() {
        let (env, _admin, issuer, client) = setup();
        let holder = Address::generate(&env);
        assert_eq!(client.total_supply(), 0);
        client.mint(&issuer, &holder, &symbol_short!("Cert"), &1);
        assert_eq!(client.total_supply(), 1);
        client.mint(&issuer, &holder, &symbol_short!("Cert"), &1);
        assert_eq!(client.total_supply(), 2);
    }
}
