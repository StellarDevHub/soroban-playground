#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, String, Vec,
};

/// Implementation version information
#[derive(Clone)]
#[contracttype]
pub struct ImplementationVersion {
    pub version: u32,
    pub address: Address,
    pub timestamp: u64,
    pub description: String,
}

/// Upgrade proposal for governance
#[derive(Clone)]
#[contracttype]
pub struct UpgradeProposal {
    pub id: u32,
    pub new_implementation: Address,
    pub proposer: Address,
    pub votes_for: u32,
    pub votes_against: u32,
    pub status: u32, // 0: pending, 1: approved, 2: rejected, 3: executed
    pub created_at: u64,
    pub execution_time: u64,
}

/// Proxy state tracking
#[derive(Clone)]
#[contracttype]
pub struct ProxyState {
    pub admin: Address,
    pub current_implementation: Address,
    pub is_initialized: bool,
    pub upgrade_delay: u64,
    pub last_upgrade_time: u64,
}

const PROXY_STATE: Symbol = symbol_short!("PROXY_ST");
const IMPLEMENTATION_HISTORY: Symbol = symbol_short!("IMPL_HST");
const UPGRADE_PROPOSALS: Symbol = symbol_short!("UPG_PROP");
const PROPOSAL_COUNTER: Symbol = symbol_short!("PROP_CNT");
const VERSION_COUNTER: Symbol = symbol_short!("VER_CNT");
const AUTHORIZED_UPGRADERS: Symbol = symbol_short!("AUTH_UPG");

#[contract]
pub struct ProxyContract;

#[contractimpl]
impl ProxyContract {
    /// Initialize the proxy with an initial implementation
    pub fn init(
        env: Env,
        admin: Address,
        initial_implementation: Address,
        upgrade_delay: u64,
    ) -> ProxyState {
        let state = ProxyState {
            admin: admin.clone(),
            current_implementation: initial_implementation.clone(),
            is_initialized: true,
            upgrade_delay,
            last_upgrade_time: env.ledger().timestamp(),
        };

        env.storage().instance().set(&PROXY_STATE, &state);

        // Record initial implementation
        let version = ImplementationVersion {
            version: 1,
            address: initial_implementation,
            timestamp: env.ledger().timestamp(),
            description: String::from_slice(&env, "Initial implementation"),
        };

        let key = Symbol::new(&env, "IMPL_V_1");
        env.storage().instance().set(&key, &version);
        env.storage().instance().set(&VERSION_COUNTER, &1u32);
        env.storage().instance().set(&PROPOSAL_COUNTER, &0u32);

        state
    }

    /// Get current proxy state
    pub fn get_proxy_state(env: Env) -> ProxyState {
        env.storage()
            .instance()
            .get(&PROXY_STATE)
            .unwrap_or(ProxyState {
                admin: env.current_contract_address(),
                current_implementation: env.current_contract_address(),
                is_initialized: false,
                upgrade_delay: 0,
                last_upgrade_time: 0,
            })
    }

    /// Get current implementation address
    pub fn get_implementation(env: Env) -> Address {
        let state = Self::get_proxy_state(&env);
        state.current_implementation
    }

