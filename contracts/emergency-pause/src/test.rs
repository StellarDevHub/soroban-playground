// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Comprehensive test suite for the Emergency Pause contract.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, FromVal, String, Symbol, Vec,
};

use crate::types::Error;
use crate::{
    EmergencyPause, EmergencyPauseClient, EMERGENCY_WITHDRAW_DELAY_SECS, UNPAUSE_TIMELOCK_SECS,
};

struct Fixture {
    env: Env,
    client: EmergencyPauseClient<'static>,
    admins: Vec<Address>,
    guardian: Address,
}

fn addresses(env: &Env, count: u32) -> Vec<Address> {
    let mut values = Vec::new(env);
    for _ in 0..count {
        values.push_back(Address::generate(env));
    }
    values
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register_contract(None, EmergencyPause);
    let client = EmergencyPauseClient::new(&env, &id);

    let admins = addresses(&env, 3);
    let guardian = Address::generate(&env);
    let guardian2 = Address::generate(&env);

    client.initialize(&admins, &2);
    client.add_guardian(&signers(&env, &admins, 2), &guardian);
    client.add_guardian(&signers(&env, &admins, 2), &guardian2);

    let env = std::boxed::Box::leak(std::boxed::Box::new(env));
    let client = EmergencyPauseClient::new(env, &id);

    Fixture {
        env: env.clone(),
        client,
        admins,
        guardian,
    }
}

fn signers(env: &Env, admins: &Vec<Address>, count: u32) -> Vec<Address> {
    let mut values = Vec::new(env);
    for i in 0..count {
        values.push_back(admins.get(i).unwrap());
    }
    values
}

fn advance_time(env: &Env, delta: u64) {
    env.ledger().with_mut(|l| l.timestamp += delta);
}

fn make_str(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}

fn last_topic(env: &Env) -> Symbol {
    let event = env.events().all().last().unwrap();
    let value = event.1.get(0).unwrap();
    Symbol::from_val(env, &value)
}

fn setup_token(fixture: &Fixture, user: &Address, amount: i128) -> Address {
    let token_admin = fixture.admins.get(0).unwrap();
    let token_id = fixture
        .env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    fixture
        .client
        .set_token(&signers(&fixture.env, &fixture.admins, 2), &token_id);
    StellarAssetClient::new(&fixture.env, &token_id).mint(user, &amount);

    token_id
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_admin_set_and_threshold() {
    let f = setup();
    assert_eq!(f.client.get_admins(), f.admins);
    assert_eq!(f.client.get_admin_threshold(), 2);
    assert_eq!(f.client.admin_count(), 3);
    assert!(!f.client.paused());
}

#[test]
fn initialize_rejects_threshold_below_two() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, EmergencyPause);
    let client = EmergencyPauseClient::new(&env, &id);
    let admins = addresses(&env, 2);

    assert_eq!(
        client.try_initialize(&admins, &1),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        client.try_initialize(&admins, &0),
        Err(Ok(Error::InvalidThreshold))
    );
}

#[test]
fn initialize_rejects_threshold_above_signer_count() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, EmergencyPause);
    let client = EmergencyPauseClient::new(&env, &id);
    let admins = addresses(&env, 2);

    assert_eq!(
        client.try_initialize(&admins, &3),
        Err(Ok(Error::InvalidThreshold))
    );
}

#[test]
fn initialize_rejects_duplicate_admins() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, EmergencyPause);
    let client = EmergencyPauseClient::new(&env, &id);
    let admin = Address::generate(&env);
    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());
    admins.push_back(admin);

    assert_eq!(
        client.try_initialize(&admins, &2),
        Err(Ok(Error::DuplicateSigner))
    );
}

