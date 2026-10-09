#![cfg(test)]

use super::{CcipBridge, CcipBridgeClient};
use crate::types::Error;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, Vec};

const GAS_PRICE: i128 = 100;
const MAX_REFUND: i128 = 10_000_000;
const CHAIN_ID: u64 = 1;

fn setup() -> (Env, CcipBridgeClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CcipBridge);
    let client = CcipBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &GAS_PRICE, &MAX_REFUND);
    (env, client, admin)
}

fn b(env: &Env, data: &[u8]) -> Bytes {
    Bytes::from_slice(env, data)
}

fn siblings(env: &Env, hashes: &[BytesN<32>]) -> Vec<BytesN<32>> {
    let mut out = Vec::new(env);
    for hash in hashes {
        out.push_back(hash.clone());
    }
    out
}

/// Register a relayer and configure a single-leaf root for `payload`.
fn setup_single_leaf(
    env: &Env,
    client: &CcipBridgeClient<'static>,
    admin: &Address,
    nonce: u64,
    payload: &[u8],
) -> (Address, BytesN<32>) {
    let relayer = Address::generate(env);
    client.register_relayer(admin, &relayer, &true);
    let root = client.compute_leaf(&CHAIN_ID, &nonce, &b(env, payload));
    client.set_chain_config(admin, &CHAIN_ID, &root, &true);
    (relayer, root)
}

fn expected_refund(payload_len: u32) -> i128 {
    (25_000 + payload_len as i128 * 16) * GAS_PRICE
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_config() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
    assert_eq!(client.get_gas_price(), GAS_PRICE);
    assert_eq!(client.get_max_refund(), MAX_REFUND);
    assert_eq!(client.get_congestion_bps(), 10_000);
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (env, client, admin) = setup();
    let _ = &env;
    let result = client.try_initialize(&admin, &GAS_PRICE, &MAX_REFUND);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

#[test]
fn test_initialize_invalid_gas_price_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CcipBridge);
    let client = CcipBridgeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let result = client.try_initialize(&admin, &0i128, &MAX_REFUND);
    assert!(matches!(result, Err(Ok(Error::InvalidGasPrice))));
}

// ── Relayer + chain admin ─────────────────────────────────────────────────────

#[test]
fn test_register_relayer() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    assert!(!client.is_relayer(&relayer));
    client.register_relayer(&admin, &relayer, &true);
    assert!(client.is_relayer(&relayer));
    client.register_relayer(&admin, &relayer, &false);
    assert!(!client.is_relayer(&relayer));
}

#[test]
fn test_non_admin_cannot_register_relayer() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    let relayer = Address::generate(&env);
    let result = client.try_register_relayer(&stranger, &relayer, &true);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_non_admin_cannot_set_gas_price() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_set_gas_price(&stranger, &200i128);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_set_chain_config_and_rotate_root() {
    let (env, client, admin) = setup();
    let (relayer, root) = setup_single_leaf(&env, &client, &admin, 0, b"payload");
    let _ = relayer;
    let config = client.get_chain_config(&CHAIN_ID).unwrap();
    assert_eq!(config.merkle_root, root);
    assert!(config.enabled);

    let new_root = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"other"));
    client.set_merkle_root(&admin, &CHAIN_ID, &new_root);
    assert_eq!(
        client.get_chain_config(&CHAIN_ID).unwrap().merkle_root,
        new_root
    );
}

#[test]
fn test_set_merkle_root_unknown_chain_fails() {
    let (env, client, admin) = setup();
    let root = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"x"));
    let result = client.try_set_merkle_root(&admin, &99u64, &root);
    assert!(matches!(result, Err(Ok(Error::ChainNotConfigured))));
}

#[test]
fn test_set_congestion_bps_out_of_range_fails() {
    let (_env, client, admin) = setup();
    let result = client.try_set_congestion_bps(&admin, &100_001u32);
    assert!(matches!(result, Err(Ok(Error::InvalidCongestion))));
}

// ── Message execution ─────────────────────────────────────────────────────────

