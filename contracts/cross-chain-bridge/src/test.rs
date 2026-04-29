#![cfg(test)]

use super::{types::Error, BridgeContract, BridgeContractClient};
use soroban_sdk::{
    bytes, testutils::{Address as _, Ledger}, Address, Bytes, Env, String,
};

const FEE_BPS: u32 = 100; // 1%
const EXPIRY: u64 = 3_600; // 1 hour
const DAILY_LIMIT: i128 = 1_000_000_000;

fn setup() -> (Env, BridgeContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, BridgeContract);
    let client = BridgeContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);

    client.initialize(&admin, &FEE_BPS, &EXPIRY, &DAILY_LIMIT);
    client.set_relayer(&admin, &relayer, &true);

    (env, client, admin, relayer)
}

fn eth_dest(env: &Env) -> String {
    String::from_str(env, "0xDeAdBeEf00000000000000000000000000000001")
}

fn eth_hash(env: &Env) -> Bytes {
    bytes!(env, 0xdeadbeef)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, _relayer) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
    assert!(!client.is_paused());
    assert_eq!(client.get_fee_bps(), FEE_BPS);
    assert_eq!(client.get_expiry_seconds(), EXPIRY);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, _relayer) = setup();
    let result = client.try_initialize(&admin, &FEE_BPS, &EXPIRY, &DAILY_LIMIT);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

#[test]
fn test_initialize_invalid_fee_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, BridgeContract);
    let client = BridgeContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let result = client.try_initialize(&admin, &1_001u32, &EXPIRY, &DAILY_LIMIT);
    assert!(matches!(result, Err(Ok(Error::InvalidFee))));
}

// ── Lock ──────────────────────────────────────────────────────────────────────

#[test]
fn test_lock_creates_deposit() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let amount: i128 = 1_000_000;

    let id = client.lock(&depositor, &token, &amount, &eth_dest(&env));
    assert_eq!(id, 1);
    assert_eq!(client.deposit_count(), 1);

    let deposit = client.get_deposit(&id);
    // net = amount - fee = 1_000_000 - 10_000 = 990_000
    assert_eq!(deposit.amount, 990_000);
    assert_eq!(deposit.fee, 10_000);
}

#[test]
fn test_lock_sequential_ids() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "XLM");

    let id1 = client.lock(&depositor, &token, &1_000i128, &eth_dest(&env));
    let id2 = client.lock(&depositor, &token, &2_000i128, &eth_dest(&env));
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_lock_zero_amount_fails() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let result = client.try_lock(&depositor, &token, &0i128, &eth_dest(&env));
    assert!(matches!(result, Err(Ok(Error::ZeroAmount))));
}

#[test]
fn test_lock_empty_token_fails() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let empty = String::from_str(&env, "");
    let result = client.try_lock(&depositor, &empty, &1_000i128, &eth_dest(&env));
    assert!(matches!(result, Err(Ok(Error::EmptyToken))));
}

#[test]
fn test_lock_empty_destination_fails() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let empty = String::from_str(&env, "");
    let result = client.try_lock(&depositor, &token, &1_000i128, &empty);
    assert!(matches!(result, Err(Ok(Error::EmptyDestination))));
}

#[test]
fn test_lock_when_paused_fails() {
    let (env, client, admin, _relayer) = setup();
    client.set_paused(&admin, &true);
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let result = client.try_lock(&depositor, &token, &1_000i128, &eth_dest(&env));
    assert!(matches!(result, Err(Ok(Error::BridgePaused))));
}

#[test]
fn test_lock_daily_limit_exceeded_fails() {
    let (env, client, admin, _relayer) = setup();
    // Set a tiny daily limit
    client.set_daily_limit(&admin, &500i128);
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let result = client.try_lock(&depositor, &token, &1_000i128, &eth_dest(&env));
    assert!(matches!(result, Err(Ok(Error::DailyLimitExceeded))));
}

// ── Confirm mint ──────────────────────────────────────────────────────────────

#[test]
fn test_confirm_mint_marks_minted() {
    let (env, client, _admin, relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));

    client.confirm_mint(&relayer, &id, &eth_hash(&env));

    let deposit = client.get_deposit(&id);
    assert_eq!(deposit.eth_tx_hash, Some(eth_hash(&env)));

    let stats = client.get_stats();
    assert_eq!(stats.total_minted, deposit.amount);
    assert_eq!(stats.active_deposits, 0);
}

