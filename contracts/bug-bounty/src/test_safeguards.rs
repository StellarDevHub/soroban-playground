// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Tests for the researcher protections: escrow tier locks, the 30-day
//! cancellation notice, triager arbitration and proof-of-prior-art.

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, BytesN, Env, String};

const DAY: u64 = 24 * 60 * 60;
const POOL: i128 = 1_000_000_000; // exactly one Critical tier (100 XLM)
const LOW: i128 = 10_000_000;
const MEDIUM: i128 = 50_000_000;
const HIGH: i128 = 200_000_000;
const CRITICAL: i128 = 1_000_000_000;

struct Ctx {
    env: Env,
    client: BugBountyContractClient<'static>,
    admin: Address,
    reporter: Address,
}

fn setup_with_pool(pool: i128) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    client.initialize(&admin, &pool);
    Ctx {
        env,
        client,
        admin,
        reporter,
    }
}

fn setup() -> Ctx {
    setup_with_pool(POOL)
}

fn submit(c: &Ctx, who: &Address, severity: Severity) -> u32 {
    c.client.submit_report(
        who,
        &String::from_str(&c.env, "Reentrancy"),
        &String::from_str(&c.env, "QmCid"),
        &severity,
    )
}

fn advance(c: &Ctx, secs: u64) {
    c.env
        .ledger()
        .with_mut(|l| l.timestamp = l.timestamp.saturating_add(secs));
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

// ── Escrow tier locks ─────────────────────────────────────────────────────────

#[test]
fn submission_locks_the_severity_tier() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);

    assert_eq!(c.client.locked_balance(), HIGH);
    assert_eq!(c.client.available_balance(), POOL - HIGH);
    assert_eq!(c.client.pool_balance(), POOL);
    assert_eq!(c.client.active_report_count(), 1);
    assert_eq!(c.client.get_report(&id).locked_reward, HIGH);
}

#[test]
fn submission_is_refused_when_the_unlocked_pool_cannot_cover_the_tier() {
    let c = setup();
    let other = Address::generate(&c.env);
    submit(&c, &c.reporter, Severity::Critical); // locks the whole pool

    let r = c.client.try_submit_report(
        &other,
        &String::from_str(&c.env, "Another"),
        &String::from_str(&c.env, "QmOther"),
        &Severity::Low,
    );
    assert_eq!(r, Err(Ok(Error::InsufficientPool)));
    assert_eq!(c.client.report_count(), 1);
    assert_eq!(c.client.locked_balance(), CRITICAL);
}

#[test]
fn locks_of_several_reports_accumulate() {
    let c = setup();
    let other = Address::generate(&c.env);
    submit(&c, &c.reporter, Severity::High);
    submit(&c, &other, Severity::Medium);

    assert_eq!(c.client.locked_balance(), HIGH + MEDIUM);
    assert_eq!(c.client.available_balance(), POOL - HIGH - MEDIUM);
    assert_eq!(c.client.active_report_count(), 2);
}

#[test]
fn withdrawing_releases_the_lock() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::Critical);
    c.client.withdraw_report(&c.reporter, &id);

    assert_eq!(c.client.locked_balance(), 0);
    assert_eq!(c.client.available_balance(), POOL);
    assert_eq!(c.client.active_report_count(), 0);
    assert_eq!(c.client.get_report(&id).locked_reward, 0);
}

#[test]
fn rejecting_releases_the_lock() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.reject_report(&c.admin, &id);

    assert_eq!(c.client.locked_balance(), 0);
    assert_eq!(c.client.active_report_count(), 0);
}

#[test]
fn accepting_pays_the_escrow_and_clears_the_lock() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.start_review(&c.admin, &id);

    assert_eq!(c.client.accept_report(&c.admin, &id), HIGH);
    assert_eq!(c.client.pool_balance(), POOL - HIGH);
    assert_eq!(c.client.locked_balance(), 0);
    assert_eq!(c.client.active_report_count(), 0);
    let report = c.client.get_report(&id);
    assert_eq!(report.reward_amount, HIGH);
    assert_eq!(report.locked_reward, 0);
}

