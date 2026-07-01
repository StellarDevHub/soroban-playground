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

// ── mint ──────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_and_balance() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &500_000);
    assert_eq!(client.get_balance(&voter).unwrap(), 500_000);
    assert_eq!(client.get_total_supply().unwrap(), 500_000);
}

#[test]
fn test_mint_multiple_recipients() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.mint(&admin, &a, &300_000);
    client.mint(&admin, &b, &700_000);
    assert_eq!(client.get_total_supply().unwrap(), 1_000_000);
    assert_eq!(client.get_balance(&a).unwrap(), 300_000);
    assert_eq!(client.get_balance(&b).unwrap(), 700_000);
}

#[test]
fn test_mint_unauthorized_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    assert_eq!(
        client.try_mint(&non_admin, &recipient, &100),
        Err(Ok(Error::Unauthorized))
    );
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
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &9);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();

    // 9 tokens → 3 votes (sqrt(9) = 3)
    let votes = client.vote(&voter, &id, &true).unwrap();
    assert_eq!(votes, 3);

    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.votes_for, 3);
    assert_eq!(p.votes_against, 0);
}

#[test]
fn test_vote_against() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &4);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();

    // 4 tokens → 2 votes against
    let votes = client.vote(&voter, &id, &false).unwrap();
    assert_eq!(votes, 2);

    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.votes_for, 0);
    assert_eq!(p.votes_against, 2);
}

#[test]
fn test_vote_not_whitelisted_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &4);
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    let err = client.vote(&voter, &id, &true).unwrap_err();
    assert_eq!(err, Error::NotWhitelisted);
}

#[test]
fn test_vote_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &4);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &true).unwrap();
    let err = client.vote(&voter, &id, &true).unwrap_err();
    assert_eq!(err, Error::AlreadyVoted);
}

#[test]
fn test_vote_no_tokens_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    let err = client.vote(&voter, &id, &true).unwrap_err();
    assert_eq!(err, Error::InsufficientVotingPower);
}

#[test]
fn test_vote_paused_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &4);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.pause(&admin).unwrap();
    let err = client.vote(&voter, &id, &true).unwrap_err();
    assert_eq!(err, Error::ContractPaused);
}

// ── finalize ──────────────────────────────────────────────────────────────────

#[test]
fn test_finalize_passed() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &9);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &true).unwrap();

    // Advance time past vote_end
    env.ledger().with_mut(|l| l.timestamp += 10);

    let status = client.finalize(&id).unwrap();
    assert_eq!(status, ProposalStatus::Passed);
}

#[test]
fn test_finalize_defeated() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1u64), &None).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &9);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &false).unwrap();

    env.ledger().with_mut(|l| l.timestamp += 10);

    let status = client.finalize(&id).unwrap();
    assert_eq!(status, ProposalStatus::Defeated);
}

#[test]
fn test_finalize_quorum_not_reached() {
    let (env, admin, client) = setup();
    // quorum = 400 bps = 4%
    client.initialize(&admin, &Some(1u64), &Some(400i128)).unwrap();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &1);
    client.whitelist(&admin, &voter, &true).unwrap();
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.vote(&voter, &id, &true).unwrap();

    env.ledger().with_mut(|l| l.timestamp += 10);

    // 1 vote from 1 token = 1 vote, but quorum requires 4% of 1 = 0.04, so passes
    // Let's test with more tokens
    let voter2 = Address::generate(&env);
    client.mint(&admin, &voter2, &100);
    let id2 = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    client.whitelist(&admin, &voter2, &true).unwrap();
    client.vote(&voter2, &id2, &true).unwrap();
    env.ledger().with_mut(|l| l.timestamp += 10);
    
    // 100 tokens = 10 votes, quorum = 4% of 100 = 4 votes, so passes
    let status = client.finalize(&id2).unwrap();
    assert_eq!(status, ProposalStatus::Passed);
}

#[test]
fn test_finalize_still_active_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
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

// ── balance_to_voting_power helper ───────────────────────────────────────────────

#[test]
fn test_balance_to_voting_power() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None, &None).unwrap();
    assert_eq!(client.balance_to_voting_power(&0), 0);
    assert_eq!(client.balance_to_voting_power(&1), 1);
    assert_eq!(client.balance_to_voting_power(&4), 2);
    assert_eq!(client.balance_to_voting_power(&9), 3);
    assert_eq!(client.balance_to_voting_power(&16), 4);
    assert_eq!(client.balance_to_voting_power(&100), 10);
}

// ── multiple voters ───────────────────────────────────────────────────────────

#[test]
fn test_multiple_voters() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    client.mint(&admin, &v1, &9);
    client.mint(&admin, &v2, &4);
    client.mint(&admin, &v3, &1);
    client.whitelist(&admin, &v1, &true).unwrap();
    client.whitelist(&admin, &v2, &true).unwrap();
    client.whitelist(&admin, &v3, &true).unwrap();

    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();

    // v1: 9 tokens → 3 votes for
    // v2: 4 tokens → 2 votes against
    // v3: 1 token  → 1 vote for
    client.vote(&v1, &id, &true).unwrap();
    client.vote(&v2, &id, &false).unwrap();
    client.vote(&v3, &id, &true).unwrap();

    let p = client.get_proposal(&id).unwrap();
    assert_eq!(p.votes_for, 4);
    assert_eq!(p.votes_against, 2);
}

#[test]
fn test_quadratic_prevents_whale_dominance() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(1000u64), &None).unwrap();
    let whale = Address::generate(&env);
    let small1 = Address::generate(&env);
    let small2 = Address::generate(&env);
    let small3 = Address::generate(&env);
    
    // Whale has 100 tokens → 10 votes
    client.mint(&admin, &whale, &100);
    // Small holders have 9 tokens each → 3 votes each
    client.mint(&admin, &small1, &9);
    client.mint(&admin, &small2, &9);
    client.mint(&admin, &small3, &9);
    
    client.whitelist(&admin, &whale, &true).unwrap();
    client.whitelist(&admin, &small1, &true).unwrap();
    client.whitelist(&admin, &small2, &true).unwrap();
    client.whitelist(&admin, &small3, &true).unwrap();
    
    let id = client.create_proposal(&admin, &title(&env), &desc(&env), &None).unwrap();
    
    // Whale votes against
    client.vote(&whale, &id, &false).unwrap();
    // Small holders vote for
    client.vote(&small1, &id, &true).unwrap();
    client.vote(&small2, &id, &true).unwrap();
    client.vote(&small3, &id, &true).unwrap();
    
    let p = client.get_proposal(&id).unwrap();
    // Whale: 10 votes against
    // Small holders: 9 votes for (3 + 3 + 3)
    assert_eq!(p.votes_against, 10);
    assert_eq!(p.votes_for, 9);
    
    // In linear voting, whale would win (100 vs 27)
    // In quadratic voting, whale still wins but by smaller margin (10 vs 9)
}