#[test]
fn test_confirm_mint_twice_fails() {
    let (env, client, _admin, relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    client.confirm_mint(&relayer, &id, &eth_hash(&env));
    let result = client.try_confirm_mint(&relayer, &id, &eth_hash(&env));
    assert!(matches!(result, Err(Ok(Error::AlreadyProcessed))));
}

#[test]
fn test_confirm_mint_unknown_relayer_fails() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    let stranger = Address::generate(&env);
    let result = client.try_confirm_mint(&stranger, &id, &eth_hash(&env));
    assert!(matches!(result, Err(Ok(Error::UnknownRelayer))));
}

#[test]
fn test_confirm_mint_empty_hash_fails() {
    let (env, client, _admin, relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    let empty: Bytes = Bytes::new(&env);
    let result = client.try_confirm_mint(&relayer, &id, &empty);
    assert!(matches!(result, Err(Ok(Error::EmptyTxHash))));
}

#[test]
fn test_confirm_mint_expired_deposit_fails() {
    let (env, client, _admin, relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));

    // Advance ledger past expiry
    env.ledger().with_mut(|l| l.timestamp += EXPIRY + 1);

    let result = client.try_confirm_mint(&relayer, &id, &eth_hash(&env));
    assert!(matches!(result, Err(Ok(Error::DepositExpired))));
}

// ── Refund ────────────────────────────────────────────────────────────────────

#[test]
fn test_refund_after_expiry() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));

    env.ledger().with_mut(|l| l.timestamp += EXPIRY + 1);

    let refunded = client.refund(&depositor, &id);
    assert_eq!(refunded, 990_000i128); // net amount (fee not refunded)

    let stats = client.get_stats();
    assert_eq!(stats.total_refunded, 990_000);
    assert_eq!(stats.active_deposits, 0);
}

#[test]
fn test_refund_before_expiry_fails() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    let result = client.try_refund(&depositor, &id);
    assert!(matches!(result, Err(Ok(Error::NotExpired))));
}

#[test]
fn test_refund_wrong_depositor_fails() {
    let (env, client, _admin, _relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    env.ledger().with_mut(|l| l.timestamp += EXPIRY + 1);
    let stranger = Address::generate(&env);
    let result = client.try_refund(&stranger, &id);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_refund_already_minted_fails() {
    let (env, client, _admin, relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");
    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    client.confirm_mint(&relayer, &id, &eth_hash(&env));
    env.ledger().with_mut(|l| l.timestamp += EXPIRY + 1);
    let result = client.try_refund(&depositor, &id);
    assert!(matches!(result, Err(Ok(Error::AlreadyProcessed))));
}

// ── Admin controls ────────────────────────────────────────────────────────────

#[test]
fn test_set_fee_updates_value() {
    let (_env, client, admin, _relayer) = setup();
    client.set_fee(&admin, &50u32);
    assert_eq!(client.get_fee_bps(), 50);
}

#[test]
fn test_set_fee_invalid_fails() {
    let (_env, client, admin, _relayer) = setup();
    let result = client.try_set_fee(&admin, &1_001u32);
    assert!(matches!(result, Err(Ok(Error::InvalidFee))));
}

#[test]
fn test_set_relayer_registers_and_deregisters() {
    let (env, client, admin, relayer) = setup();
    assert!(client.is_relayer(&relayer));
    client.set_relayer(&admin, &relayer, &false);
    assert!(!client.is_relayer(&relayer));
}

#[test]
fn test_non_admin_cannot_pause() {
    let (env, client, _admin, _relayer) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_set_paused(&stranger, &true);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_stats_track_correctly() {
    let (env, client, _admin, relayer) = setup();
    let depositor = Address::generate(&env);
    let token = String::from_str(&env, "USDC");

    let id = client.lock(&depositor, &token, &1_000_000i128, &eth_dest(&env));
    client.confirm_mint(&relayer, &id, &eth_hash(&env));

    let stats = client.get_stats();
    assert_eq!(stats.deposit_count, 1);
    assert_eq!(stats.total_locked, 990_000);
    assert_eq!(stats.total_minted, 990_000);
    assert_eq!(stats.active_deposits, 0);
}
