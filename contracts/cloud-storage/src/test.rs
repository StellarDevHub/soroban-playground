use soroban_sdk::{contract, contractimpl, testutils::{self, Ledger, LedgerInfo, User}, Address, Env, String, Symbol, vec};
use crate::types::{Error, FileMetadata, StorageOffer, StorageProvider};
use crate::lib::CloudStorage;

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract = CloudStorage;

    // First initialization succeeds
    contract.initialize(env.clone());
    assert!(crate::storage::is_initialized(&env));

    // Second initialization fails
    let result = contract.initialize(env.clone());
    assert_eq!(result, Err(Error::AlreadyInitialized));
}

#[test]
fn test_set_paused() {
    let env = Env::default();
    let contract = CloudStorage;
    let admin = User::new(&env, "admin", 100);

    // Initialize first
    contract.initialize(env.clone());

    // Success - pause
    admin.activate_auth(&env);
    contract.set_paused(env.clone(), admin.address.clone(), true);
    assert!(crate::storage::is_paused(&env));

    // Unpause
    contract.set_paused(env.clone(), admin.address.clone(), false);
    assert!(!crate::storage::is_paused(&env));
}

#[test]
fn test_set_paused_unauthorized() {
    let env = Env::default();
    let contract = CloudStorage;
    let admin = User::new(&env, "admin", 100);
    let attacker = User::new(&env, "attacker", 200);

    contract.initialize(env.clone());
    admin.activate_auth(&env);

    // Attacker cannot set paused
    let result = contract.set_paused(env.clone(), attacker.address.clone(), true);
    assert_eq!(result, Err(Error::Unauthorized));
}

#[test]
fn test_register_storage_provider() {
    let env = Env::default();
    let contract = CloudStorage;
    let provider = User::new(&env, "provider", 100);

    contract.initialize(env.clone());
    provider.activate_auth(&env);

    let result = contract.register_storage_provider(
        env.clone(),
        provider.address.clone(),
        1_000_000,
        1,
    );

    assert!(result.is_ok());

    let storage_provider = contract.get_storage_provider(env.clone(), provider.address.clone());
    assert!(storage_provider.is_ok());
    let sp = storage_provider.unwrap();
    assert_eq!(sp.provider, provider.address.clone());
    assert_eq!(sp.capacity, 1_000_000);
    assert_eq!(sp.used_capacity, 0);
    assert_eq!(sp.price_per_gb, 1);
    assert!(sp.is_active);
}

#[test]
fn test_register_storage_provider_when_paused() {
    let env = Env::default();
    let contract = CloudStorage;
    let admin = User::new(&env, "admin", 100);
    let provider = User::new(&env, "provider", 200);

    contract.initialize(env.clone());
    admin.activate_auth(&env);
    contract.set_paused(env.clone(), admin.address.clone(), true);

    provider.activate_auth(&env);
    let result = contract.register_storage_provider(
        env.clone(),
        provider.address.clone(),
        1_000_000,
        1,
    );
    assert_eq!(result, Err(Error::Paused));
}

#[test]
fn test_remove_storage_provider() {
    let env = Env::default();
    let contract = CloudStorage;
    let provider = User::new(&env, "provider", 100);

    contract.initialize(env.clone());
    provider.activate_auth(&env);

    // Register provider
    contract.register_storage_provider(
        env.clone(),
        provider.address.clone(),
        1_000_000,
        1,
    ).unwrap();

    // Remove provider
    let result = contract.remove_storage_provider(env.clone(), provider.address.clone());
    assert!(result.is_ok());

    // Provider should still exist but inactive
    let storage_provider = contract.get_storage_provider(env.clone(), provider.address.clone());
    assert!(storage_provider.is_ok());
    let sp = storage_provider.unwrap();
    assert!(!sp.is_active);
}

#[test]
fn test_remove_storage_provider_not_found() {
    let env = Env::default();
    let contract = CloudStorage;
    let provider = User::new(&env, "provider", 100);
    let nonexistent = Address::random(&env, 999);

    contract.initialize(env.clone());
    provider.activate_auth(&env);

    let result = contract.remove_storage_provider(env.clone(), nonexistent);
    assert_eq!(result, Err(Error::ProviderNotFound));
}

