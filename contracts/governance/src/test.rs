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

#[test]
fn test_not_initialized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, Governance);
    let client = GovernanceClient::new(&env, &id);
    let user = Address::generate(&env);
    assert_eq!(
        client.try_get_proposal_count(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_get_total_supply(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_get_balance(&user),
        Err(Ok(Error::NotInitialized))
    );
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

#[test]
fn test_mint_multiple_recipients() {
    let (env, admin, client) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.mint(&admin, &a, &300_000);
    client.mint(&admin, &b, &700_000);
    assert_eq!(client.get_total_supply(), 1_000_000);
    assert_eq!(client.get_balance(&a), 300_000);
    assert_eq!(client.get_balance(&b), 700_000);
}

#[test]
fn test_mint_accumulates_balance() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &100_000);
    client.mint(&admin, &voter, &200_000);
    assert_eq!(client.get_balance(&voter), 300_000);
    assert_eq!(client.get_total_supply(), 300_000);
}

#[test]
fn test_mint_unauthorized_fails() {
    let (env, _admin, client) = setup();
    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    assert_eq!(
        client.try_mint(&non_admin, &recipient, &100),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_zero_balance_by_default() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    assert_eq!(client.get_balance(&user), 0);
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
fn test_propose_increments_count() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    client.mint(&admin, &proposer, &1_000_000);
    client.propose(&proposer, &String::from_str(&env, "P1"), &String::from_str(&env, "d"), &0);
    client.propose(&proposer, &String::from_str(&env, "P2"), &String::from_str(&env, "d"), &0);
    client.propose(&proposer, &String::from_str(&env, "P3"), &String::from_str(&env, "d"), &0);
    assert_eq!(client.get_proposal_count(), 3);
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

#[test]
fn test_propose_empty_title_fails() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    client.mint(&admin, &proposer, &1_000_000);
    let result = client.try_propose(
        &proposer,
        &String::from_str(&env, ""),
        &String::from_str(&env, "desc"),
        &0,
    );
    assert_eq!(result, Err(Ok(Error::EmptyTitle)));
}

#[test]
fn test_propose_insufficient_deposit_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, Governance);
    let client = GovernanceClient::new(&env, &id);
    let admin = Address::generate(&env);
    // Require 1000 deposit
    client.initialize(&admin, &None, &Some(100), &Some(50), &Some(1000));
    let proposer = Address::generate(&env);
    client.mint(&admin, &proposer, &1_000_000);
    let result = client.try_propose(
        &proposer,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &500, // below required 1000
    );
    assert_eq!(result, Err(Ok(Error::InsufficientDeposit)));
}

#[test]
fn test_propose_snapshot_total_supply() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    client.mint(&admin, &proposer, &1_000_000);
    let id = client.propose(
        &proposer,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );
    // Mint more after proposal — snapshot should not change
    let other = Address::generate(&env);
    client.mint(&admin, &other, &500_000);
    let p = client.get_proposal(&id);
    assert_eq!(p.total_supply_snapshot, 1_000_000);
}

#[test]
fn test_get_nonexistent_proposal_fails() {
    let (_env, _admin, client) = setup();
    assert_eq!(
        client.try_get_proposal(&99),
        Err(Ok(Error::ProposalNotFound))
    );
}

// ── Vote ──────────────────────────────────────────────────────────────────────

#[test]
fn test_vote_for() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_for, 1_000_000);
    assert_eq!(p.votes_against, 0);
    assert_eq!(p.votes_abstain, 0);
}

#[test]
fn test_vote_against() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::Against);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_against, 1_000_000);
}

#[test]
fn test_vote_abstain() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::Abstain);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_abstain, 1_000_000);
}

#[test]
fn test_multiple_voters() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    client.mint(&admin, &voter2, &400_000);
    client.mint(&admin, &voter3, &200_000);
    client.vote(&proposer, &id, &VoteChoice::For);
    client.vote(&voter2, &id, &VoteChoice::Against);
    client.vote(&voter3, &id, &VoteChoice::Abstain);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_for, 1_000_000);
    assert_eq!(p.votes_against, 400_000);
    assert_eq!(p.votes_abstain, 200_000);
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

#[test]
fn test_vote_no_tokens_fails() {
    let (env, admin, client) = setup();
    let (_proposer, id) = mint_and_propose(&env, &admin, &client);
    let no_tokens = Address::generate(&env);
    let result = client.try_vote(&no_tokens, &id, &VoteChoice::For);
    assert_eq!(result, Err(Ok(Error::InsufficientVotingPower)));
}

