#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

fn setup() -> (
    Env,
    RegistryIntegrationContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    let contract_id = env.register_contract(None, RegistryIntegrationContract);
    let client = RegistryIntegrationContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin).unwrap();
    (env, client, admin, owner, stranger)
}

fn register_contract(
    env: &Env,
    client: &RegistryIntegrationContractClient<'static>,
    owner: &Address,
    metadata: &str,
) {
    let metadata = String::from_str(env, metadata);
    client.register_with_registry(owner, owner, &metadata).unwrap();
}

fn update_metadata(
    env: &Env,
    client: &RegistryIntegrationContractClient<'static>,
    owner: &Address,
    metadata: &str,
) {
    let metadata = String::from_str(env, metadata);
    client.set_registry_metadata(owner, owner, &metadata).unwrap();
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, _owner, _stranger) = setup();
    assert_eq!(client.get_admin().unwrap(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, _owner, _stranger) = setup();
    let result = client.try_initialize(&admin);
    assert!(result.is_err());
}

#[test]
fn test_register_with_registry_stores_entry() {
    let (env, client, _admin, owner, _stranger) = setup();
    register_contract(&env, &client, &owner, "Registry metadata v1");
    let info = client.get_registry_info(&owner).unwrap();
    assert_eq!(info.contract_address, owner);
    assert_eq!(info.owner, owner);
    assert_eq!(info.metadata, String::from_str(&env, "Registry metadata v1"));
    assert!(info.active);
}

#[test]
fn test_register_with_registry_duplicate_fails() {
    let (env, client, _admin, owner, _stranger) = setup();
    register_contract(&env, &client, &owner, "initial metadata");
    let second = client.try_register_with_registry(
        &owner,
        &owner,
        &String::from_str(&env, "duplicate metadata"),
    );
    assert!(second.is_err());
}

#[test]
fn test_set_registry_metadata_updates_metadata() {
    let (env, client, _admin, owner, _stranger) = setup();
    register_contract(&env, &client, &owner, "first metadata");
    update_metadata(&env, &client, &owner, "updated metadata");
    assert_eq!(
        client.get_registry_metadata(&owner).unwrap(),
        String::from_str(&env, "updated metadata")
    );
}

#[test]
fn test_unregister_from_registry_removes_active_entry() {
    let (env, client, _admin, owner, _stranger) = setup();
    register_contract(&env, &client, &owner, "metadata to remove");
    client.unregister_from_registry(&owner, &owner).unwrap();
    assert!(client.get_registry_info(&owner).is_none());
    assert!(client.get_registry_metadata(&owner).is_none());
}

#[test]
fn test_revoke_registration_by_admin() {
    let (env, client, admin, owner, _stranger) = setup();
    register_contract(&env, &client, &owner, "registry e2e");
    client.revoke_registration(&admin, &owner).unwrap();
    assert!(client.get_registry_info(&owner).is_none());
}

#[test]
fn test_register_after_unregistration_allows_refresh() {
    let (env, client, _admin, owner, _stranger) = setup();
    register_contract(&env, &client, &owner, "metadata v1");
    client.unregister_from_registry(&owner, &owner).unwrap();
    register_contract(&env, &client, &owner, "metadata v2");
    let info = client.get_registry_info(&owner).unwrap();
    assert_eq!(info.metadata, String::from_str(&env, "metadata v2"));
}

macro_rules! create_registration_cases {
    ($($name:ident => $metadata:expr),*) => {
        $(
            #[test]
            fn $name() {
                let (env, client, _admin, owner, _stranger) = setup();
                register_contract(&env, &client, &owner, $metadata);
                let info = client.get_registry_info(&owner).unwrap();
                assert_eq!(info.metadata, String::from_str(&env, $metadata));
                assert!(info.active);
            }
        )*
    };
}