#[test]
fn test_upload_file() {
    let env = Env::default();
    let contract = CloudStorage;
    let owner = User::new(&env, "owner", 100);
    let cid = String::from_str(&env, "QmTest123");
    let manifest_cid = String::from_str(&env, "QmManifest456");

    contract.initialize(env.clone());
    owner.activate_auth(&env);

    let result = contract.upload_file(
        env.clone(),
        owner.address.clone(),
        String::from_str(&env, "testfile.txt"),
        1024,
        2,
        3,
        cid.clone(),
        manifest_cid.clone(),
    );

    assert!(result.is_ok());

    let file = contract.get_file_info(env.clone(), cid.clone());
    assert!(file.is_ok());
    let f = file.unwrap();
    assert_eq!(f.owner, owner.address.clone());
    assert_eq!(f.size, 1024);
    assert_eq!(f.shard_count, 2);
    assert_eq!(f.redundancy_factor, 3);
    assert_eq!(f.cid, cid);
    assert_eq!(f.shards_manifest_cid, manifest_cid);
    assert!(f.is_active);
    assert!(f.uploaded_at > 0);
}

#[test]
fn test_upload_file_when_paused() {
    let env = Env::default();
    let contract = CloudStorage;
    let admin = User::new(&env, "admin", 100);
    let owner = User::new(&env, "owner", 200);
    let cid = String::from_str(&env, "QmTest123");

    contract.initialize(env.clone());
    admin.activate_auth(&env);
    contract.set_paused(env.clone(), admin.address.clone(), true);

    owner.activate_auth(&env);
    let result = contract.upload_file(
        env.clone(),
        owner.address.clone(),
        String::from_str(&env, "testfile.txt"),
        1024,
        2,
        3,
        cid,
        String::from_str(&env, "QmManifest"),
    );
    assert_eq!(result, Err(Error::Paused));
}

#[test]
fn test_update_file_metadata() {
    let env = Env::default();
    let contract = CloudStorage;
    let owner = User::new(&env, "owner", 100);
    let cid = String::from_str(&env, "QmTest123");

    contract.initialize(env.clone());
    owner.activate_auth(&env);

    // Upload file
    contract.upload_file(
        env.clone(),
        owner.address.clone(),
        String::from_str(&env, "testfile.txt"),
        1024,
        2,
        3,
        cid.clone(),
        String::from_str(&env, "QmManifest"),
    ).unwrap();

    // Update metadata
    let result = contract.update_file_metadata(
        env.clone(),
        owner.address.clone(),
        cid.clone(),
        Some(4), // new shard count
        Some(5), // new redundancy
    );
    assert!(result.is_ok());

    let file = contract.get_file_info(env.clone(), cid).unwrap();
    assert_eq!(file.shard_count, 4);
    assert_eq!(file.redundancy_factor, 5);
}

#[test]
fn test_update_file_metadata_unauthorized() {
    let env = Env::default();
    let contract = CloudStorage;
    let owner = User::new(&env, "owner", 100);
    let attacker = User::new(&env, "attacker", 200);
    let cid = String::from_str(&env, "QmTest123");

    contract.initialize(env.clone());
    owner.activate_auth(&env);

    contract.upload_file(
        env.clone(),
        owner.address.clone(),
        String::from_str(&env, "testfile.txt"),
        1024,
        2,
        3,
        cid.clone(),
        String::from_str(&env, "QmManifest"),
    ).unwrap();

    attacker.activate_auth(&env);
    let result = contract.update_file_metadata(
        env.clone(),
        attacker.address.clone(),
        cid,
        Some(4),
        Some(5),
    );
    assert_eq!(result, Err(Error::FileNotOwnedByCaller));
}

#[test]
fn test_delete_file_metadata() {
    let env = Env::default();
    let contract = CloudStorage;
    let owner = User::new(&env, "owner", 100);
    let cid = String::from_str(&env, "QmTest123");

    contract.initialize(env.clone());
    owner.activate_auth(&env);

    contract.upload_file(
        env.clone(),
        owner.address.clone(),
        String::from_str(&env, "testfile.txt"),
        1024,
        2,
        3,
        cid.clone(),
        String::from_str(&env, "QmManifest"),
    ).unwrap();

    let result = contract.delete_file_metadata(env.clone(), owner.address.clone(), cid.clone());
    assert!(result.is_ok());

    // File should still be accessible but marked as inactive
    let file = contract.get_file_info(env.clone(), cid);
    assert!(file.is_ok());
    assert!(!file.unwrap().is_active);
}