#[test]
fn test_vote_on_nonexistent_proposal_fails() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &100);
    assert_eq!(
        client.try_vote(&voter, &99, &VoteChoice::For),
        Err(Ok(Error::ProposalNotFound))
    );
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

#[test]
fn test_get_delegate_no_delegation_returns_self() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &100);
    assert_eq!(client.get_delegate(&voter), voter);
}

#[test]
fn test_voting_power_equals_balance() {
    let (env, admin, client) = setup();
    let voter = Address::generate(&env);
    client.mint(&admin, &voter, &750_000);
    assert_eq!(client.get_voting_power(&voter), 750_000);
}

// ── Finalise ──────────────────────────────────────────────────────────────────

#[test]
fn test_finalise_passed() {
    let (env, admin, client) = setup();
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

#[test]
fn test_finalise_defeated_majority_against() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    let against_voter = Address::generate(&env);
    client.mint(&admin, &proposer, &400_000);
    client.mint(&admin, &against_voter, &600_000);
    let id = client.propose(
        &proposer,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );
    client.vote(&proposer, &id, &VoteChoice::For);
    client.vote(&against_voter, &id, &VoteChoice::Against);
    env.ledger().with_mut(|l| l.timestamp += 101);
    let status = client.finalise(&id);
    assert_eq!(status, ProposalStatus::Defeated);
}

#[test]
fn test_finalise_before_voting_ends_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    // Do NOT advance past vote_end
    let result = client.try_finalise(&id);
    assert_eq!(result, Err(Ok(Error::VotingNotActive)));
}

#[test]
fn test_finalise_already_finalised_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    client.finalise(&id);
    let result = client.try_finalise(&id);
    assert_eq!(result, Err(Ok(Error::ProposalNotActive)));
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

#[test]
fn test_execute_defeated_proposal_fails() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    let against = Address::generate(&env);
    client.mint(&admin, &proposer, &400_000);
    client.mint(&admin, &against, &600_000);
    let id = client.propose(
        &proposer,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );
    client.vote(&proposer, &id, &VoteChoice::For);
    client.vote(&against, &id, &VoteChoice::Against);
    env.ledger().with_mut(|l| l.timestamp += 101);
    client.finalise(&id);
    env.ledger().with_mut(|l| l.timestamp += 51);
    let result = client.try_execute(&proposer, &id);
    assert_eq!(result, Err(Ok(Error::ProposalNotPassed)));
}

#[test]
fn test_execute_twice_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    client.finalise(&id);
    env.ledger().with_mut(|l| l.timestamp += 51);
    client.execute(&proposer, &id);
    let result = client.try_execute(&proposer, &id);
    assert_eq!(result, Err(Ok(Error::ProposalNotPassed)));
}

// ── Cancel ────────────────────────────────────────────────────────────────────

#[test]
fn test_cancel_by_proposer() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.cancel(&proposer, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Cancelled);
}

#[test]
fn test_cancel_by_admin() {
    let (env, admin, client) = setup();
    let (_proposer, id) = mint_and_propose(&env, &admin, &client);
    client.cancel(&admin, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Cancelled);
}