#[test]
fn test_execute_single_leaf_message() {
    let (env, client, admin) = setup();
    let payload = b"single-leaf";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);

    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let refund =
        client.execute_cross_chain_message(&relayer, &CHAIN_ID, &0u64, &b(&env, payload), &empty);

    assert_eq!(refund, expected_refund(payload.len() as u32));
    assert!(client.is_nonce_processed(&CHAIN_ID, &0));
    let receipt = client.get_receipt(&CHAIN_ID, &0).unwrap();
    assert_eq!(receipt.relayer, relayer);
    assert_eq!(receipt.refund, refund);
}

#[test]
fn test_execute_two_leaf_merkle_proof() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);

    let leaf0 = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"payload-0"));
    let leaf1 = client.compute_leaf(&CHAIN_ID, &1u64, &b(&env, b"payload-1"));
    let root = client.hash_pair(&leaf0, &leaf1);
    client.set_chain_config(&admin, &CHAIN_ID, &root, &true);

    let proof = siblings(&env, &[leaf1]);
    let refund = client.execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, b"payload-0"),
        &proof,
    );
    assert!(refund > 0);
    assert!(client.is_nonce_processed(&CHAIN_ID, &0));
}

#[test]
fn test_hash_pair_is_commutative() {
    let (env, client, _admin) = setup();
    let a = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"a"));
    let bb = client.compute_leaf(&CHAIN_ID, &1u64, &b(&env, b"b"));
    assert_eq!(client.hash_pair(&a, &bb), client.hash_pair(&bb, &a));
}

#[test]
fn test_execute_rejects_invalid_proof() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);

    let leaf = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"payload"));
    let _wrong = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"wrong"));
    client.set_chain_config(&admin, &CHAIN_ID, &leaf, &true);

    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, b"wrong"),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::MerkleProofInvalid))));
}

#[test]
fn test_execute_replay_fails() {
    let (env, client, admin) = setup();
    let payload = b"replay";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);
    let empty: Vec<BytesN<32>> = Vec::new(&env);

    client.execute_cross_chain_message(&relayer, &CHAIN_ID, &0u64, &b(&env, payload), &empty);
    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, payload),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::NonceAlreadyProcessed))));
}

#[test]
fn test_execute_unknown_relayer_fails() {
    let (env, client, admin) = setup();
    let _ = &admin;
    let frontier = Address::generate(&env);
    let payload = b"payload";
    let leaf = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, payload));
    client.set_chain_config(&admin, &CHAIN_ID, &leaf, &true);

    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.try_execute_cross_chain_message(
        &frontier,
        &CHAIN_ID,
        &0u64,
        &b(&env, payload),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::UnknownRelayer))));
}

#[test]
fn test_execute_unconfigured_chain_fails() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);
    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, b"payload"),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::ChainNotConfigured))));
}

#[test]
fn test_execute_disabled_chain_fails() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);
    let leaf = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"payload"));
    client.set_chain_config(&admin, &CHAIN_ID, &leaf, &false);

    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, b"payload"),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::ChainDisabled))));
}

#[test]
fn test_execute_while_paused_fails() {
    let (env, client, admin) = setup();
    let payload = b"paused";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);
    client.set_paused(&admin, &true);

    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, payload),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::BridgePaused))));
}

#[test]
fn test_execute_empty_payload_fails() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);
    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let root = client.compute_leaf(&CHAIN_ID, &0u64, &Bytes::new(&env));
    client.set_chain_config(&admin, &CHAIN_ID, &root, &true);
    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &Bytes::new(&env),
        &empty,
    );
    assert!(matches!(result, Err(Ok(Error::EmptyPayload))));
}

#[test]
fn test_execute_proof_too_deep_fails() {
    let (env, client, admin) = setup();
    let payload = b"deep";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);

    let mut deep: Vec<BytesN<32>> = Vec::new(&env);
    let dummy = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, b"dummy"));
    for _ in 0..33 {
        deep.push_back(dummy.clone());
    }

    let result = client.try_execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, payload),
        &deep,
    );
    assert!(matches!(result, Err(Ok(Error::ProofTooDeep))));
}

// ── Dynamic refunds ───────────────────────────────────────────────────────────

