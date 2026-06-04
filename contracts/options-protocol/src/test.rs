// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

const STRIKE: i128 = 100_000_000;
const PREMIUM: i128 = 5_000_000;
const AMOUNT: i128 = 1_000_000_000;

fn setup() -> (Env, OptionsProtocolClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OptionsProtocol);
    let client = OptionsProtocolClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let writer = Address::generate(&env);
    let holder = Address::generate(&env);
    client.initialize(&admin).unwrap();
    (env, client, admin, writer, holder)
}

fn future(env: &Env) -> u64 {
    env.ledger().timestamp() + 86_400
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, ..) = setup();
    assert_eq!(client.get_admin().unwrap(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, ..) = setup();
    assert!(client.try_initialize(&admin).is_err());
}

#[test]
fn test_write_call_option() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client
        .write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call)
        .unwrap();
    assert_eq!(id, 1);
    assert_eq!(client.option_count(), 1);
}

#[test]
fn test_write_put_option() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client
        .write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Put)
        .unwrap();
    assert_eq!(client.get_option(&id).unwrap().kind, OptionKind::Put);
}

#[test]
fn test_write_zero_strike_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client.try_write_option(&writer, &holder, &String::from_str(&env, "XLM"), &0i128, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).is_err());
}

#[test]
fn test_write_zero_amount_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client.try_write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &0i128, &future(&env), &OptionKind::Call).is_err());
}

#[test]
fn test_write_past_expiry_fails() {
    let (env, client, _admin, writer, holder) = setup();
    assert!(client.try_write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &0u64, &OptionKind::Call).is_err());
}

#[test]
fn test_write_writer_equals_holder_fails() {
    let (env, client, _admin, writer, _holder) = setup();
    assert!(client.try_write_option(&writer, &writer, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).is_err());
}

#[test]
fn test_exercise_success() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    let settlement = client.exercise(&holder, &id).unwrap();
    assert_eq!(settlement, STRIKE);
    assert_eq!(client.get_option(&id).unwrap().status, OptionStatus::Exercised);
}

#[test]
fn test_exercise_by_non_holder_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    assert!(client.try_exercise(&writer, &id).is_err());
}

#[test]
fn test_exercise_twice_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    client.exercise(&holder, &id).unwrap();
    assert!(client.try_exercise(&holder, &id).is_err());
}

#[test]
fn test_exercise_expired_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = env.ledger().timestamp() + 1;
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &expiry, &OptionKind::Call).unwrap();
    env.ledger().with_mut(|l| l.timestamp = expiry + 1);
    assert!(client.try_exercise(&holder, &id).is_err());
}

#[test]
fn test_cancel_by_writer() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    client.cancel_option(&writer, &id).unwrap();
    assert_eq!(client.get_option(&id).unwrap().status, OptionStatus::Cancelled);
}

#[test]
fn test_cancel_by_non_writer_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    assert!(client.try_cancel_option(&holder, &id).is_err());
}

#[test]
fn test_cancel_twice_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    client.cancel_option(&writer, &id).unwrap();
    assert!(client.try_cancel_option(&writer, &id).is_err());
}

#[test]
fn test_expire_after_expiry() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = env.ledger().timestamp() + 1;
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &expiry, &OptionKind::Call).unwrap();
    env.ledger().with_mut(|l| l.timestamp = expiry + 1);
    client.expire_option(&id).unwrap();
    assert_eq!(client.get_option(&id).unwrap().status, OptionStatus::Expired);
}

#[test]
fn test_expire_before_expiry_fails() {
    let (env, client, _admin, writer, holder) = setup();
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).unwrap();
    assert!(client.try_expire_option(&id).is_err());
}

#[test]
fn test_pause_blocks_write() {
    let (env, client, admin, writer, holder) = setup();
    client.set_paused(&admin, &true).unwrap();
    assert!(client.try_write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).is_err());
}

#[test]
fn test_unpause_allows_write() {
    let (env, client, admin, writer, holder) = setup();
    client.set_paused(&admin, &true).unwrap();
    client.set_paused(&admin, &false).unwrap();
    assert!(client.write_option(&writer, &holder, &String::from_str(&env, "XLM"), &STRIKE, &PREMIUM, &AMOUNT, &future(&env), &OptionKind::Call).is_ok());
}

#[test]
fn test_non_admin_cannot_pause() {
    let (_env, client, _admin, writer, _holder) = setup();
    assert!(client.try_set_paused(&writer, &true).is_err());
}

#[test]
fn test_get_option_not_found() {
    let (_env, client, ..) = setup();
    assert!(client.try_get_option(&999u32).is_err());
}

#[test]
fn test_option_fields_stored_correctly() {
    let (env, client, _admin, writer, holder) = setup();
    let expiry = future(&env);
    let id = client.write_option(&writer, &holder, &String::from_str(&env, "USDC"), &STRIKE, &PREMIUM, &AMOUNT, &expiry, &OptionKind::Put).unwrap();
    let opt = client.get_option(&id).unwrap();
    assert_eq!(opt.writer, writer);
    assert_eq!(opt.holder, holder);
    assert_eq!(opt.strike_price, STRIKE);
    assert_eq!(opt.premium, PREMIUM);
    assert_eq!(opt.amount, AMOUNT);
    assert_eq!(opt.expiry, expiry);
    assert_eq!(opt.kind, OptionKind::Put);
    assert_eq!(opt.status, OptionStatus::Active);
}