#[test]
fn lowering_the_tier_after_submission_cannot_shrink_the_payout() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.start_review(&c.admin, &id);

    c.client.set_reward(&c.admin, &Severity::High, &1);
    assert_eq!(c.client.accept_report(&c.admin, &id), HIGH);
}

#[test]
fn raising_the_tier_after_submission_cannot_overdraw_the_pool() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.start_review(&c.admin, &id);

    c.client
        .set_reward(&c.admin, &Severity::High, &100_000_000_000);
    // Payout stays at the escrowed snapshot, so the pool is never overdrawn.
    assert_eq!(c.client.accept_report(&c.admin, &id), HIGH);
    assert!(c.client.pool_balance() >= 0);
}

#[test]
fn pool_is_always_at_least_the_locked_balance() {
    let c = setup();
    let other = Address::generate(&c.env);
    let a = submit(&c, &c.reporter, Severity::High);
    submit(&c, &other, Severity::Low);
    c.client.start_review(&c.admin, &a);
    c.client.accept_report(&c.admin, &a);

    assert!(c.client.pool_balance() >= c.client.locked_balance());
    assert_eq!(c.client.locked_balance(), LOW);
}

// ── 30-day cancellation notice ────────────────────────────────────────────────

#[test]
fn cancellation_needs_a_request_first() {
    let c = setup();
    assert_eq!(
        c.client.try_execute_cancellation(&c.admin),
        Err(Ok(Error::CancellationNotRequested))
    );
    assert_eq!(
        c.client.try_abort_cancellation(&c.admin),
        Err(Ok(Error::CancellationNotRequested))
    );
}

#[test]
fn cancellation_cannot_execute_during_the_notice_period() {
    let c = setup();
    c.client.request_cancellation(&c.admin);
    assert_eq!(c.client.cancellation_requested_at(), Some(1_000));

    advance(&c, 30 * DAY - 1);
    assert_eq!(
        c.client.try_execute_cancellation(&c.admin),
        Err(Ok(Error::NoticePeriodActive))
    );
    assert!(!c.client.is_cancelled());
}

#[test]
fn cancellation_executes_exactly_when_the_notice_has_elapsed() {
    let c = setup();
    c.client.request_cancellation(&c.admin);

    advance(&c, 30 * DAY);
    assert_eq!(c.client.execute_cancellation(&c.admin), POOL);
    assert!(c.client.is_cancelled());
    assert_eq!(c.client.pool_balance(), 0);
    assert_eq!(c.client.cancellation_requested_at(), None);
}

#[test]
fn open_reports_block_cancellation_even_after_the_notice() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::Medium);
    c.client.request_cancellation(&c.admin);

    advance(&c, 31 * DAY);
    assert_eq!(
        c.client.try_execute_cancellation(&c.admin),
        Err(Ok(Error::ActiveSubmissionsLocked))
    );

    // Once the report is resolved the cancellation can go through; only the
    // unlocked part of the pool is released.
    c.client.start_review(&c.admin, &id);
    c.client.accept_report(&c.admin, &id);
    assert_eq!(c.client.execute_cancellation(&c.admin), POOL - MEDIUM);
    assert_eq!(c.client.pool_balance(), 0);
}

#[test]
fn submissions_during_the_notice_period_keep_their_lock() {
    let c = setup();
    c.client.request_cancellation(&c.admin);
    advance(&c, 10 * DAY);

    submit(&c, &c.reporter, Severity::High);
    assert_eq!(c.client.locked_balance(), HIGH);

    advance(&c, 25 * DAY);
    assert_eq!(
        c.client.try_execute_cancellation(&c.admin),
        Err(Ok(Error::ActiveSubmissionsLocked))
    );
    assert_eq!(c.client.locked_balance(), HIGH);
}

