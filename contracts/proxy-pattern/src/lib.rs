// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Upgradeable Contract Proxy Pattern
//!
//! A governance-aware proxy contract that stores the current implementation
//! address on-chain and allows the admin to propose, vote on, and execute
//! upgrades with an optional time-delay guard.
//!
//! ## Lifecycle
//! 1. Admin calls `init` with an initial implementation address and an
//!    `upgrade_delay` (seconds).
//! 2. Any authorised proposer calls `propose_upgrade`; a proposal is recorded.
//! 3. Token-holders call `vote_on_proposal`.
//! 4. Once `votes_for > votes_against` **and** the upgrade delay has elapsed,
//!    admin calls `execute_upgrade`.
//! 5. Admin may `emergency_pause` / `resume_operations` at any time.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol,
};

// ── Storage-key types ─────────────────────────────────────────────────────────

/// Top-level singleton keys (no payload).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Serialised `ProxyState`.
    ProxyState,
    /// Running count of proposals (u32).
    ProposalCounter,
    /// Running count of recorded implementation versions (u32).
    VersionCounter,
}

/// Per-proposal storage key.
#[contracttype]
#[derive(Clone)]
pub enum ProposalKey {
    Proposal(u32),
}

/// Per-version storage key.
#[contracttype]
#[derive(Clone)]
pub enum VersionKey {
    ImplVersion(u32),
}

/// Per-address authorisation key.
#[contracttype]
#[derive(Clone)]
pub enum AuthKey {
    Upgrader(Address),
}

// ── Public data structures ────────────────────────────────────────────────────

/// Metadata about a recorded implementation version.
#[derive(Clone)]
#[contracttype]
pub struct ImplementationVersion {
    pub version: u32,
    pub address: Address,
    pub timestamp: u64,
    pub description: String,
}

/// An upgrade proposal subject to governance voting.
#[derive(Clone)]
#[contracttype]
pub struct UpgradeProposal {
    pub id: u32,
    pub new_implementation: Address,
    pub proposer: Address,
    pub votes_for: u32,
    pub votes_against: u32,
    /// 0 = pending, 1 = approved, 2 = rejected, 3 = executed.
    pub status: u32,
    pub created_at: u64,
    pub execution_time: u64,
}

/// Singleton state held by the proxy.
#[derive(Clone)]
#[contracttype]
pub struct ProxyState {
    pub admin: Address,
    pub current_implementation: Address,
    pub is_initialized: bool,
    pub upgrade_delay: u64,
    pub last_upgrade_time: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ProxyContract;

#[contractimpl]
impl ProxyContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the proxy with an initial implementation address.
    ///
    /// `upgrade_delay`: seconds that must elapse between upgrades.
    pub fn init(
        env: Env,
        admin: Address,
        initial_implementation: Address,
        upgrade_delay: u64,
    ) -> ProxyState {
        // Admin must authorise this call.
        admin.require_auth();

        let state = ProxyState {
            admin: admin.clone(),
            current_implementation: initial_implementation.clone(),
            is_initialized: true,
            upgrade_delay,
            last_upgrade_time: env.ledger().timestamp(),
        };

        env.storage().instance().set(&DataKey::ProxyState, &state);

        // Record version 1.
        let version = ImplementationVersion {
            version: 1,
            address: initial_implementation,
            timestamp: env.ledger().timestamp(),
            description: String::from_str(&env, "Initial implementation"),
        };
        env.storage()
            .instance()
            .set(&VersionKey::ImplVersion(1), &version);
        env.storage()
            .instance()
            .set(&DataKey::VersionCounter, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &0u32);

        env.events()
            .publish((symbol_short!("init"),), admin.clone());

        state
    }

    // ── Read helpers ──────────────────────────────────────────────────────────

    /// Return the current proxy state.
    pub fn get_proxy_state(env: Env) -> ProxyState {
        Self::load_state(&env)
    }

    /// Return the address of the current implementation.
    pub fn get_implementation(env: Env) -> Address {
        Self::load_state(&env).current_implementation
    }

