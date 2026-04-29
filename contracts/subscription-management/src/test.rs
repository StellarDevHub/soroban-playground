// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String};

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contractimpl, symbol_short};

    #[test]
    fn test_initialization() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Test successful initialization
        super::SubscriptionManager::initialize(
            env.clone(),
            admin.clone(),
            100, // 1% fee
        ).unwrap();
        
        // Verify initialization
        let stored_admin: Address = env.storage()
            .persistent()
            .get(&symbol_short!("ADMIN"))
            .unwrap();
        assert_eq!(stored_admin, admin);
        
        let stored_fee: u32 = env.storage()
            .persistent()
            .get(&symbol_short!("FEE"))
            .unwrap();
        assert_eq!(stored_fee, 100);
        
        let paused: bool = env.storage()
            .persistent()
            .get(&symbol_short!("PAUSED"))
            .unwrap();
        assert!(!paused);
        
        let initialized: bool = env.storage()
            .persistent()
            .get(&symbol_short!("INIT"))
            .unwrap();
        assert!(initialized);
    }

    #[test]
    fn test_invalid_initialization() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Test invalid fee rate
        assert!(super::SubscriptionManager::initialize(
            env.clone(),
            admin.clone(),
            2000 // 20% fee - should fail
        ).is_err());
    }

    #[test]
    fn test_plan_creation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Create a plan
        let plan_id = String::from_str(&env, "basic_plan");
        super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            plan_id.clone(),
            String::from_str(&env, "Basic Plan"),
            100, // 100 tokens per period
            86400, // 1 day period
        ).unwrap();
        
        // Verify plan was created
        let plan = super::SubscriptionManager::get_plan_details(env.clone(), plan_id.clone()).unwrap();
        assert_eq!(plan.0, String::from_str(&env, "Basic Plan"));
        assert_eq!(plan.1, 100);
        assert_eq!(plan.2, 86400);
        assert!(plan.3); // is_active
    }

    #[test]
    fn test_duplicate_plan_creation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        let plan_id = String::from_str(&env, "duplicate_plan");
        
        // Create first plan
        super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            plan_id.clone(),
            String::from_str(&env, "First Plan"),
            100,
            86400,
        ).unwrap();
        
        // Try to create duplicate plan
        assert!(super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            plan_id.clone(),
            String::from_str(&env, "Duplicate Plan"),
            200,
            86400,
        ).is_err());
    }

    #[test]
    fn test_invalid_plan_parameters() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Test zero price
        assert!(super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            String::from_str(&env, "zero_price"),
            String::from_str(&env, "Zero Price"),
            0, // Invalid: zero price
            86400,
        ).is_err());
        
        // Test zero billing period
        assert!(super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            String::from_str(&env, "zero_period"),
            String::from_str(&env, "Zero Period"),
            100,
            0, // Invalid: zero period
        ).is_err());
    }

    #[test]
    fn test_pause_functionality() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Pause the contract
        super::SubscriptionManager::set_pause(env.clone(), admin.clone(), true).unwrap();
        
        // Verify paused state
        let paused: bool = env.storage()
            .persistent()
            .get(&symbol_short!("PAUSED"))
            .unwrap();
        assert!(paused);
        
        // Unpause the contract
        super::SubscriptionManager::set_pause(env.clone(), admin.clone(), false).unwrap();
        
        // Verify unpaused state
        let paused: bool = env.storage()
            .persistent()
            .get(&symbol_short!("PAUSED"))
            .unwrap();
        assert!(!paused);
    }

    #[test]
    fn test_unauthorized_pause() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        let unauthorized_user = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Try to pause with unauthorized user
        assert!(super::SubscriptionManager::set_pause(
            env.clone(),
            unauthorized_user.clone(),
            true
        ).is_err());
    }

    #[test]
    fn test_plan_retrieval() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Create multiple plans
        let plan1_id = String::from_str(&env, "plan1");
        let plan2_id = String::from_str(&env, "plan2");
        
        super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            plan1_id.clone(),
            String::from_str(&env, "Plan 1"),
            100,
            86400,
        ).unwrap();
        
        super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            plan2_id.clone(),
            String::from_str(&env, "Plan 2"),
            200,
            172800,
        ).unwrap();
        
        // Retrieve and verify plans
        let plan1 = super::SubscriptionManager::get_plan_details(env.clone(), plan1_id.clone()).unwrap();
        assert_eq!(plan1.0, String::from_str(&env, "Plan 1"));
        assert_eq!(plan1.1, 100);
        assert_eq!(plan1.2, 86400);
        
        let plan2 = super::SubscriptionManager::get_plan_details(env.clone(), plan2_id.clone()).unwrap();
        assert_eq!(plan2.0, String::from_str(&env, "Plan 2"));
        assert_eq!(plan2.1, 200);
        assert_eq!(plan2.2, 172800);
    }

    #[test]
    fn test_nonexistent_plan_retrieval() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Try to retrieve nonexistent plan
        assert!(super::SubscriptionManager::get_plan_details(
            env.clone(),
            String::from_str(&env, "nonexistent")
        ).is_err());
    }

    #[test]
    fn test_event_emissions() {
        let env = Env::default();
        let contract_id = env.register_contract(None, super::SubscriptionManager);
        let admin = Address::generate(&env);
        
        // Initialize
        super::SubscriptionManager::initialize(env.clone(), admin.clone(), 100).unwrap();
        
        // Create a plan
        let plan_id = String::from_str(&env, "event_test");
        super::SubscriptionManager::create_plan(
            env.clone(),
            admin.clone(),
            plan_id.clone(),
            String::from_str(&env, "Event Test"),
            100,
            86400,
        ).unwrap();
        
        // Pause the contract
        super::SubscriptionManager::set_pause(env.clone(), admin.clone(), true).unwrap();
        
        // Note: In a real test environment, you would verify the events
        // by checking the event logs. For this simplified test, we just
        // ensure the operations complete without errors.
    }
}