#[test]
fn a_cancelled_program_refuses_submissions_and_funding() {
    let c = setup();
    c.client.request_cancellation(&c.admin);
    advance(&c, 30 * DAY);
    c.client.execute_cancellation(&c.admin);

    let r = c.client.try_submit_report(
        &c.reporter,
        &String::from_str(&c.env, "Late"),
        &String::from_str(&c.env, "QmLate"),
        &Severity::Low,
    );
    assert_eq!(r, Err(Ok(Error::ProgramCancelled)));
    assert_eq!(
        c.client.try_fund_pool(&c.admin, &1),
        Err(Ok(Error::ProgramCancelled))
    );
    assert_eq!(
        c.client.try_request_cancellation(&c.admin),
        Err(Ok(Error::ProgramCancelled))
    );
}

#[test]
fn aborting_resets_the_notice_clock() {
    let c = setup();
    c.client.request_cancellation(&c.admin);
    advance(&c, 29 * DAY);
    c.client.abort_cancellation(&c.admin);
    assert_eq!(c.client.cancellation_requested_at(), None);

    c.client.request_cancellation(&c.admin);
    advance(&c, 2 * DAY);
    // 31 days after the first request, but only 2 after the new one.
    assert_eq!(
        c.client.try_execute_cancellation(&c.admin),
        Err(Ok(Error::NoticePeriodActive))
    );
}

#[test]
fn a_second_request_is_rejected() {
    let c = setup();
    c.client.request_cancellation(&c.admin);
    assert_eq!(
        c.client.try_request_cancellation(&c.admin),
        Err(Ok(Error::CancellationAlreadyRequested))
    );
}

#[test]
fn only_the_admin_can_drive_cancellation() {
    let c = setup();
    let stranger = Address::generate(&c.env);
    assert_eq!(
        c.client.try_request_cancellation(&stranger),
        Err(Ok(Error::Unauthorized))
    );
    c.client.request_cancellation(&c.admin);
    assert_eq!(
        c.client.try_abort_cancellation(&stranger),
        Err(Ok(Error::Unauthorized))
    );
    advance(&c, 30 * DAY);
    assert_eq!(
        c.client.try_execute_cancellation(&stranger),
        Err(Ok(Error::Unauthorized))
    );
}

// ── Triager arbitration ───────────────────────────────────────────────────────

fn with_triager(c: &Ctx) -> Address {
    let triager = Address::generate(&c.env);
    c.client.set_triager(&c.admin, &triager);
    triager
}

#[test]
fn reporter_can_accept_a_lower_proposed_severity() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.start_review(&c.admin, &id);
    c.client.propose_severity(&c.admin, &id, &Severity::Low);

    assert_eq!(
        c.client.try_accept_report(&c.admin, &id),
        Err(Ok(Error::SeverityProposalPending))
    );

    c.client.accept_proposal(&c.reporter, &id);
    let report = c.client.get_report(&id);
    assert_eq!(report.severity, Severity::Low);
    assert!(!report.has_proposal);
    assert_eq!(c.client.locked_balance(), LOW);

    assert_eq!(c.client.accept_report(&c.admin, &id), LOW);
}

#[test]
fn disputed_severity_blocks_acceptance_and_rejection() {
    let c = setup();
    with_triager(&c);
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.start_review(&c.admin, &id);
    c.client.propose_severity(&c.admin, &id, &Severity::Low);
    c.client.dispute_severity(&c.reporter, &id);

    assert!(c.client.get_report(&id).disputed);
    assert_eq!(
        c.client.try_accept_report(&c.admin, &id),
        Err(Ok(Error::DisputeOpen))
    );
    assert_eq!(
        c.client.try_reject_report(&c.admin, &id),
        Err(Ok(Error::DisputeOpen))
    );
    assert_eq!(
        c.client
            .try_propose_severity(&c.admin, &id, &Severity::Medium),
        Err(Ok(Error::DisputeOpen))
    );
    assert_eq!(
        c.client.try_accept_proposal(&c.reporter, &id),
        Err(Ok(Error::DisputeOpen))
    );
    // The escrow is untouched while the dispute is open.
    assert_eq!(c.client.locked_balance(), HIGH);
}