    /// Return the current implementation version number.
    pub fn get_current_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::VersionCounter)
            .unwrap_or(1)
    }

    /// Return the total number of proposals created.
    pub fn get_proposal_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0)
    }

    /// Return a specific upgrade proposal.
    pub fn get_proposal(env: Env, proposal_id: u32) -> UpgradeProposal {
        env.storage()
            .instance()
            .get(&ProposalKey::Proposal(proposal_id))
            .unwrap_or(UpgradeProposal {
                id: 0,
                new_implementation: env.current_contract_address(),
                proposer: env.current_contract_address(),
                votes_for: 0,
                votes_against: 0,
                status: 0,
                created_at: 0,
                execution_time: 0,
            })
    }

    /// Return a recorded implementation version by version number.
    pub fn get_implementation_version(env: Env, version: u32) -> ImplementationVersion {
        env.storage()
            .instance()
            .get(&VersionKey::ImplVersion(version))
            .unwrap_or(ImplementationVersion {
                version: 0,
                address: env.current_contract_address(),
                timestamp: 0,
                description: String::from_str(&env, ""),
            })
    }

    /// Return whether an address is authorised to propose upgrades.
    pub fn is_authorized_upgrader(env: Env, upgrader: Address) -> bool {
        env.storage()
            .instance()
            .get(&AuthKey::Upgrader(upgrader))
            .unwrap_or(false)
    }

    // ── Governance ────────────────────────────────────────────────────────────

    /// Create a new upgrade proposal.  
    /// Only the admin or an authorised upgrader may call this.
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        new_implementation: Address,
    ) -> u32 {
        proposer.require_auth();

        // Verify proposer is admin or an authorised upgrader.
        let state = Self::load_state(&env);
        let is_admin = state.admin == proposer;
        let is_upgrader: bool = env
            .storage()
            .instance()
            .get(&AuthKey::Upgrader(proposer.clone()))
            .unwrap_or(false);
        assert!(is_admin || is_upgrader, "not authorised to propose");

        let mut proposal_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
        proposal_id += 1;

        let proposal = UpgradeProposal {
            id: proposal_id,
            new_implementation,
            proposer,
            votes_for: 0,
            votes_against: 0,
            status: 0,
            created_at: env.ledger().timestamp(),
            execution_time: 0,
        };

        env.storage()
            .instance()
            .set(&ProposalKey::Proposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &proposal_id);

        env.events()
            .publish((symbol_short!("proposed"),), proposal_id);

        proposal_id
    }

    /// Cast a vote on a pending proposal.
    pub fn vote_on_proposal(env: Env, proposal_id: u32, voter: Address, vote_for: bool) {
        voter.require_auth();

        let key = ProposalKey::Proposal(proposal_id);
        let mut proposal: UpgradeProposal =
            match env.storage().instance().get(&key) {
                Some(p) => p,
                None => return,
            };

        if proposal.status != 0 {
            return; // only pending proposals can be voted on
        }

        if vote_for {
            proposal.votes_for += 1;
        } else {
            proposal.votes_against += 1;
        }

        env.storage().instance().set(&key, &proposal);
    }

    /// Execute an approved upgrade after the upgrade delay has elapsed.
    ///
    /// Returns `true` on success, `false` if preconditions are not met.
    pub fn execute_upgrade(env: Env, proposal_id: u32) -> bool {
        let state = Self::load_state(&env);
        state.admin.require_auth();

        let key = ProposalKey::Proposal(proposal_id);
        let mut proposal: UpgradeProposal =
            match env.storage().instance().get(&key) {
                Some(p) => p,
                None => return false,
            };

        // Require simple majority.
        if proposal.votes_for <= proposal.votes_against {
            return false;
        }

        // Enforce upgrade delay.
        let current_time = env.ledger().timestamp();
        if current_time < state.last_upgrade_time + state.upgrade_delay {
            return false;
        }

        proposal.status = 3; // executed
        proposal.execution_time = current_time;

        // Bump version counter.
        let mut version_counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VersionCounter)
            .unwrap_or(1);
        version_counter += 1;

        let version = ImplementationVersion {
            version: version_counter,
            address: proposal.new_implementation.clone(),
            timestamp: current_time,
            description: String::from_str(&env, "Governance upgrade"),
        };
        env.storage()
            .instance()
            .set(&VersionKey::ImplVersion(version_counter), &version);
        env.storage()
            .instance()
            .set(&DataKey::VersionCounter, &version_counter);

        // Update proxy state.
        let new_state = ProxyState {
            admin: state.admin,
            current_implementation: proposal.new_implementation.clone(),
            is_initialized: true,
            upgrade_delay: state.upgrade_delay,
            last_upgrade_time: current_time,
        };
        env.storage().instance().set(&key, &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProxyState, &new_state);

        env.events()
            .publish((symbol_short!("upgraded"),), proposal.new_implementation);

        true
    }

    // ── Admin management ──────────────────────────────────────────────────────

    /// Grant an address the right to propose upgrades.
    pub fn authorize_upgrader(env: Env, upgrader: Address) {
        Self::load_state(&env).admin.require_auth();
        env.storage()
            .instance()
            .set(&AuthKey::Upgrader(upgrader), &true);
    }

    /// Revoke an address's right to propose upgrades.
    pub fn revoke_upgrader(env: Env, upgrader: Address) {
        Self::load_state(&env).admin.require_auth();
        env.storage()
            .instance()
            .set(&AuthKey::Upgrader(upgrader), &false);
    }

    /// Change the required upgrade delay (seconds).
    pub fn update_upgrade_delay(env: Env, new_delay: u64) {
        let mut state = Self::load_state(&env);
        state.admin.require_auth();
        state.upgrade_delay = new_delay;
        env.storage()
            .instance()
            .set(&DataKey::ProxyState, &state);
    }

    // ── Emergency controls ────────────────────────────────────────────────────

    /// Set upgrade delay to `u64::MAX` to freeze all future upgrades.
    pub fn emergency_pause(env: Env) -> bool {
        let mut state = Self::load_state(&env);
        state.admin.require_auth();
        state.upgrade_delay = u64::MAX;
        env.storage()
            .instance()
            .set(&DataKey::ProxyState, &state);
        env.events().publish((symbol_short!("paused"),), ());
        true
    }

    /// Restore normal operations with a specified upgrade delay.
    pub fn resume_operations(env: Env, normal_delay: u64) -> bool {
        let mut state = Self::load_state(&env);
        state.admin.require_auth();
        state.upgrade_delay = normal_delay;
        env.storage()
            .instance()
            .set(&DataKey::ProxyState, &state);
        env.events().publish((symbol_short!("resumed"),), ());
        true
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn load_state(env: &Env) -> ProxyState {
        env.storage()
            .instance()
            .get(&DataKey::ProxyState)
            .unwrap_or(ProxyState {
                admin: env.current_contract_address(),
                current_implementation: env.current_contract_address(),
                is_initialized: false,
                upgrade_delay: 0,
                last_upgrade_time: 0,
            })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let impl_addr = Address::generate(&env);
        (env, admin, impl_addr)
    }

    #[test]
    fn test_init_sets_state() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        let state = client.init(&admin, &impl_addr, &3600u64);

        assert!(state.is_initialized);
        assert_eq!(state.admin, admin);
        assert_eq!(state.current_implementation, impl_addr);
        assert_eq!(state.upgrade_delay, 3600u64);
    }

    #[test]
    fn test_get_implementation_returns_initial() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        assert_eq!(client.get_implementation(), impl_addr);
    }

    #[test]
    fn test_propose_upgrade_increments_counter() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        let new_impl = Address::generate(&env);
        let proposal_id = client.propose_upgrade(&admin, &new_impl);

        assert_eq!(proposal_id, 1u32);
        assert_eq!(client.get_proposal_count(), 1u32);
    }

    #[test]
    fn test_vote_increments_votes_for() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        let new_impl = Address::generate(&env);
        let pid = client.propose_upgrade(&admin, &new_impl);

        let voter = Address::generate(&env);
        client.vote_on_proposal(&pid, &voter, &true);

        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.votes_for, 1u32);
    }

    #[test]
    fn test_execute_upgrade_no_majority_returns_false() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        let new_impl = Address::generate(&env);
        let pid = client.propose_upgrade(&admin, &new_impl);

        // No votes cast → votes_for == votes_against == 0, condition is <=.
        assert!(!client.execute_upgrade(&pid));
    }

    #[test]
    fn test_execute_upgrade_delay_not_elapsed_returns_false() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        // 9999-second upgrade delay.
        client.init(&admin, &impl_addr, &9999u64);
        let new_impl = Address::generate(&env);
        let pid = client.propose_upgrade(&admin, &new_impl);

        let voter = Address::generate(&env);
        client.vote_on_proposal(&pid, &voter, &true);

        // Delay has not elapsed → should return false.
        assert!(!client.execute_upgrade(&pid));
    }

    #[test]
    fn test_emergency_pause_sets_max_delay() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        assert!(client.emergency_pause());

        let state = client.get_proxy_state();
        assert_eq!(state.upgrade_delay, u64::MAX);
    }

    #[test]
    fn test_resume_operations_restores_delay() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        client.emergency_pause();
        client.resume_operations(&600u64);

        let state = client.get_proxy_state();
        assert_eq!(state.upgrade_delay, 600u64);
    }

    #[test]
    fn test_authorize_and_revoke_upgrader() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        let upgrader = Address::generate(&env);

        client.authorize_upgrader(&upgrader);
        assert!(client.is_authorized_upgrader(&upgrader));

        client.revoke_upgrader(&upgrader);
        assert!(!client.is_authorized_upgrader(&upgrader));
    }

    #[test]
    fn test_version_counter_starts_at_one() {
        let (env, admin, impl_addr) = setup();
        let contract_id = env.register_contract(None, ProxyContract);
        let client = ProxyContractClient::new(&env, &contract_id);

        client.init(&admin, &impl_addr, &0u64);
        assert_eq!(client.get_current_version(), 1u32);
    }
}
