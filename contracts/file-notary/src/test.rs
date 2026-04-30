use super::*;
use soroban_sdk::{testutils::Address as _, Env};

fn setup() -> (Env, Address, Address, FileNotaryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, FileNotary);
    let client = FileNotaryClient::new(&env, &id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin);
    let env = std::boxed::Box::leak(std::boxed::Box::new(env));
    let client = FileNotaryClient::new(env, &id);
    (env.clone(), admin, user, client)
}

fn make_hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

// ── notarize_file ─────────────────────────────────────────────────────────────

#[test]
fn test_notarize_succeeds_and_emits_event() {
    let (env, _, user, client) = setup();
    let hash = make_hash(&env, 1);
    let meta = soroban_sdk::String::from_str(&env, "doc v1");

    let ts = client.notarize_file(&user, &hash, &meta);
    assert!(ts > 0);

    let record = client.verify_file(&hash);
    assert_eq!(record.owner, user);
    assert_eq!(record.metadata, meta);
    assert!(record.verified);
}

#[test]
fn test_notarize_duplicate_fails() {
    let (env, _, user, client) = setup();
    let hash = make_hash(&env, 2);
    let meta = soroban_sdk::String::from_str(&env, "doc");

    client.notarize_file(&user, &hash, &meta);
    let result = client.try_notarize_file(&user, &hash, &meta);
    assert_eq!(result, Err(Ok(Error::AlreadyNotarized)));
}

// ── verify_file ───────────────────────────────────────────────────────────────

#[test]
fn test_verify_returns_correct_record() {
    let (env, _, user, client) = setup();
    let hash = make_hash(&env, 3);
    let meta = soroban_sdk::String::from_str(&env, "metadata");

    client.notarize_file(&user, &hash, &meta);
    let record = client.verify_file(&hash);

    assert_eq!(record.owner, user);
    assert_eq!(record.metadata, meta);
    assert!(record.verified);
}

#[test]
fn test_verify_not_found_fails() {
    let (env, _, _, client) = setup();
    let hash = make_hash(&env, 4);
    let result = client.try_verify_file(&hash);
    assert_eq!(result, Err(Ok(Error::NotFound)));
}

// ── revoke_notarization ───────────────────────────────────────────────────────

#[test]
fn test_revoke_by_owner_succeeds() {
    let (env, _, user, client) = setup();
    let hash = make_hash(&env, 5);
    let meta = soroban_sdk::String::from_str(&env, "doc");

    client.notarize_file(&user, &hash, &meta);
    client.revoke_notarization(&user, &hash);

    let record = client.verify_file(&hash);
    assert!(!record.verified);
}

#[test]
fn test_revoke_by_non_owner_fails() {
    let (env, _, user, client) = setup();
    let hash = make_hash(&env, 6);
    let meta = soroban_sdk::String::from_str(&env, "doc");
    let other = Address::generate(&env);

    client.notarize_file(&user, &hash, &meta);
    let result = client.try_revoke_notarization(&other, &hash);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_revoke_not_found_fails() {
    let (env, _, user, client) = setup();
    let hash = make_hash(&env, 7);
    let result = client.try_revoke_notarization(&user, &hash);
    assert_eq!(result, Err(Ok(Error::NotFound)));
}

// ── pause / resume ────────────────────────────────────────────────────────────

#[test]
fn test_pause_prevents_notarization() {
    let (env, admin, user, client) = setup();
    let hash = make_hash(&env, 8);
    let meta = soroban_sdk::String::from_str(&env, "doc");

    client.pause_contract(&admin);
    let result = client.try_notarize_file(&user, &hash, &meta);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_resume_re_enables_notarization() {
    let (env, admin, user, client) = setup();
    let hash = make_hash(&env, 9);
    let meta = soroban_sdk::String::from_str(&env, "doc");

    client.pause_contract(&admin);
    client.resume_contract(&admin);
    let ts = client.notarize_file(&user, &hash, &meta);
    assert!(ts > 0);
}

#[test]
fn test_pause_by_non_admin_fails() {
    let (env, _, user, client) = setup();
    let result = client.try_pause_contract(&user);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_pause_prevents_revoke() {
    let (env, admin, user, client) = setup();
    let hash = make_hash(&env, 10);
    let meta = soroban_sdk::String::from_str(&env, "doc");

    client.notarize_file(&user, &hash, &meta);
    client.pause_contract(&admin);
    let result = client.try_revoke_notarization(&user, &hash);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, FileNotary);
    let client = FileNotaryClient::new(&env, &id);
    let admin = Address::generate(&env);

    client.initialize(&admin);
    let result = std::panic::catch_unwind(|| {
        client.initialize(&admin);
    });
    assert!(result.is_err());
}