#[test]
fn triager_ruling_for_the_reporter_keeps_the_original_tier() {
    let c = setup();
    let triager = with_triager(&c);
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.start_review(&c.admin, &id);
    c.client.propose_severity(&c.admin, &id, &Severity::Low);
    c.client.dispute_severity(&c.reporter, &id);

    c.client.resolve_dispute(&triager, &id, &Severity::High);
    let report = c.client.get_report(&id);
    assert!(!report.disputed);
    assert!(!report.has_proposal);
    assert_eq!(report.severity, Severity::High);
    assert_eq!(c.client.locked_balance(), HIGH);

    assert_eq!(c.client.accept_report(&c.admin, &id), HIGH);
}

#[test]
fn triager_ruling_can_lower_the_tier_and_frees_the_difference() {
    let c = setup();
    let triager = with_triager(&c);
    let id = submit(&c, &c.reporter, Severity::Critical);
    c.client.start_review(&c.admin, &id);
    c.client.propose_severity(&c.admin, &id, &Severity::Medium);
    c.client.dispute_severity(&c.reporter, &id);

    c.client.resolve_dispute(&triager, &id, &Severity::Medium);
    assert_eq!(c.client.locked_balance(), MEDIUM);
    assert_eq!(c.client.available_balance(), POOL - MEDIUM);
    assert_eq!(c.client.accept_report(&c.admin, &id), MEDIUM);
}

#[test]
fn triager_ruling_that_raises_the_tier_needs_unlocked_funds() {
    let c = setup();
    let triager = with_triager(&c);
    let other = Address::generate(&c.env);
    let id = submit(&c, &c.reporter, Severity::Low);
    submit(&c, &other, Severity::High);
    c.client.propose_severity(&c.admin, &id, &Severity::Medium);
    c.client.dispute_severity(&c.reporter, &id);

    // Critical needs 1_000_000_000 - 10_000_000 more, but only
    // POOL - LOW - HIGH is unlocked.
    assert_eq!(
        c.client
            .try_resolve_dispute(&triager, &id, &Severity::Critical),
        Err(Ok(Error::InsufficientPool))
    );
    assert!(c.client.get_report(&id).disputed);
    assert_eq!(c.client.locked_balance(), LOW + HIGH);

    c.client.resolve_dispute(&triager, &id, &Severity::High);
    assert_eq!(c.client.locked_balance(), HIGH + HIGH);
}

#[test]
fn only_the_configured_triager_can_rule() {
    let c = setup();
    with_triager(&c);
    let stranger = Address::generate(&c.env);
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.propose_severity(&c.admin, &id, &Severity::Low);
    c.client.dispute_severity(&c.reporter, &id);

    // Neither the admin nor the reporter can rule on their own dispute.
    for who in [&c.admin, &c.reporter, &stranger] {
        assert_eq!(
            c.client.try_resolve_dispute(who, &id, &Severity::Low),
            Err(Ok(Error::NotTriager))
        );
    }
    assert!(c.client.get_report(&id).disputed);
}

#[test]
fn resolving_needs_a_triager_and_an_open_dispute() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    let nobody = Address::generate(&c.env);
    assert_eq!(
        c.client.try_resolve_dispute(&nobody, &id, &Severity::Low),
        Err(Ok(Error::TriagerNotSet))
    );

    let triager = with_triager(&c);
    assert_eq!(
        c.client.try_resolve_dispute(&triager, &id, &Severity::Low),
        Err(Ok(Error::NotDisputed))
    );
}

#[test]
fn dispute_preconditions_are_enforced() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);

    assert_eq!(
        c.client.try_dispute_severity(&c.reporter, &id),
        Err(Ok(Error::NoSeverityProposal))
    );
    assert_eq!(
        c.client.try_accept_proposal(&c.reporter, &id),
        Err(Ok(Error::NoSeverityProposal))
    );

    c.client.propose_severity(&c.admin, &id, &Severity::Low);
    // A proposal exists but no triager is configured yet.
    assert_eq!(
        c.client.try_dispute_severity(&c.reporter, &id),
        Err(Ok(Error::TriagerNotSet))
    );
}