#[test]
fn initialize_twice_fails() {
    let f = setup();
    assert_eq!(
        f.client.try_initialize(&f.admins, &2),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── Guardian management ───────────────────────────────────────────────────────

#[test]
fn add_and_remove_guardian_with_admin_quorum() {
    let f = setup();
    let guardian = Address::generate(&f.env);

    f.client
        .add_guardian(&signers(&f.env, &f.admins, 2), &guardian);
    assert!(f.client.is_guardian(&guardian));
    assert_eq!(f.client.guardian_count(), 3);

    f.client
        .remove_guardian(&signers(&f.env, &f.admins, 2), &guardian);
    assert!(!f.client.is_guardian(&guardian));
    assert_eq!(f.client.guardian_count(), 2);
}

#[test]
fn add_guardian_below_quorum_fails() {
    let f = setup();
    let guardian = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_add_guardian(&signers(&f.env, &f.admins, 1), &guardian),
        Err(Ok(Error::InsufficientSignatures))
    );
}

#[test]
fn add_guardian_by_non_admin_fails() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    let guardian = Address::generate(&f.env);
    let mut signers = signers(&f.env, &f.admins, 2);
    signers.set(0, stranger);

    assert_eq!(
        f.client.try_add_guardian(&signers, &guardian),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn add_duplicate_guardian_fails() {
    let f = setup();
    assert_eq!(
        f.client
            .try_add_guardian(&signers(&f.env, &f.admins, 2), &f.guardian),
        Err(Ok(Error::GuardianAlreadyAdded))
    );
}

#[test]
fn remove_unknown_guardian_fails() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(
        f.client
            .try_remove_guardian(&signers(&f.env, &f.admins, 2), &stranger),
        Err(Ok(Error::GuardianNotFound))
    );
}

#[test]
fn duplicate_signers_are_rejected() {
    let f = setup();
    let guardian = Address::generate(&f.env);
    let first = f.admins.get(0).unwrap();
    let mut signers = Vec::new(&f.env);
    signers.push_back(first.clone());
    signers.push_back(first);

    assert_eq!(
        f.client.try_add_guardian(&signers, &guardian),
        Err(Ok(Error::DuplicateSigner))
    );
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn guardian_can_pause_immediately() {
    let f = setup();
    f.client.pause(&f.guardian);
    assert!(f.client.paused());
    assert_eq!(
        f.client.get_pause_timestamp(),
        Some(f.env.ledger().timestamp())
    );
}

#[test]
fn admin_can_pause_immediately() {
    let f = setup();
    f.client.pause(&f.admins.get(0).unwrap());
    assert!(f.client.paused());
}

#[test]
fn pause_with_reason_records_reason() {
    let f = setup();
    let reason = make_str(&f.env, "exploit detected");
    f.client.pause_with_reason(&f.guardian, &reason);
    assert_eq!(f.client.get_pause_reason(), Some(reason));
}

#[test]
fn unauthorized_caller_cannot_pause() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(f.client.try_pause(&stranger), Err(Ok(Error::Unauthorized)));
}

#[test]
fn re_pausing_refreshes_timestamp_and_clears_schedule() {
    let f = setup();
    f.client.pause(&f.guardian);
    let first = f.client.get_pause_timestamp().unwrap();

    advance_time(&f.env, 10);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
    assert!(f.client.get_unpause_eta().is_some());

    advance_time(&f.env, 10);
    f.client.pause(&f.guardian);

    assert_eq!(f.client.get_pause_timestamp(), Some(first + 20));
    assert!(f.client.get_unpause_eta().is_none());
}

// ── Unpause scheduling ────────────────────────────────────────────────────────

#[test]
fn schedule_unpause_records_24h_eta_and_emits_event() {
    let f = setup();
    f.client.pause(&f.guardian);
    let now = f.env.ledger().timestamp();

    let eta = f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));

    assert_eq!(eta, now + UNPAUSE_TIMELOCK_SECS);
    assert_eq!(f.client.get_unpause_eta(), Some(eta));
    assert_eq!(last_topic(&f.env), Symbol::new(&f.env, "unpause_scheduled"));
}

#[test]
fn schedule_unpause_requires_full_quorum() {
    let f = setup();
    f.client.pause(&f.guardian);

    assert_eq!(
        f.client
            .try_schedule_unpause(&signers(&f.env, &f.admins, 1)),
        Err(Ok(Error::InsufficientSignatures))
    );
    assert!(f.client.get_unpause_eta().is_none());
}