#[test]
fn test_cancel_by_unauthorized_fails() {
    let (env, admin, client) = setup();
    let (_proposer, id) = mint_and_propose(&env, &admin, &client);
    let random = Address::generate(&env);
    assert_eq!(
        client.try_cancel(&random, &id),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_cancel_already_cancelled_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.cancel(&proposer, &id);
    assert_eq!(
        client.try_cancel(&proposer, &id),
        Err(Ok(Error::ProposalNotActive))
    );
}

#[test]
fn test_cancel_passed_proposal_fails() {
    let (env, admin, client) = setup();
    let (proposer, id) = mint_and_propose(&env, &admin, &client);
    client.vote(&proposer, &id, &VoteChoice::For);
    env.ledger().with_mut(|l| l.timestamp += 101);
    client.finalise(&id);
    assert_eq!(
        client.try_cancel(&proposer, &id),
        Err(Ok(Error::ProposalNotActive))
    );
}

// ── Upgrade — 2-step timelock ──────────────────────────────────────────────────

/// Build a dummy 32-byte WASM hash for testing (all zeros or arbitrary bytes).
fn dummy_wasm_hash(env: &Env) -> soroban_sdk::BytesN<32> {
    soroban_sdk::BytesN::from_array(env, &[0u8; 32])
}

fn dummy_wasm_hash_b(env: &Env) -> soroban_sdk::BytesN<32> {
    soroban_sdk::BytesN::from_array(env, &[1u8; 32])
}

const MIN_DELAY: u64 = 172_800; // 48 hours in seconds

#[test]
fn test_schedule_upgrade_ok() {
    let (env, admin, client) = setup();
    let hash = dummy_wasm_hash(&env);
    let execute_after = client.schedule_upgrade(&admin, &hash, &MIN_DELAY);
    // execute_after should be now + delay
    let now = env.ledger().timestamp();
    // The schedule call was made at time `now`; execute_after = now + MIN_DELAY
    // (we can only bound-check since timestamp may tick)
    assert!(execute_after >= MIN_DELAY);
    // Pending upgrade should be visible
    let pending = client.get_pending_upgrade().unwrap();
    assert_eq!(pending.wasm_hash, hash);
    assert_eq!(pending.execute_after, execute_after);
}

#[test]
fn test_schedule_upgrade_delay_too_short_fails() {
    let (env, admin, client) = setup();
    let hash = dummy_wasm_hash(&env);
    // 47 hours and 59 minutes — one second short
    let too_short = MIN_DELAY - 1;
    let result = client.try_schedule_upgrade(&admin, &hash, &too_short);
    assert_eq!(result, Err(Ok(Error::UpgradeDelayTooShort)));
}

#[test]
fn test_schedule_upgrade_unauthorized_fails() {
    let (env, _admin, client) = setup();
    let non_admin = Address::generate(&env);
    let hash = dummy_wasm_hash(&env);
    let result = client.try_schedule_upgrade(&non_admin, &hash, &MIN_DELAY);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_execute_upgrade_before_timelock_fails() {
    let (env, admin, client) = setup();
    let hash = dummy_wasm_hash(&env);
    client.schedule_upgrade(&admin, &hash, &MIN_DELAY);
    // Advance only 47 hours — timelock not yet elapsed
    env.ledger().with_mut(|l| l.timestamp += MIN_DELAY - 1);
    let result = client.try_execute_upgrade(&admin, &hash);
    assert_eq!(result, Err(Ok(Error::UpgradeTimelockActive)));
}

#[test]
fn test_execute_upgrade_hash_mismatch_fails() {
    let (env, admin, client) = setup();
    let hash_a = dummy_wasm_hash(&env);
    let hash_b = dummy_wasm_hash_b(&env);
    client.schedule_upgrade(&admin, &hash_a, &MIN_DELAY);
    env.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    // Pass a different hash
    let result = client.try_execute_upgrade(&admin, &hash_b);
    assert_eq!(result, Err(Ok(Error::UpgradeHashMismatch)));
}

#[test]
fn test_execute_upgrade_no_pending_fails() {
    let (env, admin, client) = setup();
    let hash = dummy_wasm_hash(&env);
    // No schedule_upgrade call — there is no pending upgrade
    let result = client.try_execute_upgrade(&admin, &hash);
    assert_eq!(result, Err(Ok(Error::UpgradeNotScheduled)));
}

#[test]
fn test_execute_upgrade_unauthorized_fails() {
    let (env, admin, client) = setup();
    let non_admin = Address::generate(&env);
    let hash = dummy_wasm_hash(&env);
    client.schedule_upgrade(&admin, &hash, &MIN_DELAY);
    env.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    let result = client.try_execute_upgrade(&non_admin, &hash);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_cancel_upgrade_ok() {
    let (env, admin, client) = setup();
    let hash = dummy_wasm_hash(&env);
    client.schedule_upgrade(&admin, &hash, &MIN_DELAY);
    client.cancel_upgrade(&admin);
    // After cancel, pending upgrade should be None
    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
fn test_cancel_upgrade_no_pending_fails() {
    let (_env, admin, client) = setup();
    let result = client.try_cancel_upgrade(&admin);
    assert_eq!(result, Err(Ok(Error::UpgradeNotScheduled)));
}

#[test]
fn test_cancel_upgrade_unauthorized_fails() {
    let (env, admin, client) = setup();
    let non_admin = Address::generate(&env);
    let hash = dummy_wasm_hash(&env);
    client.schedule_upgrade(&admin, &hash, &MIN_DELAY);
    let result = client.try_cancel_upgrade(&non_admin);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_reschedule_upgrade_overwrites_previous() {
    let (env, admin, client) = setup();
    let hash_a = dummy_wasm_hash(&env);
    let hash_b = dummy_wasm_hash_b(&env);
    client.schedule_upgrade(&admin, &hash_a, &MIN_DELAY);
    // Reschedule with a different hash
    client.schedule_upgrade(&admin, &hash_b, &MIN_DELAY);
    let pending = client.get_pending_upgrade().unwrap();
    assert_eq!(pending.wasm_hash, hash_b);
}

#[test]
fn test_get_pending_upgrade_none_when_not_scheduled() {
    let (_env, _admin, client) = setup();
    assert_eq!(client.get_pending_upgrade(), None);
}



#[test]
fn test_full_proposal_lifecycle() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    client.mint(&admin, &proposer, &500_000);
    client.mint(&admin, &voter_a, &300_000);
    client.mint(&admin, &voter_b, &200_000);

    let id = client.propose(
        &proposer,
        &String::from_str(&env, "Full lifecycle test"),
        &String::from_str(&env, "Testing the complete proposal flow"),
        &0,
    );

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Active);

    client.vote(&proposer, &id, &VoteChoice::For);
    client.vote(&voter_a, &id, &VoteChoice::For);
    client.vote(&voter_b, &id, &VoteChoice::Against);

    env.ledger().with_mut(|l| l.timestamp += 101);
    let status = client.finalise(&id);
    assert_eq!(status, ProposalStatus::Passed);

    env.ledger().with_mut(|l| l.timestamp += 51);
    client.execute(&proposer, &id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
}

// ── Delegation — resolution edge cases ─────────────────────────────────────────
//
// test_delegation_transfers_vote above only has the *delegate* call vote()
// with their own balance — it never actually exercises resolve_delegate's
// redirect (a *delegator* calling vote() themselves), its multi-hop chain
// walk, or its cycle handling, despite the module doc explicitly advertising
// "Recursive delegation (up to depth 8)" as a supported feature.

#[test]
fn test_vote_via_delegator_uses_delegates_balance() {
    let (env, admin, client) = setup();
    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);
    client.mint(&admin, &delegator, &1_000_000);
    client.mint(&admin, &delegate, &300_000);
    client.delegate(&delegator, &Some(delegate.clone()));

    let id = client.propose(
        &delegator,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &0,
    );

    // The delegator calls vote() directly (not the delegate). resolve_delegate
    // redirects to `delegate`, so the vote is cast with the delegate's own
    // balance (300_000), not the delegator's (1_000_000) — delegation moves
    // *who* can cast the vote, it doesn't pool balances together.
    client.vote(&delegator, &id, &VoteChoice::For);
    let p = client.get_proposal(&id);
    assert_eq!(p.votes_for, 300_000);

    // The vote is recorded against the resolved delegate, so the delegate
    // themselves is now blocked from voting again on this proposal too.
    let result = client.try_vote(&delegate, &id, &VoteChoice::Against);
    assert_eq!(result, Err(Ok(Error::AlreadyVoted)));
}

#[test]
fn test_delegation_chain_resolves_through_multiple_hops() {
    let (env, admin, client) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    client.mint(&admin, &a, &100);
    client.mint(&admin, &c, &900);

    // a -> b -> c: resolving from `a` must walk both hops to reach `c`.
    client.delegate(&a, &Some(b.clone()));
    client.delegate(&b, &Some(c.clone()));

    assert_eq!(client.get_delegate(&a), c);
    assert_eq!(client.get_voting_power(&a), 100); // own balance, unaffected by delegating out
}

#[test]
fn test_delegation_cycle_resolves_without_panicking() {
    // Mutual delegation (a -> b -> a) must not infinite-loop or panic;
    // resolve_delegate is bounded to 8 iterations specifically so a cycle
    // like this terminates deterministically instead of hanging.
    let (env, admin, client) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.mint(&admin, &a, &100);
    client.mint(&admin, &b, &200);

    client.delegate(&a, &Some(b.clone()));
    client.delegate(&b, &Some(a.clone()));

    // Must resolve to *some* address in the cycle without panicking, and
    // resolving repeatedly must be stable (same input state, same output).
    let resolved_first = client.get_delegate(&a);
    assert!(resolved_first == a || resolved_first == b);
    assert_eq!(client.get_delegate(&a), resolved_first);
}
