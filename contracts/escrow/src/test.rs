#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Env};
use crate::{FreelancerEscrow, FreelancerEscrowClient};
use crate::types::{EscrowStatus, MilestoneStatus};

fn setup() -> (Env, Address, FreelancerEscrowClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FreelancerEscrow);
    let client = FreelancerEscrowClient::new(&env, &contract_id);
    (env, contract_id, client)
}

fn make_address(env: &Env) -> Address {
    Address::generate(env)
}

// ── Initialization ─────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);
    assert!(client.is_initialized());
}

#[test]
#[should_panic]
fn test_double_initialize_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);
    client.initialize(&admin, &200);
}

// ── Create escrow ──────────────────────────────────────────────────────────

#[test]
fn test_create_escrow() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 400_i128, 300_i128, 300_i128],
    );
    assert_eq!(id, 1);

    let escrow = client.get_escrow(&1);
    assert_eq!(escrow.total_amount, 1000);
    assert_eq!(escrow.milestone_count, 3);
    assert_eq!(escrow.status, EscrowStatus::Pending);
    assert_eq!(escrow.paid_amount, 0);
}

#[test]
#[should_panic]
fn test_create_escrow_amounts_mismatch_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    // Sum = 900, total = 1000 — mismatch
    client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 400_i128, 300_i128, 200_i128],
    );
}

#[test]
#[should_panic]
fn test_create_escrow_no_milestones_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env],
    );
}

// ── Deposit ────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_activates_escrow() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 500_i128, 500_i128],
    );
    client.deposit(&id, &client_addr);

    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.status, EscrowStatus::Active);

    // First milestone should now be InProgress
    let m1 = client.get_milestone(&id, &1);
    assert_eq!(m1.status, MilestoneStatus::InProgress);
}

#[test]
#[should_panic]
fn test_deposit_wrong_client_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let impostor = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &impostor);
}

// ── Milestone lifecycle ───────────────────────────────────────────────────

#[test]
fn test_submit_approve_release() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0); // 0 fee for simple math

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);

    client.submit_milestone(&id, &freelancer, &1);
    assert_eq!(client.get_milestone(&id, &1).status, MilestoneStatus::UnderReview);

    client.approve_milestone(&id, &client_addr, &1);
    assert_eq!(client.get_milestone(&id, &1).status, MilestoneStatus::Approved);

    let payout = client.release_payment(&id, &client_addr, &1);
    assert_eq!(payout, 1000); // no fee

    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.status, EscrowStatus::Completed);
    assert_eq!(escrow.paid_amount, 1000);
}

#[test]
fn test_reject_milestone_returns_to_in_progress() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &freelancer, &1);
    client.reject_milestone(&id, &client_addr, &1);

    assert_eq!(client.get_milestone(&id, &1).status, MilestoneStatus::InProgress);
}

#[test]
fn test_multi_milestone_progression() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &300,
        &vec![&env, 100_i128, 100_i128, 100_i128],
    );
    client.deposit(&id, &client_addr);

    // Pay milestone 1, check milestone 2 starts
    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &client_addr, &1);
    client.release_payment(&id, &client_addr, &1);
    assert_eq!(client.get_milestone(&id, &2).status, MilestoneStatus::InProgress);

    // Pay milestone 2, check milestone 3 starts
    client.submit_milestone(&id, &freelancer, &2);
    client.approve_milestone(&id, &client_addr, &2);
    client.release_payment(&id, &client_addr, &2);
    assert_eq!(client.get_milestone(&id, &3).status, MilestoneStatus::InProgress);

    // Pay milestone 3, escrow completes
    client.submit_milestone(&id, &freelancer, &3);
    client.approve_milestone(&id, &client_addr, &3);
    client.release_payment(&id, &client_addr, &3);

    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Completed);
}

#[test]
fn test_arbiter_fee_deducted() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &500); // 5%

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &client_addr, &1);

    let payout = client.release_payment(&id, &client_addr, &1);
    assert_eq!(payout, 950); // 1000 - 5%
}

// ── Submit errors ─────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_submit_milestone_wrong_freelancer_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let impostor = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &impostor, &1);
}

#[test]
#[should_panic]
fn test_submit_non_in_progress_milestone_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &200,
        &vec![&env, 100_i128, 100_i128],
    );
    client.deposit(&id, &client_addr);
    // Milestone 2 is still Pending
    client.submit_milestone(&id, &freelancer, &2);
}

// ── Dispute ───────────────────────────────────────────────────────────────

#[test]
fn test_raise_and_resolve_dispute_freelancer_favored() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);

    client.raise_dispute(&id, &client_addr);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Disputed);

    let payout = client.resolve_dispute(&id, &arbiter, &0); // FreelancerFavored
    assert_eq!(payout, 1000);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Completed);
}

#[test]
fn test_resolve_dispute_client_favored() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &freelancer);

    let payout = client.resolve_dispute(&id, &arbiter, &1); // ClientFavored
    assert_eq!(payout, 0);
}

#[test]
fn test_resolve_dispute_split() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &client_addr);

    let payout = client.resolve_dispute(&id, &arbiter, &2); // Split
    assert_eq!(payout, 500);
}

#[test]
#[should_panic]
fn test_raise_dispute_on_pending_escrow_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.raise_dispute(&id, &client_addr);
}

#[test]
#[should_panic]
fn test_resolve_dispute_wrong_arbiter_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);
    let impostor = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &client_addr);
    client.resolve_dispute(&id, &impostor, &0);
}

// ── Cancel ────────────────────────────────────────────────────────────────

#[test]
fn test_cancel_pending_escrow() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.cancel_escrow(&id, &client_addr);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Cancelled);
}

#[test]
#[should_panic]
fn test_cancel_active_escrow_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.cancel_escrow(&id, &client_addr);
}

// ── Analytics ─────────────────────────────────────────────────────────────

#[test]
fn test_analytics_tracking() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr, &freelancer, &arbiter, &1000,
        &vec![&env, 1000_i128],
    );

    let a1 = client.get_analytics();
    assert_eq!(a1.total_escrows, 1);
    assert_eq!(a1.active_escrows, 0);

    client.deposit(&id, &client_addr);
    let a2 = client.get_analytics();
    assert_eq!(a2.active_escrows, 1);
    assert_eq!(a2.total_value_locked, 1000);

    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &client_addr, &1);
    client.release_payment(&id, &client_addr, &1);

    let a3 = client.get_analytics();
    assert_eq!(a3.completed_escrows, 1);
    assert_eq!(a3.total_paid_out, 1000);
}
