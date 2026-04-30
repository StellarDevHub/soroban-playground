// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{QuadraticVoting, QuadraticVotingClient};
use crate::types::{Error, ProposalStatus};

fn setup() -> (Env, Address, QuadraticVotingClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, QuadraticVoting);
    let client = QuadraticVotingClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn title(env: &Env) -> String {
    String::from_str(env, "Test Proposal")
}
fn desc(env: &Env) -> String {
    String::from_str(env, "A test proposal description")
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    assert_eq!(client.get_admin().unwrap(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let err = client.initialize(&admin, &None, &None).unwrap_err();
    assert_eq!(err, Error::AlreadyInitialized);
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    assert!(!client.is_paused());
    client.pause(&admin).unwrap();
    assert!(client.is_paused());
    client.unpause(&admin).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_whitelist() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    client.pause(&admin).unwrap();
    let voter = Address::generate(&env);
    let err = client.whitelist(&admin, &voter, &true).unwrap_err();
    assert_eq!(err, Error::ContractPaused);
}

#[test]
fn test_non_admin_cannot_pause() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let other = Address::generate(&env);
    let err = client.pause(&other).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

// ── whitelist ─────────────────────────────────────────────────────────────────

#[test]
fn test_whitelist_add_remove() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let voter = Address::generate(&env);
    assert!(!client.is_whitelisted(&voter).unwrap());
    client.whitelist(&admin, &voter, &true).unwrap();
    assert!(client.is_whitelisted(&voter).unwrap());
    client.whitelist(&admin, &voter, &false).unwrap();
    assert!(!client.is_whitelisted(&voter).unwrap());
}

// ── create_proposal ───────────────────────────────────────────────────────────

#[test]
fn test_create_proposal_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    assert_eq!(id, 0);
    assert_eq!(client.get_proposal_count().unwrap(), 1);
    let p = client.get_proposal(&0).unwrap();
    assert_eq!(p.status, ProposalStatus::Active);
    assert_eq!(p.votes_for, 0);
    assert_eq!(p.votes_against, 0);
}

#[test]
fn test_create_proposal_empty_title_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let err = client.create_proposal(&admin, &String::from_str(&env, ""), &desc(&env), &None).unwrap_err();
    assert_eq!(err, Error::EmptyTitle);
}

#[test]
fn test_non_admin_cannot_create_proposal() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let other = Address::generate(&env);
    let err = client.create_proposal(&other, &title(&env), &desc(&env), &None).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

// ── vote ──────────────────────────────────────────────────────────────────────

#[test]
fn test_vote_quadratic_math() {
    let (env, admin, client) = setup();
    // voting period = 1000s
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();

    // 9 credits → 3 votes (sqrt(9) = 3)
    let votes = client.vote(&voter, &id, &9, &true).unwrap();
    assert_eq!(votes, 3);

    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.votes_for, 3);
    assert_eq!(p.votes_against, 0);
}

#[test]
fn test_vote_against() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();

    // 4 credits → 2 votes against
    let votes = client.vote(&voter, &id, &4, &false).unwrap();
    assert_eq!(votes, 2);

    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.votes_for, 0);
    assert_eq!(p.votes_against, 2);
}

#[test]
fn test_vote_not_whitelisted_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    let err = client.vote(&voter, &id, &4, &true).unwrap_err();
    assert_eq!(err, Error::NotWhitelisted);
}

#[test]
fn test_vote_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &4, &true).unwrap();
    let err = client.vote(&voter, &id, &4, &true).unwrap_err();
    assert_eq!(err, Error::AlreadyVoted);
}

#[test]
fn test_vote_exceeds_max_credits_fails() {
    let (env, admin, client) = setup();
    // max_credits = 10
    client.initialize(&admin, &Some(1000u64), &Some(10i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    let err = client.vote(&voter, &id, &11, &true).unwrap_err();
    assert_eq!(err, Error::ExceedsMaxCredits);
}

#[test]
fn test_vote_zero_credits_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    let err = client.vote(&voter, &id, &0, &true).unwrap_err();
    assert_eq!(err, Error::InvalidCredits);
}

#[test]
fn test_vote_paused_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.pause(&admin).unwrap();
    let err = client.vote(&voter, &id, &4, &true).unwrap_err();
    assert_eq!(err, Error::ContractPaused);
}

// ── finalize ──────────────────────────────────────────────────────────────────

#[test]
fn test_finalize_passed() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &9, &true).unwrap();

    // Advance time past vote_end
    env.ledger().with_mut(|l| l.timestamp += 10);

    let status = client.finalize(&id).unwrap();
    assert_eq!(status, ProposalStatus::Passed);
}

#[test]
fn test_finalize_defeated() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1u64), &Some(1000i128)).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &9, &false).unwrap();

    env.ledger().with_mut(|l| l.timestamp += 10);

    let status = client.finalize(&id).unwrap();
    assert_eq!(status, ProposalStatus::Defeated);
}

#[test]
fn test_finalize_still_active_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    let err = client.finalize(&id).unwrap_err();
    assert_eq!(err, Error::VotingStillActive);
}

// ── cancel_proposal ───────────────────────────────────────────────────────────

#[test]
fn test_cancel_proposal() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.cancel_proposal(&admin, &id).unwrap();
    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.status, ProposalStatus::Cancelled);
}

// ── credits_to_votes helper ───────────────────────────────────────────────────

#[test]
fn test_credits_to_votes() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    assert_eq!(client.credits_to_votes(&0), 0);
    assert_eq!(client.credits_to_votes(&1), 1);
    assert_eq!(client.credits_to_votes(&4), 2);
    assert_eq!(client.credits_to_votes(&9), 3);
    assert_eq!(client.credits_to_votes(&16), 4);
    assert_eq!(client.credits_to_votes(&100), 10);
}

// ── multiple voters ───────────────────────────────────────────────────────────

#[test]
fn test_multiple_voters() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &Some(1000i128)).unwrap();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    client.whitelist(&admin, &v1, &true).unwrap();
    client.whitelist(&admin, &v2, &true).unwrap();
    client.whitelist(&admin, &v3, &true).unwrap();

    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();

    // v1: 9 credits → 3 votes for
    // v2: 4 credits → 2 votes against
    // v3: 1 credit  → 1 vote for
    client.vote(&v1, &id, &9, &true).unwrap();
    client.vote(&v2, &id, &4, &false).unwrap();
    client.vote(&v3, &id, &1, &true).unwrap();

    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.votes_for, 4);
    assert_eq!(p.votes_against, 2);
}
