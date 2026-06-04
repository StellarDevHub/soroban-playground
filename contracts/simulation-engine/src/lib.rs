#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec, Map,
    String, U256,
};

/// Simulation state for tracking mock environment conditions
#[derive(Clone)]
#[contracttype]
pub struct SimulationState {
    pub is_active: bool,
    pub timestamp: u64,
    pub block_height: u32,
    pub gas_available: u64,
    pub caller: Address,
}

/// Mock transaction for simulation
#[derive(Clone)]
#[contracttype]
pub struct MockTransaction {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub amount: u128,
    pub data: Vec<u8>,
    pub status: u32, // 0: pending, 1: success, 2: failed
}

/// Simulation result containing execution metrics
#[derive(Clone)]
#[contracttype]
pub struct SimulationResult {
    pub success: bool,
    pub gas_used: u64,
    pub execution_time_ms: u64,
    pub state_changes: u32,
    pub error_message: String,
}

/// Simulation configuration
#[derive(Clone)]
#[contracttype]
pub struct SimulationConfig {
    pub max_gas: u64,
    pub timeout_ms: u64,
    pub enable_state_tracking: bool,
    pub enable_gas_tracking: bool,
}

const SIMULATION_STATE: Symbol = symbol_short!("SIM_STATE");
const MOCK_TRANSACTIONS: Symbol = symbol_short!("MOCK_TXN");
const SIMULATION_RESULTS: Symbol = symbol_short!("SIM_RES");
const SIMULATION_CONFIG: Symbol = symbol_short!("SIM_CFG");
const TRANSACTION_COUNTER: Symbol = symbol_short!("TXN_CNT");

#[contract]
pub struct SimulationEngine;

#[contractimpl]
impl SimulationEngine {
    /// Initialize the simulation engine with default configuration
    pub fn init(env: Env, caller: Address) -> SimulationState {
        let state = SimulationState {
            is_active: true,
            timestamp: env.ledger().timestamp(),
            block_height: env.ledger().sequence(),
            gas_available: 1_000_000,
            caller: caller.clone(),
        };

        env.storage().instance().set(&SIMULATION_STATE, &state);

        let config = SimulationConfig {
            max_gas: 1_000_000,
            timeout_ms: 30_000,
            enable_state_tracking: true,
            enable_gas_tracking: true,
        };

        env.storage().instance().set(&SIMULATION_CONFIG, &config);
        env.storage().instance().set(&TRANSACTION_COUNTER, &0u32);

        state
    }

    /// Get current simulation state
    pub fn get_state(env: Env) -> SimulationState {
        env.storage()
            .instance()
            .get(&SIMULATION_STATE)
            .unwrap_or_else(|| SimulationState {
                is_active: false,
                timestamp: 0,
                block_height: 0,
                gas_available: 0,
                caller: env.current_contract_address(),
            })
    }

    /// Create a mock transaction for simulation
    pub fn create_mock_transaction(
        env: Env,
        from: Address,
        to: Address,
        amount: u128,
        data: Vec<u8>,
    ) -> u32 {
        let mut counter: u32 = env.storage()
            .instance()
            .get(&TRANSACTION_COUNTER)
            .unwrap_or(0);

        counter += 1;

        let tx = MockTransaction {
            id: counter,
            from,
            to,
            amount,
            data,
            status: 0, // pending
        };

        let key = Symbol::new(&env, &format!("TXN_{}", counter));
        env.storage().instance().set(&key, &tx);
        env.storage().instance().set(&TRANSACTION_COUNTER, &counter);

        counter
    }

    /// Execute a mock transaction and return simulation result
    pub fn execute_mock_transaction(env: Env, tx_id: u32) -> SimulationResult {
        let key = Symbol::new(&env, &format!("TXN_{}", tx_id));
        
        let mut tx: MockTransaction = match env.storage().instance().get(&key) {
            Some(t) => t,
            None => {
                return SimulationResult {
                    success: false,
                    gas_used: 0,
                    execution_time_ms: 0,
                    state_changes: 0,
                    error_message: String::from_slice(&env, "Transaction not found"),
                }
            }
        };

        let start_time = env.ledger().timestamp();
        let config: SimulationConfig = env.storage()
            .instance()
            .get(&SIMULATION_CONFIG)
            .unwrap_or(SimulationConfig {
                max_gas: 1_000_000,
                timeout_ms: 30_000,
                enable_state_tracking: true,
                enable_gas_tracking: true,
            });

        // Simulate transaction execution
        let gas_used = Self::calculate_gas_usage(&env, &tx);
        let mut state = Self::get_state(&env);

        let success = if gas_used <= config.max_gas && state.gas_available >= gas_used {
            state.gas_available -= gas_used;
            tx.status = 1; // success
            true
        } else {
            tx.status = 2; // failed
            false
        };

        env.storage().instance().set(&key, &tx);
        env.storage().instance().set(&SIMULATION_STATE, &state);

        let execution_time_ms = (env.ledger().timestamp() - start_time) as u64;

        SimulationResult {
            success,
            gas_used,
            execution_time_ms,
            state_changes: if success { 1 } else { 0 },
            error_message: if success {
                String::from_slice(&env, "")
            } else {
                String::from_slice(&env, "Insufficient gas or state")
            },
        }
    }