#[test]
fn test_delete_file_metadata_unauthorized() {
    let env = Env::default();
    let contract = CloudStorage;
    let owner = User::new(&env, "owner", 100);
    let attacker = User::new(&env, "attacker", 200);
    let cid = String::from_str(&env, "QmTest123");

    contract.initialize(env.clone());
    owner.activate_auth(&env);

    contract.upload_file(
        env.clone(),
        owner.address.clone(),
        String::from_str(&env, "testfile.txt"),
        1024,
        2,
        3,
        cid,
        String::from_str(&env, "QmManifest"),
    ).unwrap();

    attacker.activate_auth(&env);
    let result = contract.delete_file_metadata(
        env.clone(),
        attacker.address.clone(),
        String::from_str(&env, "QmTest123"),
    );
    assert_eq!(result, Err(Error::FileNotOwnedByCaller));
}

#[test]
fn test_get_storage_provider_not_found() {
    let env = Env::default();
    let contract = CloudStorage;
    let provider = Address::random(&env, 999);

    contract.initialize(env.clone());

    let result = contract.get_storage_provider(env.clone(), provider);
    assert_eq!(result, Err(Error::ProviderNotFound));
}

#[test]
fn test_get_all_active_providers_empty() {
    let env = Env::default();
    let contract = CloudStorage;

    contract.initialize(env.clone());
    let providers = contract.get_all_active_providers(env.clone());

    assert_eq!(providers.len(), 0);
}

#[test]
fn test_get_all_active_providers_populated() {
    let env = Env::default();
    let contract = CloudStorage;
    let p1 = User::new(&env, "provider1", 100);
    let p2 = User::new(&env, "provider2", 200);
    let p3 = User::new(&env, "provider3", 300);

    contract.initialize(env.clone());

    p1.activate_auth(&env);
    contract.register_storage_provider(env.clone(), p1.address.clone(), 1_000, 1).unwrap();

    p2.activate_auth(&env);
    contract.register_storage_provider(env.clone(), p2.address.clone(), 2_000, 2).unwrap();

    p3.activate_auth(&env);
    contract.register_storage_provider(env.clone(), p3.address.clone(), 3_000, 3).unwrap();

    let providers = contract.get_all_active_providers(env.clone());
    assert_eq!(providers.len(), 3);

    // Verify we got all three providers
    let mut capacities: Vec<u64> = providers.iter().map(|p| p.capacity).collect();
    capacities.sort();
    assert_eq!(capacities, vec![1_000, 2_000, 3_000]);
}

#[test]
fn test_get_total_capacity() {
    let env = Env::default();
    let contract = CloudStorage;
    let p1 = User::new(&env, "provider1", 100);
    let p2 = User::new(&env, "provider2", 200);

    contract.initialize(env.clone());

    p1.activate_auth(&env);
    contract.register_storage_provider(env.clone(), p1.address.clone(), 1_000, 1).unwrap();
    assert_eq!(contract.get_total_capacity(env.clone()), 1_000);

    p2.activate_auth(&env);
    contract.register_storage_provider(env.clone(), p2.address.clone(), 2_000, 2).unwrap();
    assert_eq!(contract.get_total_capacity(env.clone()), 3_000);
}

#[test]
fn test_inactive_provider_not_returned() {
    let env = Env::default();
    let contract = CloudStorage;
    let admin = User::new(&env, "admin", 100);
    let provider = User::new(&env, "provider", 200);

    contract.initialize(env.clone());

    admin.activate_auth(&env);
    provider.activate_auth(&env);

    contract.register_storage_provider(env.clone(), provider.address.clone(), 1_000, 1).unwrap();
    assert_eq!(contract.get_all_active_providers(env.clone()).len(), 1);

    // Remove provider (sets inactive)
    contract.remove_storage_provider(env.clone(), provider.address.clone()).unwrap();

    // Should not appear in active list
    let active = contract.get_all_active_providers(env.clone());
    assert_eq!(active.len(), 0);
}