#[test]
fn proposing_the_same_severity_is_rejected() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    assert_eq!(
        c.client
            .try_propose_severity(&c.admin, &id, &Severity::High),
        Err(Ok(Error::SameSeverity))
    );
}

#[test]
fn only_the_owning_reporter_can_answer_a_proposal() {
    let c = setup();
    with_triager(&c);
    let stranger = Address::generate(&c.env);
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.propose_severity(&c.admin, &id, &Severity::Low);

    assert_eq!(
        c.client.try_accept_proposal(&stranger, &id),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        c.client.try_dispute_severity(&stranger, &id),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn only_the_admin_can_set_a_triager_or_propose() {
    let c = setup();
    let stranger = Address::generate(&c.env);
    let id = submit(&c, &c.reporter, Severity::High);
    assert_eq!(
        c.client.try_set_triager(&stranger, &stranger),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        c.client
            .try_propose_severity(&stranger, &id, &Severity::Low),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn closed_reports_cannot_be_arbitrated() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.withdraw_report(&c.reporter, &id);
    assert_eq!(
        c.client.try_propose_severity(&c.admin, &id, &Severity::Low),
        Err(Ok(Error::ReportAlreadyClosed))
    );
}

#[test]
fn closing_a_report_with_a_pending_proposal_clears_it() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client.propose_severity(&c.admin, &id, &Severity::Low);
    c.client.withdraw_report(&c.reporter, &id);

    let report = c.client.get_report(&id);
    assert!(!report.has_proposal);
    assert!(!report.disputed);
    assert_eq!(c.client.locked_balance(), 0);
}

// ── Proof of prior art ────────────────────────────────────────────────────────

#[test]
fn prior_art_is_recorded_with_a_timestamp() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    assert_eq!(c.client.get_prior_art(&id), None);

    advance(&c, 5);
    c.client
        .attach_prior_art(&c.reporter, &id, &hash(&c.env, 0xAB));
    let art = c.client.get_prior_art(&id).unwrap();
    assert_eq!(art.commitment, hash(&c.env, 0xAB));
    assert_eq!(art.committed_at, 1_005);
}

#[test]
fn prior_art_is_write_once() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client
        .attach_prior_art(&c.reporter, &id, &hash(&c.env, 0x01));

    assert_eq!(
        c.client
            .try_attach_prior_art(&c.reporter, &id, &hash(&c.env, 0x02)),
        Err(Ok(Error::PriorArtAlreadySet))
    );
    assert_eq!(
        c.client.get_prior_art(&id).unwrap().commitment,
        hash(&c.env, 0x01)
    );
}

#[test]
fn prior_art_survives_every_status_change() {
    let c = setup();
    let id = submit(&c, &c.reporter, Severity::High);
    c.client
        .attach_prior_art(&c.reporter, &id, &hash(&c.env, 0x07));
    let before = c.client.get_prior_art(&id);

    c.client.start_review(&c.admin, &id);
    c.client.accept_report(&c.admin, &id);
    c.client.mark_paid(&c.admin, &id);
    assert_eq!(c.client.get_prior_art(&id), before);
}

#[test]
fn prior_art_can_only_be_attached_by_the_reporter_to_a_real_report() {
    let c = setup();
    let stranger = Address::generate(&c.env);
    let id = submit(&c, &c.reporter, Severity::High);

    assert_eq!(
        c.client
            .try_attach_prior_art(&stranger, &id, &hash(&c.env, 0x09)),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        c.client
            .try_attach_prior_art(&c.reporter, &99, &hash(&c.env, 0x09)),
        Err(Ok(Error::ReportNotFound))
    );
    assert_eq!(c.client.get_prior_art(&id), None);
}