#[test]
fn guardian_cannot_schedule_unpause() {
    let f = setup();
    f.client.pause(&f.guardian);
    let mut signers = signers(&f.env, &f.admins, 2);
    signers.set(0, f.guardian);

    assert_eq!(
        f.client.try_schedule_unpause(&signers),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn guardian_cannot_execute_unpause() {
    let f = setup();
    f.client.pause(&f.guardian);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
    advance_time(&f.env, UNPAUSE_TIMELOCK_SECS);

    let mut signers = signers(&f.env, &f.admins, 2);
    signers.set(0, f.guardian);

    assert_eq!(
        f.client.try_execute_unpause(&signers),
        Err(Ok(Error::Unauthorized))
    );
    assert!(f.client.paused());
}

#[test]
fn schedule_unpause_requires_paused_state() {
    let f = setup();
    assert_eq!(
        f.client
            .try_schedule_unpause(&signers(&f.env, &f.admins, 2)),
        Err(Ok(Error::AlreadyInState))
    );
}

// ── Unpause execution / timelock ──────────────────────────────────────────────

#[test]
fn execute_unpause_before_timelock_fails() {
    let f = setup();
    f.client.pause(&f.guardian);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));

    advance_time(&f.env, UNPAUSE_TIMELOCK_SECS - 1);

    assert_eq!(
        f.client.try_execute_unpause(&signers(&f.env, &f.admins, 2)),
        Err(Ok(Error::TimeLockNotExpired))
    );
    assert!(f.client.paused());
}

#[test]
fn execute_unpause_at_timelock_succeeds_and_emits_event() {
    let f = setup();
    f.client.pause(&f.guardian);
    let eta = f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));

    advance_time(&f.env, UNPAUSE_TIMELOCK_SECS);
    f.client.execute_unpause(&signers(&f.env, &f.admins, 2));

    assert_eq!(f.env.ledger().timestamp(), eta);
    assert!(!f.client.paused());
    assert!(f.client.get_pause_timestamp().is_none());
    assert!(f.client.get_unpause_eta().is_none());
    assert_eq!(last_topic(&f.env), Symbol::new(&f.env, "unpaused"));
}

#[test]
fn execute_unpause_requires_quorum() {
    let f = setup();
    f.client.pause(&f.guardian);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
    advance_time(&f.env, UNPAUSE_TIMELOCK_SECS);

    assert_eq!(
        f.client.try_execute_unpause(&signers(&f.env, &f.admins, 1)),
        Err(Ok(Error::InsufficientSignatures))
    );
    assert!(f.client.paused());
}

#[test]
fn execute_unpause_requires_schedule() {
    let f = setup();
    f.client.pause(&f.guardian);

    assert_eq!(
        f.client.try_execute_unpause(&signers(&f.env, &f.admins, 2)),
        Err(Ok(Error::NoPendingUnpause))
    );
}

#[test]
fn execute_unpause_when_not_paused_fails() {
    let f = setup();
    assert_eq!(
        f.client.try_execute_unpause(&signers(&f.env, &f.admins, 2)),
        Err(Ok(Error::AlreadyInState))
    );
}

// ── Cancel unpause ────────────────────────────────────────────────────────────

#[test]
fn guardian_can_cancel_pending_unpause() {
    let f = setup();
    f.client.pause(&f.guardian);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));

    f.client.cancel_unpause(&f.guardian);
    assert!(f.client.get_unpause_eta().is_none());
    assert_eq!(last_topic(&f.env), Symbol::new(&f.env, "unpause_cancelled"));

    advance_time(&f.env, UNPAUSE_TIMELOCK_SECS);
    assert_eq!(
        f.client.try_execute_unpause(&signers(&f.env, &f.admins, 2)),
        Err(Ok(Error::NoPendingUnpause))
    );
    assert!(f.client.paused());
}

#[test]
fn admin_can_cancel_pending_unpause() {
    let f = setup();
    f.client.pause(&f.guardian);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));

    f.client.cancel_unpause(&f.admins.get(0).unwrap());
    assert!(f.client.get_unpause_eta().is_none());
}