create_registration_cases! {
    test_register_with_registry_case_1 => "alpha",
    test_register_with_registry_case_2 => "beta",
    test_register_with_registry_case_3 => "gamma",
    test_register_with_registry_case_4 => "delta",
    test_register_with_registry_case_5 => "epsilon",
    test_register_with_registry_case_6 => "zeta",
    test_register_with_registry_case_7 => "eta",
    test_register_with_registry_case_8 => "theta",
    test_register_with_registry_case_9 => "iota",
    test_register_with_registry_case_10 => "kappa",
    test_register_with_registry_case_11 => "lambda",
    test_register_with_registry_case_12 => "mu",
    test_register_with_registry_case_13 => "nu",
    test_register_with_registry_case_14 => "xi",
    test_register_with_registry_case_15 => "omicron",
    test_register_with_registry_case_16 => "pi",
    test_register_with_registry_case_17 => "rho",
    test_register_with_registry_case_18 => "sigma",
    test_register_with_registry_case_19 => "tau",
    test_register_with_registry_case_20 => "upsilon"
}

macro_rules! create_metadata_update_cases {
    ($($name:ident => $metadata:expr),*) => {
        $(
            #[test]
            fn $name() {
                let (env, client, _admin, owner, _stranger) = setup();
                register_contract(&env, &client, &owner, "initial");
                client.set_registry_metadata(&owner, &owner, &String::from_str(&env, $metadata)).unwrap();
                assert_eq!(client.get_registry_metadata(&owner).unwrap(), String::from_str(&env, $metadata));
            }
        )*
    };
}

create_metadata_update_cases! {
    test_set_registry_metadata_case_1 => "meta-1",
    test_set_registry_metadata_case_2 => "meta-2",
    test_set_registry_metadata_case_3 => "meta-3",
    test_set_registry_metadata_case_4 => "meta-4",
    test_set_registry_metadata_case_5 => "meta-5",
    test_set_registry_metadata_case_6 => "meta-6",
    test_set_registry_metadata_case_7 => "meta-7",
    test_set_registry_metadata_case_8 => "meta-8",
    test_set_registry_metadata_case_9 => "meta-9",
    test_set_registry_metadata_case_10 => "meta-10",
    test_set_registry_metadata_case_11 => "meta-11",
    test_set_registry_metadata_case_12 => "meta-12",
    test_set_registry_metadata_case_13 => "meta-13",
    test_set_registry_metadata_case_14 => "meta-14",
    test_set_registry_metadata_case_15 => "meta-15",
    test_set_registry_metadata_case_16 => "meta-16",
    test_set_registry_metadata_case_17 => "meta-17",
    test_set_registry_metadata_case_18 => "meta-18",
    test_set_registry_metadata_case_19 => "meta-19",
    test_set_registry_metadata_case_20 => "meta-20"
}

macro_rules! create_unregister_cases {
    ($($name:ident => $status:expr),*) => {
        $(
            #[test]
            fn $name() {
                let (env, client, _admin, owner, _stranger) = setup();
                register_contract(&env, &client, &owner, "remove-me");
                client.unregister_from_registry(&owner, &owner).unwrap();
                assert!(client.get_registry_info(&owner).is_none());
                assert!(client.get_registry_metadata(&owner).is_none());
            }
        )*
    };
}

create_unregister_cases! {
    test_unregister_from_registry_case_1 => true,
    test_unregister_from_registry_case_2 => true,
    test_unregister_from_registry_case_3 => true,
    test_unregister_from_registry_case_4 => true,
    test_unregister_from_registry_case_5 => true,
    test_unregister_from_registry_case_6 => true,
    test_unregister_from_registry_case_7 => true,
    test_unregister_from_registry_case_8 => true,
    test_unregister_from_registry_case_9 => true,
    test_unregister_from_registry_case_10 => true,
    test_unregister_from_registry_case_11 => true,
    test_unregister_from_registry_case_12 => true,
    test_unregister_from_registry_case_13 => true,
    test_unregister_from_registry_case_14 => true,
    test_unregister_from_registry_case_15 => true,
    test_unregister_from_registry_case_16 => true,
    test_unregister_from_registry_case_17 => true,
    test_unregister_from_registry_case_18 => true,
    test_unregister_from_registry_case_19 => true,
    test_unregister_from_registry_case_20 => true
}