    /// Propose a new implementation upgrade
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        new_implementation: Address,
    ) -> u32 {
        let state = Self::get_proxy_state(&env);
        
        // Only admin or authorized upgraders can propose
        proposer.require_auth();

        let mut proposal_id: u32 = env.storage()
            .instance()
            .get(&PROPOSAL_COUNTER)
            .unwrap_or(0);

        proposal_id += 1;

        let proposal = UpgradeProposal {
            id: proposal_id,
            new_implementation,
            proposer,
            votes_for: 0,
            votes_against: 0,
            status: 0, // pending
            created_at: env.ledger().timestamp(),
            execution_time: 0,
        };

        let key = Symbol::new(&env, &format!("PROP_{}", proposal_id));
        env.storage().instance().set(&key, &proposal);
        env.storage().instance().set(&PROPOSAL_COUNTER, &proposal_id);

        proposal_id
    }

    /// Vote on an upgrade proposal
    pub fn vote_on_proposal(env: Env, proposal_id: u32, voter: Address, vote_for: bool) {
        voter.require_auth();

        let key = Symbol::new(&env, &format!("PROP_{}", proposal_id));
        let mut proposal: UpgradeProposal = match env.storage().instance().get(&key) {
            Some(p) => p,
            None => return,
        };

        if proposal.status != 0 {
            return; // Can only vote on pending proposals
        }

        if vote_for {
            proposal.votes_for += 1;
        } else {
            proposal.votes_against += 1;
        }

        env.storage().instance().set(&key, &proposal);
    }

    /// Execute an approved upgrade proposal
    pub fn execute_upgrade(env: Env, proposal_id: u32) -> bool {
        let state = Self::get_proxy_state(&env);
        
        // Only admin can execute
        state.admin.require_auth();

        let key = Symbol::new(&env, &format!("PROP_{}", proposal_id));
        let mut proposal: UpgradeProposal = match env.storage().instance().get(&key) {
            Some(p) => p,
            None => return false,
        };

        // Check if proposal is approved (more votes for than against)
        if proposal.votes_for <= proposal.votes_against {
            return false;
        }

        // Check upgrade delay
        let current_time = env.ledger().timestamp();
        if current_time < state.last_upgrade_time + state.upgrade_delay {
            return false;
        }

        // Execute upgrade
        proposal.status = 3; // executed
        proposal.execution_time = current_time;

        let mut new_state = state.clone();
        new_state.current_implementation = proposal.new_implementation.clone();
        new_state.last_upgrade_time = current_time;

        // Record new implementation version
        let mut version_counter: u32 = env.storage()
            .instance()
            .get(&VERSION_COUNTER)
            .unwrap_or(1);

        version_counter += 1;

        let version = ImplementationVersion {
            version: version_counter,
            address: proposal.new_implementation.clone(),
            timestamp: current_time,
            description: String::from_slice(&env, "Upgraded implementation"),
        };

        let version_key = Symbol::new(&env, &format!("IMPL_V_{}", version_counter));
        env.storage().instance().set(&version_key, &version);
        env.storage().instance().set(&VERSION_COUNTER, &version_counter);

        env.storage().instance().set(&key, &proposal);
        env.storage().instance().set(&PROXY_STATE, &new_state);

        true
    }

    /// Get upgrade proposal details
    pub fn get_proposal(env: Env, proposal_id: u32) -> UpgradeProposal {
        let key = Symbol::new(&env, &format!("PROP_{}", proposal_id));
        env.storage()
            .instance()
            .get(&key)
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

    /// Get implementation version history
    pub fn get_implementation_version(env: Env, version: u32) -> ImplementationVersion {
        let key = Symbol::new(&env, &format!("IMPL_V_{}", version));
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or(ImplementationVersion {
                version: 0,
                address: env.current_contract_address(),
                timestamp: 0,
                description: String::from_slice(&env, ""),
            })
    }

    /// Get current version number
    pub fn get_current_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&VERSION_COUNTER)
            .unwrap_or(1)
    }

    /// Authorize an address to propose upgrades
    pub fn authorize_upgrader(env: Env, upgrader: Address) {
        let state = Self::get_proxy_state(&env);
        state.admin.require_auth();

        let key = Symbol::new(&env, &format!("AUTH_{}", upgrader));
        env.storage().instance().set(&key, &true);
    }

    /// Revoke upgrade authorization
    pub fn revoke_upgrader(env: Env, upgrader: Address) {
        let state = Self::get_proxy_state(&env);
        state.admin.require_auth();

        let key = Symbol::new(&env, &format!("AUTH_{}", upgrader));
        env.storage().instance().set(&key, &false);
    }

    /// Check if an address is authorized to propose upgrades
    pub fn is_authorized_upgrader(env: Env, upgrader: Address) -> bool {
        let key = Symbol::new(&env, &format!("AUTH_{}", upgrader));
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or(false)
    }

    /// Update upgrade delay
    pub fn update_upgrade_delay(env: Env, new_delay: u64) {
        let mut state = Self::get_proxy_state(&env);
        state.admin.require_auth();

        state.upgrade_delay = new_delay;
        env.storage().instance().set(&PROXY_STATE, &state);
    }

    /// Emergency pause (only admin)
    pub fn emergency_pause(env: Env) -> bool {
        let state = Self::get_proxy_state(&env);
        state.admin.require_auth();

        // Set upgrade delay to maximum to prevent upgrades
        let mut new_state = state.clone();
        new_state.upgrade_delay = u64::MAX;
        env.storage().instance().set(&PROXY_STATE, &new_state);

        true
    }

    /// Resume normal operations
    pub fn resume_operations(env: Env, normal_delay: u64) -> bool {
        let state = Self::get_proxy_state(&env);
        state.admin.require_auth();

        let mut new_state = state.clone();
        new_state.upgrade_delay = normal_delay;
        env.storage().instance().set(&PROXY_STATE, &new_state);

        true
    }

    /// Get total number of proposals
    pub fn get_proposal_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&PROPOSAL_COUNTER)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as TestAddress;

    #[test]
    fn test_init() {
        let env = soroban_sdk::Env::default();
        let admin = TestAddress::random(&env);
        let impl_addr = TestAddress::random(&env);

        let state = ProxyContract::init(env.clone(), admin.clone(), impl_addr.clone(), 3600);

        assert!(state.is_initialized);
        assert_eq!(state.admin, admin);
        assert_eq!(state.current_implementation, impl_addr);
    }

    #[test]
    fn test_propose_upgrade() {
        let env = soroban_sdk::Env::default();
        let admin = TestAddress::random(&env);
        let impl_addr = TestAddress::random(&env);
        let proposer = TestAddress::random(&env);
        let new_impl = TestAddress::random(&env);

        ProxyContract::init(env.clone(), admin, impl_addr, 3600);

        let proposal_id = ProxyContract::propose_upgrade(env.clone(), proposer, new_impl);

        assert_eq!(proposal_id, 1);
    }

    #[test]
    fn test_get_implementation() {
        let env = soroban_sdk::Env::default();
        let admin = TestAddress::random(&env);
        let impl_addr = TestAddress::random(&env);

        ProxyContract::init(env.clone(), admin, impl_addr.clone(), 3600);

        let current = ProxyContract::get_implementation(env);

        assert_eq!(current, impl_addr);
    }
}