#[test]
fn unauthorized_cancel_fails() {
    let f = setup();
    f.client.pause(&f.guardian);
    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
    let stranger = Address::generate(&f.env);

    assert_eq!(
        f.client.try_cancel_unpause(&stranger),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn cancel_without_schedule_fails() {
    let f = setup();
    f.client.pause(&f.guardian);
    assert_eq!(
        f.client.try_cancel_unpause(&f.guardian),
        Err(Ok(Error::NoPendingUnpause))
    );
}

// ── Emergency withdrawals ─────────────────────────────────────────────────────

#[test]
fn emergency_withdraw_reverts_when_unpaused() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.client.deposit(&user, &100);

    assert_eq!(
        f.client.try_emergency_withdraw(&user),
        Err(Ok(Error::AlreadyInState))
    );
}

#[test]
fn emergency_withdraw_reverts_at_or_before_14_days() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.client.deposit(&user, &100);
    f.client.pause(&f.guardian);

    advance_time(&f.env, EMERGENCY_WITHDRAW_DELAY_SECS);
    assert_eq!(
        f.client.try_emergency_withdraw(&user),
        Err(Ok(Error::EmergencyWithdrawNotAllowed))
    );

    advance_time(&f.env, 1);
    assert_eq!(f.client.emergency_withdraw(&user), 100);
}

#[test]
fn emergency_withdraw_transfers_token_and_prevents_double_withdrawal() {
    let f = setup();
    let user = Address::generate(&f.env);
    let token_id = setup_token(&f, &user, 500);
    let token = TokenClient::new(&f.env, &token_id);

    f.client.deposit(&user, &250);
    assert_eq!(token.balance(&user), 250);
    assert_eq!(f.client.balance(&user), 250);

    f.client.pause(&f.guardian);
    advance_time(&f.env, EMERGENCY_WITHDRAW_DELAY_SECS + 1);

    let amount = f.client.emergency_withdraw(&user);
    assert_eq!(amount, 250);
    assert_eq!(token.balance(&user), 500);
    assert_eq!(f.client.balance(&user), 0);
    assert_eq!(
        last_topic(&f.env),
        Symbol::new(&f.env, "emergency_withdrawal")
    );

    assert_eq!(
        f.client.try_emergency_withdraw(&user),
        Err(Ok(Error::InsufficientBalance))
    );
    assert_eq!(token.balance(&user), 500);
}

#[test]
fn emergency_withdraw_without_token_releases_tracked_balance() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.client.deposit(&user, &75);
    f.client.pause(&f.guardian);
    advance_time(&f.env, EMERGENCY_WITHDRAW_DELAY_SECS + 1);

    assert_eq!(f.client.emergency_withdraw(&user), 75);
    assert_eq!(f.client.balance(&user), 0);
}

#[test]
fn emergency_withdraw_requires_user_auth() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.client.deposit(&user, &100);
    f.client.pause(&f.guardian);
    advance_time(&f.env, EMERGENCY_WITHDRAW_DELAY_SECS + 1);

    let attacker = Address::generate(&f.env);
    assert_eq!(
        f.client.try_emergency_withdraw(&attacker),
        Err(Ok(Error::InsufficientBalance))
    );
    assert_eq!(f.client.balance(&user), 100);
}

// ── Admin role transitions ────────────────────────────────────────────────────

#[test]
fn add_and_remove_admin_with_quorum() {
    let f = setup();
    let new_admin = Address::generate(&f.env);

    f.client
        .add_admin(&signers(&f.env, &f.admins, 2), &new_admin);
    assert!(f.client.is_admin(&new_admin));
    assert_eq!(f.client.admin_count(), 4);

    f.client
        .remove_admin(&signers(&f.env, &f.admins, 2), &new_admin);
    assert!(!f.client.is_admin(&new_admin));
    assert_eq!(f.client.admin_count(), 3);
}

#[test]
fn add_admin_requires_quorum() {
    let f = setup();
    let new_admin = Address::generate(&f.env);
    assert_eq!(
        f.client
            .try_add_admin(&signers(&f.env, &f.admins, 1), &new_admin),
        Err(Ok(Error::InsufficientSignatures))
    );
}

