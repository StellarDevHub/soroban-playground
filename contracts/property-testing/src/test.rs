use soroban_sdk::{
    symbol_short, testutils::Address as _, Address, Env, String, Val, Vec,
};

use crate::{PropertyTestingUtils, PropertyTestingUtilsClient, Error, PropertyStatus};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    assert!(env.instance().has::<Address>(&symbol_short!("ADMIN")));
}

#[test]
#[should_panic(expected = "Error(4)")]
fn test_initialize_twice() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_run_property_passed() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    let result = client.run_property(
        &String::from_str(&env, "test_property"),
        &100,
        &true,
    );
    assert_eq!(result, PropertyStatus::Passed);
}

#[test]
#[should_panic(expected = "Error(5)")]
fn test_run_property_failed() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    client.run_property(
        &String::from_str(&env, "test_property"),
        &100,
        &false,
    );
}

#[test]
fn test_check_invariant_holds() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    let result = client.check_invariant(
        &String::from_str(&env, "test_invariant"),
        &true,
    );
    assert!(result);
}

#[test]
#[should_panic(expected = "Error(6)")]
fn test_check_invariant_violated() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    client.check_invariant(
        &String::from_str(&env, "test_invariant"),
        &false,
    );
}

#[test]
fn test_u32_boundaries() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let boundaries = client.test_u32_boundaries(&42);
    assert_eq!(boundaries.len(), 5);
    assert_eq!(boundaries.get(0).unwrap(), 0);
    assert_eq!(boundaries.get(1).unwrap(), 1);
    assert_eq!(boundaries.get(4).unwrap(), 42);
}

#[test]
fn test_i32_boundaries() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let boundaries = client.test_i32_boundaries(&42);
    assert_eq!(boundaries.len(), 8);
}

#[test]
fn test_generate_u32s() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let values = client.generate_u32s(&10, &12345);
    assert_eq!(values.len(), 10);
}

#[test]
fn test_generate_i32s() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let values = client.generate_i32s(&10, &12345);
    assert_eq!(values.len(), 10);
}

#[test]
fn test_generate_strings() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let values = client.generate_strings(&10, &12345, &20);
    assert_eq!(values.len(), 10);
}

#[test]
fn test_validate_equality() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    let a: u32 = 42;
    let b: u32 = 42;
    let result = client.validate_equality(
        &Val::from(a),
        &Val::from(b),
        &String::from_str(&env, "eq_test"),
    );
    assert!(result);
}

#[test]
fn test_validate_range() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    let result = client.validate_range(
        &50,
        &0,
        &100,
        &String::from_str(&env, "range_test"),
    );
    assert!(result);
}

#[test]
fn test_property_results() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    client.run_property(&String::from_str(&env, "prop1"), &10, &true);
    let results = client.get_property_results();
    assert_eq!(results.len(), 1);
    
    client.clear_property_results();
    let results = client.get_property_results();
    assert_eq!(results.len(), 0);
}

#[test]
fn test_invariant_results() {
    let env = Env::default();
    let contract_id = env.register(PropertyTestingUtils, ());
    let client = PropertyTestingUtilsClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    client.check_invariant(&String::from_str(&env, "inv1"), &true);
    let results = client.get_invariant_results();
    assert_eq!(results.len(), 1);
    
    client.clear_invariant_results();
    let results = client.get_invariant_results();
    assert_eq!(results.len(), 0);
}