    /// Get mock transaction details
    pub fn get_mock_transaction(env: Env, tx_id: u32) -> MockTransaction {
        let key = Symbol::new(&env, &format!("TXN_{}", tx_id));
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or(MockTransaction {
                id: 0,
                from: env.current_contract_address(),
                to: env.current_contract_address(),
                amount: 0,
                data: Vec::new(&env),
                status: 0,
            })
    }

    /// Simulate state change and track it
    pub fn simulate_state_change(env: Env, key: Symbol, value: u128) -> bool {
        let config: SimulationConfig = env.storage()
            .instance()
            .get(&SIMULATION_CONFIG)
            .unwrap_or(SimulationConfig {
                max_gas: 1_000_000,
                timeout_ms: 30_000,
                enable_state_tracking: true,
                enable_gas_tracking: true,
            });

        if !config.enable_state_tracking {
            return false;
        }

        let mut state = Self::get_state(&env);
        state.timestamp = env.ledger().timestamp();

        env.storage().instance().set(&key, &value);
        env.storage().instance().set(&SIMULATION_STATE, &state);

        true
    }

    /// Reset simulation to initial state
    pub fn reset_simulation(env: Env) {
        let caller = Self::get_state(&env).caller;
        
        let state = SimulationState {
            is_active: true,
            timestamp: env.ledger().timestamp(),
            block_height: env.ledger().sequence(),
            gas_available: 1_000_000,
            caller,
        };

        env.storage().instance().set(&SIMULATION_STATE, &state);
        env.storage().instance().set(&TRANSACTION_COUNTER, &0u32);
    }

    /// Update simulation configuration
    pub fn update_config(env: Env, max_gas: u64, timeout_ms: u64) {
        let config = SimulationConfig {
            max_gas,
            timeout_ms,
            enable_state_tracking: true,
            enable_gas_tracking: true,
        };

        env.storage().instance().set(&SIMULATION_CONFIG, &config);
    }

    /// Get current simulation configuration
    pub fn get_config(env: Env) -> SimulationConfig {
        env.storage()
            .instance()
            .get(&SIMULATION_CONFIG)
            .unwrap_or(SimulationConfig {
                max_gas: 1_000_000,
                timeout_ms: 30_000,
                enable_state_tracking: true,
                enable_gas_tracking: true,
            })
    }

    /// Calculate gas usage for a transaction (mock calculation)
    fn calculate_gas_usage(env: &Env, tx: &MockTransaction) -> u64 {
        let base_gas = 21_000u64;
        let data_gas = (tx.data.len() as u64) * 16;
        let amount_gas = if tx.amount > 0 { 9_000 } else { 0 };

        base_gas + data_gas + amount_gas
    }

    /// Batch execute multiple mock transactions
    pub fn batch_execute_transactions(env: Env, tx_ids: Vec<u32>) -> Vec<SimulationResult> {
        let mut results = Vec::new(&env);

        for tx_id in tx_ids.iter() {
            let result = Self::execute_mock_transaction(&env, tx_id);
            results.push_back(result);
        }

        results
    }

    /// Get simulation metrics
    pub fn get_metrics(env: Env) -> (u64, u32, u64) {
        let state = Self::get_state(&env);
        let counter: u32 = env.storage()
            .instance()
            .get(&TRANSACTION_COUNTER)
            .unwrap_or(0);

        (state.gas_available, counter, state.timestamp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as TestAddress;

    #[test]
    fn test_init() {
        let env = soroban_sdk::Env::default();
        let caller = TestAddress::random(&env);
        
        let state = SimulationEngine::init(env.clone(), caller.clone());
        
        assert!(state.is_active);
        assert_eq!(state.gas_available, 1_000_000);
    }

    #[test]
    fn test_create_mock_transaction() {
        let env = soroban_sdk::Env::default();
        let caller = TestAddress::random(&env);
        let from = TestAddress::random(&env);
        let to = TestAddress::random(&env);

        SimulationEngine::init(env.clone(), caller);

        let tx_id = SimulationEngine::create_mock_transaction(
            env.clone(),
            from,
            to,
            1000,
            Vec::new(&env),
        );

        assert_eq!(tx_id, 1);
    }

    #[test]
    fn test_execute_mock_transaction() {
        let env = soroban_sdk::Env::default();
        let caller = TestAddress::random(&env);
        let from = TestAddress::random(&env);
        let to = TestAddress::random(&env);

        SimulationEngine::init(env.clone(), caller);

        let tx_id = SimulationEngine::create_mock_transaction(
            env.clone(),
            from,
            to,
            1000,
            Vec::new(&env),
        );

        let result = SimulationEngine::execute_mock_transaction(env.clone(), tx_id);

        assert!(result.success);
        assert!(result.gas_used > 0);
    }
}