#[test]
fn remove_admin_cannot_drop_below_threshold() {
    let f = setup();
    // threshold is 2 and there are 3 admins, so removing one is fine.
    let first = f.admins.get(0).unwrap();
    f.client
        .remove_admin(&signers(&f.env, &f.admins, 2), &first);
    assert_eq!(f.client.admin_count(), 2);

    // Removing another would leave 1 < threshold 2.
    let remaining = f.client.get_admins();
    assert_eq!(
        f.client
            .try_remove_admin(&signers(&f.env, &remaining, 2), &remaining.get(0).unwrap()),
        Err(Ok(Error::InvalidThreshold))
    );
}

#[test]
fn set_admin_threshold_validates_bounds() {
    let f = setup();
    let signers = signers(&f.env, &f.admins, 2);

    assert_eq!(
        f.client.try_set_admin_threshold(&signers, &0),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        f.client.try_set_admin_threshold(&signers, &1),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        f.client.try_set_admin_threshold(&signers, &4),
        Err(Ok(Error::InvalidThreshold))
    );

    f.client.set_admin_threshold(&signers, &3);
    assert_eq!(f.client.get_admin_threshold(), 3);
}

#[test]
fn set_admins_replaces_signer_set_and_threshold() {
    let f = setup();
    let new_admins = addresses(&f.env, 3);

    f.client
        .set_admins(&signers(&f.env, &f.admins, 2), &new_admins, &3);

    assert_eq!(f.client.get_admins(), new_admins);
    assert_eq!(f.client.get_admin_threshold(), 3);

    // Old admins are no longer authorized.
    assert_eq!(
        f.client
            .try_add_guardian(&signers(&f.env, &f.admins, 3), &Address::generate(&f.env)),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn set_admins_rejects_invalid_new_configuration() {
    let f = setup();
    let new_admins = addresses(&f.env, 2);

    assert_eq!(
        f.client
            .try_set_admins(&signers(&f.env, &f.admins, 2), &new_admins, &1),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        f.client
            .try_set_admins(&signers(&f.env, &f.admins, 2), &new_admins, &3),
        Err(Ok(Error::InvalidThreshold))
    );
}

// ── Guarded action / full lifecycle ───────────────────────────────────────────

#[test]
fn do_action_blocked_while_paused_and_allowed_after_unpause() {
    let f = setup();
    let user = Address::generate(&f.env);

    f.client.do_action(&user);
    f.client.pause(&f.guardian);
    assert_eq!(
        f.client.try_do_action(&user),
        Err(Ok(Error::ContractPaused))
    );

    f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
    advance_time(&f.env, UNPAUSE_TIMELOCK_SECS);
    f.client.execute_unpause(&signers(&f.env, &f.admins, 2));

    f.client.do_action(&user);
}

#[test]
fn full_emergency_lifecycle() {
    let f = setup();
    let user = Address::generate(&f.env);
    let token_id = setup_token(&f, &user, 1_000);
    let token = TokenClient::new(&f.env, &token_id);
    f.client.deposit(&user, &400);
    assert_eq!(token.balance(&user), 600);

    // Guardian pauses immediately.
    f.client.pause(&f.guardian);
    assert!(f.client.paused());

    // Admin quorum schedules an unpause 24 hours out.
    let eta = f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
    assert_eq!(eta, f.env.ledger().timestamp() + UNPAUSE_TIMELOCK_SECS);

    // After 14 days the user can recover collateral.
    advance_time(&f.env, EMERGENCY_WITHDRAW_DELAY_SECS + 1);
    assert_eq!(f.client.emergency_withdraw(&user), 400);
    assert_eq!(token.balance(&user), 1_000);
    assert_eq!(f.client.balance(&user), 0);

    // Timelock has also elapsed, so admins can unpause.
    f.client.execute_unpause(&signers(&f.env, &f.admins, 2));
    assert!(!f.client.paused());
}

#[test]
fn multiple_pause_unpause_cycles() {
    let f = setup();
    let user = Address::generate(&f.env);

    for _ in 0..3 {
        f.client.pause(&f.guardian);
        assert!(f.client.paused());
        assert!(f.client.try_do_action(&user).is_err());

        f.client.schedule_unpause(&signers(&f.env, &f.admins, 2));
        advance_time(&f.env, UNPAUSE_TIMELOCK_SECS);
        f.client.execute_unpause(&signers(&f.env, &f.admins, 2));
        assert!(!f.client.paused());
        f.client.do_action(&user);
    }
}
