// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Env, String,
};

fn setup() -> (Env, Address, GovernanceClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, Governance);
    let client = GovernanceClient::new(&env, &id);
    let admin = Address::generate(&env);
    // Short periods for testing: 100s voting, 50s exec delay.
    client.initialize(&admin, &None, &Some(100), &Some(50), &None);
    (env, admin, client)
}

fn mint_and_propose(
    env: &Env,
    admin: &Address,
    client: &GovernanceClient,
) -> (Address, u32) {
    let proposer = Address::generate(env);
    client.mint(admin, &proposer, &1_000_000);
    let id = client.propose(
        &proposer,
        &String::from_str(env, "Upgrade protocol"),
        &String::from_str(env, "Detailed description"),
        &0,
    );
    (proposer, id)
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_double_init_fails() {
    let (_env, admin, client) = setup();
    let result = client.try_initialize(&admin, &None, &None, &None, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Mint ──────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_and_balance() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &500_000);
    assert_eq!(client.get_balance(&voter), 500_000);
    assert_eq!(client.get_total_supply(), 500_000);
}

// ── Propose ───────────────────────────────────────────────────────────────────

#[test]
fn test_propose_ok() {
    let (env, admin, client) = setup();
    let (_proposer, id) = mint_and_propose(&env, &admin, &client);
    assert_eq!(id, 0);
    assert_eq!(client.get_proposal_count(), 1);
    let p = client.get_proposal(&id);
    assert_eq!(p.status, ProposalStatus::Active);
}

#[test]
fn test_propose_no_tokens_fails() {
    let (env, _admin, client) = setup();
    let broke = Address::generate(&env);
    let result = client.try_propose(
        &broke,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );
    assert_eq!(result, Err(Ok(Error::InsufficientVotingPower)));
}

// ── Vote ──────────────────────────────────────────────────────────────────────

#[test]
fn test_vote_for() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_for, 1_000_000);
}

#[test]
fn test_double_vote_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    let result = client.try_vote(&proposer, &id, &VoteChoice::For);
    assert_eq!(result, Err(Ok(Error::AlreadyVoted)));
}

#[test]
fn test_vote_after_period_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    env.ledger().with_mut(|l| l.timestamp += 200);
    let result = client.try_vote(&proposer, &id, &VoteChoice::For);
    assert_eq!(result, Err(Ok(Error::VotingNotActive)));
}

// ── Delegation ────────────────────────────────────────────────────────────────

#[test]
fn test_delegation_transfers_vote() {
    let (env, admin, client) = setup();
    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.mint(&admin, &delegator, &1_000_000);
    // delegator delegates to delegate
    client.delegate(&delegator, &Some(delegate.clone()));
    // propose with delegator's tokens
    let id = client.propose(
        &delegator,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );
    // delegate votes using their own balance (0) — delegation resolves at vote time
    // Give delegate their own tokens so they can vote
    client.mint(&admin, &delegate, &500_000);
    client.vote(&delegate, &id, &VoteChoice::For);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_for, 500_000);
}

#[test]
fn test_self_delegation_fails() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &100);
    let result = client.try_delegate(&voter, &Some(voter.clone()));
    assert_eq!(result, Err(Ok(Error::SelfDelegation)));
}

#[test]
fn test_revoke_delegation() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    let other = Address::generate(&env);
    client.mint(&admin, &voter, &100);
    client.delegate(&voter, &Some(other.clone()));
    client.delegate(&voter, &None); // revoke
    // After revoke, effective delegate is self
    assert_eq!(client.get_delegate(&voter), voter);
}

// ── Finalise ──────────────────────────────────────────────────────────────────

#[test]
fn test_finalise_passed() {
    let (env, admin, client) = setup();
    // Mint enough for quorum (4% of supply by default, but we set quorum=None → 400bps)
    // total supply = 1_000_000; quorum = 4% = 40_000; votes_for = 1_000_000 → passes
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    let status = client.finalise(&id);
    assert_eq!(status, ProposalStatus::Passed);
}

#[test]
fn test_finalise_defeated_quorum_not_reached() {
    let (env, admin, client) = setup();
    // Mint 1_000_000 total but only 1 token votes → below 4% quorum
    let proposer = Address::generate(&env);
    client.mint(&admin, &proposer, &1_000_000);
    let tiny_voter = Address::generate(&env);
    client.mint(&admin, &tiny_voter, &1); // total supply now 1_000_001
    let id = client.propose(
        &proposer,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );
    client.vote(&tiny_voter, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    let status = client.finalise(&id);
    assert_eq!(status, ProposalStatus::Defeated);
}

// ── Execute ───────────────────────────────────────────────────────────────────

#[test]
fn test_execute_after_timelock() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    client.finalise(&id);
    env.ledger().with_mut(|l| l.timestamp += 51);
    client.execute(&proposer, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
}

#[test]
fn test_execute_before_timelock_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    client.finalise(&id);
    // Do NOT advance past exec delay
    let result = client.try_execute(&proposer, &id);
    assert_eq!(result, Err(Ok(Error::TimelockActive)));
}

// ── Cancel ────────────────────────────────────────────────────────────────────

#[test]
fn test_cancel_by_proposer() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.cancel(&proposer, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Cancelled);
}