#[test]
fn test_refund_scales_with_payload_size() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);

    let small = b"a";
    let large = b"a-much-longer-payload-value";
    let root_small = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, small));
    let root_large = client.compute_leaf(&CHAIN_ID, &1u64, &b(&env, large));
    let root = client.hash_pair(&root_small, &root_large);
    client.set_chain_config(&admin, &CHAIN_ID, &root, &true);

    let proof_small = siblings(&env, &[root_large]);
    let proof_large = siblings(&env, &[root_small]);
    let refund_small = client.execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &0u64,
        &b(&env, small),
        &proof_small,
    );
    let refund_large = client.execute_cross_chain_message(
        &relayer,
        &CHAIN_ID,
        &1u64,
        &b(&env, large),
        &proof_large,
    );

    assert_eq!(refund_small, expected_refund(small.len() as u32));
    assert_eq!(refund_large, expected_refund(large.len() as u32));
    assert!(refund_large > refund_small);
}

#[test]
fn test_congestion_multiplier_scales_refund() {
    let (env, client, admin) = setup();
    client.set_congestion_bps(&admin, &20_000u32); // 2x
    let payload = b"congested";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);

    let empty: Vec<BytesN<32>> = Vec::new(&env);
    let refund =
        client.execute_cross_chain_message(&relayer, &CHAIN_ID, &0u64, &b(&env, payload), &empty);
    assert_eq!(refund, expected_refund(payload.len() as u32) * 2);
}

#[test]
fn test_base_refund_is_added_and_capped() {
    let (env, client, admin) = setup();
    client.set_base_refund(&admin, &500i128);
    let payload = b"base";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);
    let empty: Vec<BytesN<32>> = Vec::new(&env);

    let refund =
        client.execute_cross_chain_message(&relayer, &CHAIN_ID, &0u64, &b(&env, payload), &empty);
    assert_eq!(refund, expected_refund(payload.len() as u32) + 500);

    // A tight cap clamps the refund.
    client.set_max_refund(&admin, &1_000i128);
    let payload2 = b"capped";
    let leaf = client.compute_leaf(&CHAIN_ID, &1u64, &b(&env, payload2));
    client.set_chain_config(&admin, &CHAIN_ID, &leaf, &true);
    let refund2 =
        client.execute_cross_chain_message(&relayer, &CHAIN_ID, &1u64, &b(&env, payload2), &empty);
    assert_eq!(refund2, 1_000);
}

#[test]
fn test_claim_refund_credits_and_resets() {
    let (env, client, admin) = setup();
    let payload = b"claimable";
    let (relayer, _root) = setup_single_leaf(&env, &client, &admin, 0, payload);
    let empty: Vec<BytesN<32>> = Vec::new(&env);

    let refund =
        client.execute_cross_chain_message(&relayer, &CHAIN_ID, &0u64, &b(&env, payload), &empty);
    assert_eq!(client.get_claimable_refund(&relayer), refund);
    assert_eq!(client.total_refunded(), refund);

    let claimed = client.claim_refund(&relayer);
    assert_eq!(claimed, refund);
    assert_eq!(client.get_claimable_refund(&relayer), 0);
    assert_eq!(client.get_relayer_stats(&relayer).claimed, refund);
    assert_eq!(client.total_claimed(), refund);

    let result = client.try_claim_refund(&relayer);
    assert!(matches!(result, Err(Ok(Error::NoRefund))));
}

#[test]
fn test_relayer_stats_track_deliveries() {
    let (env, client, admin) = setup();
    let relayer = Address::generate(&env);
    client.register_relayer(&admin, &relayer, &true);

    let p0 = b"m0";
    let p1 = b"m1";
    let leaf0 = client.compute_leaf(&CHAIN_ID, &0u64, &b(&env, p0));
    let leaf1 = client.compute_leaf(&CHAIN_ID, &1u64, &b(&env, p1));
    let root = client.hash_pair(&leaf0, &leaf1);
    client.set_chain_config(&admin, &CHAIN_ID, &root, &true);

    let proof0 = siblings(&env, &[leaf1]);
    let proof1 = siblings(&env, &[leaf0]);
    client.execute_cross_chain_message(&relayer, &CHAIN_ID, &0u64, &b(&env, p0), &proof0);
    client.execute_cross_chain_message(&relayer, &CHAIN_ID, &1u64, &b(&env, p1), &proof1);

    let stats = client.get_relayer_stats(&relayer);
    assert_eq!(stats.deliveries, 2);
    assert_eq!(stats.total_refunded, stats.claimable);
}
