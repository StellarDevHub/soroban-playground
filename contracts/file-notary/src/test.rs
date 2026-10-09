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

fn three_leaf_batch(env: &Env) -> (BytesN<32>, BytesN<32>, BytesN<32>, BytesN<32>) {
    let first = make_hash(env, 31);
    let second = make_hash(env, 32);
    let third = make_hash(env, 33);
    let first_pair = FileNotary::hash_pair(env, &first, &second);
    let root = FileNotary::hash_pair(env, &first_pair, &third);
    (first, second, third, root)
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

// ── Merkle batch notarization ────────────────────────────────────────────────

#[test]
fn test_batch_proof_verifies_odd_width_tree() {
    let (env, _, user, client) = setup();
    let (first, second, third, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "three files");
    client.notarize_batch(&user, &root, &3, &metadata);

    let mut proof = soroban_sdk::Vec::new(&env);
    proof.push_back(first_pair_for_test(&env, &first, &second));
    let record = client.verify_batch_proof(&root, &third, &2, &proof);

    assert_eq!(record.owner, user);
    assert_eq!(record.metadata, metadata);
    assert_eq!(record.leaf_count, 3);
    assert!(record.verified);
}

#[test]
fn test_batch_proof_verifies_leaf_with_two_siblings() {
    let (env, _, user, client) = setup();
    let (first, second, third, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "three files");
    client.notarize_batch(&user, &root, &3, &metadata);

    let mut proof = soroban_sdk::Vec::new(&env);
    proof.push_back(second);
    proof.push_back(third);
    assert!(
        client
            .verify_batch_proof(&root, &first, &0, &proof)
            .verified
    );
}

#[test]
fn test_batch_proof_hashes_right_child_after_sibling() {
    let (env, _, user, client) = setup();
    let (first, second, third, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "three files");
    client.notarize_batch(&user, &root, &3, &metadata);

    let mut proof = soroban_sdk::Vec::new(&env);
    proof.push_back(first);
    proof.push_back(third);
    assert!(
        client
            .verify_batch_proof(&root, &second, &1, &proof)
            .verified
    );
}

#[test]
fn test_batch_proof_rejects_wrong_sibling_and_invalid_index() {
    let (env, _, user, client) = setup();
    let (first, second, _, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "three files");
    client.notarize_batch(&user, &root, &3, &metadata);

    let mut bad_proof = soroban_sdk::Vec::new(&env);
    bad_proof.push_back(make_hash(&env, 99));
    bad_proof.push_back(make_hash(&env, 33));
    assert_eq!(
        client.try_verify_batch_proof(&root, &first, &0, &bad_proof),
        Err(Ok(Error::InvalidProof))
    );

    let mut proof = soroban_sdk::Vec::new(&env);
    proof.push_back(second);
    proof.push_back(make_hash(&env, 33));
    assert_eq!(
        client.try_verify_batch_proof(&root, &first, &3, &proof),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn test_batch_proof_rejects_missing_or_extra_siblings() {
    let (env, _, user, client) = setup();
    let (first, second, third, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "three files");
    client.notarize_batch(&user, &root, &3, &metadata);

    let missing = soroban_sdk::Vec::new(&env);
    assert_eq!(
        client.try_verify_batch_proof(&root, &first, &0, &missing),
        Err(Ok(Error::InvalidProof))
    );

    let mut extra = soroban_sdk::Vec::new(&env);
    extra.push_back(second);
    extra.push_back(third);
    extra.push_back(make_hash(&env, 34));
    assert_eq!(
        client.try_verify_batch_proof(&root, &first, &0, &extra),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn test_batch_registration_rejects_duplicate_empty_and_oversized_batch() {
    let (env, _, user, client) = setup();
    let (_, _, _, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "batch");
    client.notarize_batch(&user, &root, &3, &metadata);
    assert_eq!(
        client.try_notarize_batch(&user, &root, &3, &metadata),
        Err(Ok(Error::AlreadyNotarized))
    );

    assert_eq!(
        client.try_notarize_batch(&user, &make_hash(&env, 40), &0, &metadata),
        Err(Ok(Error::InvalidBatchSize))
    );
    assert_eq!(
        client.try_notarize_batch(&user, &make_hash(&env, 41), &((1u64 << 32) + 1), &metadata),
        Err(Ok(Error::InvalidBatchSize))
    );
}

#[test]
fn test_unknown_root_and_revoked_batch_cannot_verify() {
    let (env, _, user, client) = setup();
    let (first, second, _, root) = three_leaf_batch(&env);
    let metadata = soroban_sdk::String::from_str(&env, "three files");
    let mut proof = soroban_sdk::Vec::new(&env);
    proof.push_back(second);
    proof.push_back(make_hash(&env, 33));

    assert_eq!(
        client.try_verify_batch_proof(&root, &first, &0, &proof),
        Err(Ok(Error::NotFound))
    );
    client.notarize_batch(&user, &root, &3, &metadata);
    client.revoke_batch(&user, &root);
    assert_eq!(
        client.try_verify_batch_proof(&root, &first, &0, &proof),
        Err(Ok(Error::NotFound))
    );
}

fn first_pair_for_test(env: &Env, first: &BytesN<32>, second: &BytesN<32>) -> BytesN<32> {
    FileNotary::hash_pair(env, first, second)
}
