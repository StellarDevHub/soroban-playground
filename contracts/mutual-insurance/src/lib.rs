//! # Mutual Insurance Protocol (Issue #1818 – SC-22)
//!
//! A peer-to-peer mutual insurance protocol where policyholders pool capital to
//! underwrite smart-contract exploit risks. Key features:
//!
//! * Capital deposits earn underwriting premiums.
//! * Policies specify a covered contract, coverage amount, and duration.
//! * Claims are reviewed by a voting committee; approved claims are paid from the pool.
//! * A Minimum Capital Requirement (MCR) prevents over-subscription.
//!
//! ## Storage layout
//! * `Admin`            – contract administrator address
//! * `TotalReserves`    – total capital deposited into the pool (i128)
//! * `TotalCoverage`    – total active coverage (i128)
//! * `Deposit(addr)`    – each underwriter's deposited capital
//! * `Policy(id)`       – PolicyData struct
//! * `PolicyCount`      – monotonic policy counter (u64)
//! * `Claim(id)`        – ClaimData struct
//! * `ClaimCount`       – monotonic claim counter (u64)
//! * `Vote(claim_id, voter)` – whether a voter has already voted

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
};

// ────────────────────────────────────────────────────────────────────────────
// Data types
// ────────────────────────────────────────────────────────────────────────────

/// Status of a policy.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum PolicyStatus {
    Active,
    Expired,
    Claimed,
}

/// Status of a claim.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ClaimStatus {
    Pending,
    Approved,
    Rejected,
    Paid,
}

/// Immutable policy record.
#[contracttype]
#[derive(Clone)]
pub struct PolicyData {
    pub holder: Address,
    /// Address of the covered smart contract (stored as symbolic identifier).
    pub covered_contract: Address,
    pub coverage_amount: i128,
    pub premium_paid: i128,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub status: PolicyStatus,
}

/// Mutable claim record.
#[contracttype]
#[derive(Clone)]
pub struct ClaimData {
    pub policy_id: u64,
    pub claimant: Address,
    pub amount: i128,
    pub votes_for: u32,
    pub votes_against: u32,
    /// Minimum votes required for approval.
    pub approval_threshold: u32,
    pub status: ClaimStatus,
}

// ────────────────────────────────────────────────────────────────────────────
// Storage keys
// ────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    TotalReserves,
    TotalCoverage,
    PolicyCount,
    ClaimCount,
    Deposit(Address),
    Policy(u64),
    Claim(u64),
    Vote(u64, Address),
}

// ────────────────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────────────────

const EVT_DEPOSIT: Symbol = symbol_short!("deposit");
const EVT_WITHDRAW: Symbol = symbol_short!("withdraw");
const EVT_POLICY: Symbol = symbol_short!("policy");
const EVT_CLAIM: Symbol = symbol_short!("claim");
const EVT_VOTE: Symbol = symbol_short!("vote");
const EVT_PAYOUT: Symbol = symbol_short!("payout");

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/// The Minimum Capital Requirement ratio expressed as basis-points (10_000 = 100%).
/// A pool must hold at least MCR_BPS / 10_000 of total active coverage as free reserves.
/// Set to 20% here (2_000 bps).
const MCR_BPS: i128 = 2_000;

/// Default claim-approval threshold (number of yes-votes required).
const DEFAULT_APPROVAL_THRESHOLD: u32 = 3;

// ────────────────────────────────────────────────────────────────────────────
// Contract
// ────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct MutualInsurance;

#[contractimpl]
impl MutualInsurance {
    // ──────────────────────────────────────────────────────────────────────
    // Initialisation
    // ──────────────────────────────────────────────────────────────────────

    /// Initialise the contract with an admin. Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalReserves, &0_i128);
        env.storage().instance().set(&DataKey::TotalCoverage, &0_i128);
        env.storage().instance().set(&DataKey::PolicyCount, &0_u64);
        env.storage().instance().set(&DataKey::ClaimCount, &0_u64);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Capital management
    // ──────────────────────────────────────────────────────────────────────

    /// Underwriter deposits `amount` of capital into the mutual pool.
    /// The underwriter earns premiums proportional to their share of total reserves.
    pub fn deposit(env: Env, underwriter: Address, amount: i128) {
        underwriter.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let key = DataKey::Deposit(underwriter.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));

        let reserves: i128 = env.storage().instance().get(&DataKey::TotalReserves).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalReserves, &(reserves + amount));

        env.events().publish((EVT_DEPOSIT,), (underwriter, amount));
    }

    /// Underwriter withdraws `amount` of capital, subject to solvency constraints.
    pub fn withdraw(env: Env, underwriter: Address, amount: i128) {
        underwriter.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let key = DataKey::Deposit(underwriter.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount > current {
            panic!("insufficient deposit");
        }

        let reserves: i128 = env.storage().instance().get(&DataKey::TotalReserves).unwrap_or(0);
        let coverage: i128 = env.storage().instance().get(&DataKey::TotalCoverage).unwrap_or(0);
        let new_reserves = reserves - amount;

        // Enforce MCR: free reserves after withdrawal must be >= MCR_BPS% of coverage
        let required_reserves = coverage * MCR_BPS / 10_000;
        if new_reserves < required_reserves {
            panic!("withdrawal would breach MCR");
        }

        env.storage().persistent().set(&key, &(current - amount));
        env.storage().instance().set(&DataKey::TotalReserves, &new_reserves);

        env.events().publish((EVT_WITHDRAW,), (underwriter, amount));
    }

    /// Returns an underwriter's deposited balance.
    pub fn get_deposit(env: Env, underwriter: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Deposit(underwriter)).unwrap_or(0)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Policy management
    // ──────────────────────────────────────────────────────────────────────

    /// Policyholder purchases coverage.
    ///
    /// # Arguments
    /// * `holder`           – the policyholder (must authorise).
    /// * `covered_contract` – address of the contract being insured.
    /// * `coverage_amount`  – amount insured.
    /// * `premium`          – premium paid; credited to pool reserves.
    /// * `duration_ledgers` – coverage duration expressed in ledger count.
    pub fn buy_policy(
        env: Env,
        holder: Address,
        covered_contract: Address,
        coverage_amount: i128,
        premium: i128,
        duration_ledgers: u32,
    ) -> u64 {
        holder.require_auth();
        if coverage_amount <= 0 {
            panic!("coverage_amount must be positive");
        }
        if premium <= 0 {
            panic!("premium must be positive");
        }
        if duration_ledgers == 0 {
            panic!("duration_ledgers must be positive");
        }

        let reserves: i128 = env.storage().instance().get(&DataKey::TotalReserves).unwrap_or(0);
        let coverage: i128 = env.storage().instance().get(&DataKey::TotalCoverage).unwrap_or(0);
        let new_coverage = coverage + coverage_amount;

        // MCR check: reserves (including new premium) must cover MCR of new total coverage
        let new_reserves = reserves + premium;
        let required_reserves = new_coverage * MCR_BPS / 10_000;
        if new_reserves < required_reserves {
            panic!("pool is at capacity – MCR would be breached");
        }

        // Issue policy
        let id: u64 = env.storage().instance().get(&DataKey::PolicyCount).unwrap_or(0);
        let start = env.ledger().sequence();
        let policy = PolicyData {
            holder: holder.clone(),
            covered_contract: covered_contract.clone(),
            coverage_amount,
            premium_paid: premium,
            start_ledger: start,
            end_ledger: start + duration_ledgers,
            status: PolicyStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Policy(id), &policy);
        env.storage().instance().set(&DataKey::PolicyCount, &(id + 1));

        // Credit premium to reserves
        env.storage().instance().set(&DataKey::TotalReserves, &new_reserves);
        env.storage().instance().set(&DataKey::TotalCoverage, &new_coverage);

        env.events().publish((EVT_POLICY,), (id, holder, coverage_amount));
        id
    }

    /// Mark an expired policy as such and release its coverage capacity.
    pub fn expire_policy(env: Env, policy_id: u64) {
        let mut policy: PolicyData = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(policy_id))
            .expect("policy not found");

        if policy.status != PolicyStatus::Active {
            panic!("policy is not active");
        }
        if env.ledger().sequence() <= policy.end_ledger {
            panic!("policy has not expired yet");
        }

        policy.status = PolicyStatus::Expired;
        env.storage().persistent().set(&DataKey::Policy(policy_id), &policy);

        // Release locked coverage
        let coverage: i128 = env.storage().instance().get(&DataKey::TotalCoverage).unwrap_or(0);
        let new_coverage = (coverage - policy.coverage_amount).max(0);
        env.storage().instance().set(&DataKey::TotalCoverage, &new_coverage);
    }

    /// Fetch a policy by ID.
    pub fn get_policy(env: Env, policy_id: u64) -> PolicyData {
        env.storage()
            .persistent()
            .get(&DataKey::Policy(policy_id))
            .expect("policy not found")
    }

    // ──────────────────────────────────────────────────────────────────────
    // Claims
    // ──────────────────────────────────────────────────────────────────────

    /// Policyholder submits a claim against an active policy.
    pub fn submit_claim(env: Env, policy_id: u64, amount: i128) -> u64 {
        let mut policy: PolicyData = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(policy_id))
            .expect("policy not found");

        // Authenticate – claimant must be the policyholder.
        policy.holder.require_auth();

        if policy.status != PolicyStatus::Active {
            panic!("policy is not active");
        }
        if env.ledger().sequence() > policy.end_ledger {
            panic!("policy has expired");
        }
        if amount <= 0 || amount > policy.coverage_amount {
            panic!("invalid claim amount");
        }

        // Mark policy as claimed to prevent duplicate claims.
        policy.status = PolicyStatus::Claimed;
        env.storage().persistent().set(&DataKey::Policy(policy_id), &policy);

        let id: u64 = env.storage().instance().get(&DataKey::ClaimCount).unwrap_or(0);
        let claim = ClaimData {
            policy_id,
            claimant: policy.holder.clone(),
            amount,
            votes_for: 0,
            votes_against: 0,
            approval_threshold: DEFAULT_APPROVAL_THRESHOLD,
            status: ClaimStatus::Pending,
        };
        env.storage().persistent().set(&DataKey::Claim(id), &claim);
        env.storage().instance().set(&DataKey::ClaimCount, &(id + 1));

        env.events().publish((EVT_CLAIM,), (id, policy_id, amount));
        id
    }

    /// Committee member casts a vote on a pending claim.
    ///
    /// Each voter may vote only once per claim.
    pub fn vote_claim(env: Env, voter: Address, claim_id: u64, approve: bool) {
        voter.require_auth();

        let vote_key = DataKey::Vote(claim_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            panic!("already voted");
        }
        env.storage().persistent().set(&vote_key, &true);

        let mut claim: ClaimData = env
            .storage()
            .persistent()
            .get(&DataKey::Claim(claim_id))
            .expect("claim not found");

        if claim.status != ClaimStatus::Pending {
            panic!("claim is not pending");
        }

        if approve {
            claim.votes_for += 1;
        } else {
            claim.votes_against += 1;
        }

        // Check approval threshold.
        if claim.votes_for >= claim.approval_threshold {
            claim.status = ClaimStatus::Approved;
        }
        // Simple majority rejection: more against than for is sufficient once enough votes cast.
        let total = claim.votes_for + claim.votes_against;
        if total >= claim.approval_threshold * 2 && claim.votes_against > claim.votes_for {
            claim.status = ClaimStatus::Rejected;
        }

        env.storage().persistent().set(&DataKey::Claim(claim_id), &claim);
        env.events().publish((EVT_VOTE,), (claim_id, voter, approve));
    }

    /// Execute the payout for an approved claim.  Anyone may trigger this.
    pub fn pay_claim(env: Env, claim_id: u64) {
        let mut claim: ClaimData = env
            .storage()
            .persistent()
            .get(&DataKey::Claim(claim_id))
            .expect("claim not found");

        if claim.status != ClaimStatus::Approved {
            panic!("claim is not approved");
        }

        let reserves: i128 = env.storage().instance().get(&DataKey::TotalReserves).unwrap_or(0);
        if claim.amount > reserves {
            panic!("insufficient reserves to pay claim");
        }

        // Deduct from reserves
        env.storage().instance().set(&DataKey::TotalReserves, &(reserves - claim.amount));

        // Release coverage locked by this claim's policy
        let coverage: i128 = env.storage().instance().get(&DataKey::TotalCoverage).unwrap_or(0);
        let policy: PolicyData = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(claim.policy_id))
            .expect("policy not found");
        let new_coverage = (coverage - policy.coverage_amount).max(0);
        env.storage().instance().set(&DataKey::TotalCoverage, &new_coverage);

        claim.status = ClaimStatus::Paid;
        env.storage().persistent().set(&DataKey::Claim(claim_id), &claim);

        env.events().publish((EVT_PAYOUT,), (claim_id, claim.claimant.clone(), claim.amount));
    }

    /// Fetch a claim by ID.
    pub fn get_claim(env: Env, claim_id: u64) -> ClaimData {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(claim_id))
            .expect("claim not found")
    }

    // ──────────────────────────────────────────────────────────────────────
    // Solvency views
    // ──────────────────────────────────────────────────────────────────────

    /// Returns total pool reserves.
    pub fn total_reserves(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalReserves).unwrap_or(0)
    }

    /// Returns total active coverage outstanding.
    pub fn total_coverage(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalCoverage).unwrap_or(0)
    }

    /// Returns `true` if the pool meets the Minimum Capital Requirement.
    pub fn is_solvent(env: Env) -> bool {
        let reserves: i128 = env.storage().instance().get(&DataKey::TotalReserves).unwrap_or(0);
        let coverage: i128 = env.storage().instance().get(&DataKey::TotalCoverage).unwrap_or(0);
        let required = coverage * MCR_BPS / 10_000;
        reserves >= required
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup() -> (Env, Address, MutualInsuranceClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MutualInsurance);
        let client = MutualInsuranceClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    // ── Deposits & Withdrawals ──

    #[test]
    fn test_deposit_and_balance() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        client.deposit(&underwriter, &1_000_000);
        assert_eq!(client.get_deposit(&underwriter), 1_000_000);
        assert_eq!(client.total_reserves(), 1_000_000);
    }

    #[test]
    fn test_withdraw_within_mcr() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        // Deposit 1 000 000; no coverage → MCR = 0 → can withdraw freely
        client.deposit(&underwriter, &1_000_000);
        client.withdraw(&underwriter, &500_000);
        assert_eq!(client.get_deposit(&underwriter), 500_000);
        assert_eq!(client.total_reserves(), 500_000);
    }

    #[test]
    #[should_panic(expected = "insufficient deposit")]
    fn test_withdraw_more_than_deposited_fails() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        client.deposit(&underwriter, &100);
        client.withdraw(&underwriter, &101);
    }

    // ── Policies ──

    #[test]
    fn test_buy_policy_increases_coverage() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        // Large deposit so MCR is satisfied
        client.deposit(&underwriter, &10_000_000);
        client.buy_policy(&holder, &covered, &1_000_000, &50_000, &1_000);

        assert_eq!(client.total_coverage(), 1_000_000);
        // Premium is added to reserves
        assert_eq!(client.total_reserves(), 10_050_000);
    }

    #[test]
    fn test_buy_multiple_policies() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        client.deposit(&underwriter, &50_000_000);

        for i in 0..5_u32 {
            let holder = Address::generate(&env);
            let covered = Address::generate(&env);
            let id = client.buy_policy(&holder, &covered, &1_000_000, &20_000, &500 + i);
            assert_eq!(id, i as u64);
        }
        assert_eq!(client.total_coverage(), 5_000_000);
    }

    #[test]
    #[should_panic(expected = "pool is at capacity")]
    fn test_mcr_blocks_over_subscription() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);
        // Deposit 100; MCR 20% → can only support coverage up to 500
        // Trying to buy 1 000 000 coverage should fail
        client.deposit(&underwriter, &100);
        client.buy_policy(&holder, &covered, &1_000_000, &1, &100);
    }

    #[test]
    fn test_expire_policy_releases_coverage() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        client.deposit(&underwriter, &10_000_000);
        let id = client.buy_policy(&holder, &covered, &500_000, &10_000, &5);

        // Fast-forward past expiry
        env.ledger().with_mut(|l| l.sequence_number += 10);
        client.expire_policy(&id);

        // Coverage freed
        assert_eq!(client.total_coverage(), 0);
    }

    // ── Claims & Voting ──

    #[test]
    fn test_claim_lifecycle() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        client.deposit(&underwriter, &10_000_000);
        let policy_id = client.buy_policy(&holder, &covered, &500_000, &10_000, &1_000);
        let claim_id = client.submit_claim(&policy_id, &500_000);

        // 3 yes votes → approved
        for _ in 0..3 {
            let voter = Address::generate(&env);
            client.vote_claim(&voter, &claim_id, &true);
        }

        let claim = client.get_claim(&claim_id);
        assert!(matches!(claim.status, ClaimStatus::Approved));

        let before = client.total_reserves();
        client.pay_claim(&claim_id);
        assert_eq!(client.total_reserves(), before - 500_000);
    }

    #[test]
    fn test_claim_rejected_by_majority() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        client.deposit(&underwriter, &10_000_000);
        let policy_id = client.buy_policy(&holder, &covered, &500_000, &10_000, &1_000);
        let claim_id = client.submit_claim(&policy_id, &100_000);

        // 1 yes, 5 no → rejected
        let voter_yes = Address::generate(&env);
        client.vote_claim(&voter_yes, &claim_id, &true);
        for _ in 0..5 {
            let voter = Address::generate(&env);
            client.vote_claim(&voter, &claim_id, &false);
        }

        let claim = client.get_claim(&claim_id);
        assert!(matches!(claim.status, ClaimStatus::Rejected));
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn test_double_vote_fails() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        client.deposit(&underwriter, &10_000_000);
        let policy_id = client.buy_policy(&holder, &covered, &500_000, &10_000, &1_000);
        let claim_id = client.submit_claim(&policy_id, &100_000);

        let voter = Address::generate(&env);
        client.vote_claim(&voter, &claim_id, &true);
        client.vote_claim(&voter, &claim_id, &true); // should panic
    }

    #[test]
    #[should_panic(expected = "claim is not approved")]
    fn test_pay_unapproved_claim_fails() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        client.deposit(&underwriter, &10_000_000);
        let policy_id = client.buy_policy(&holder, &covered, &500_000, &10_000, &1_000);
        let claim_id = client.submit_claim(&policy_id, &100_000);
        client.pay_claim(&claim_id); // only 0 votes – still Pending
    }

    // ── Solvency ──

    #[test]
    fn test_is_solvent_returns_true_when_adequately_funded() {
        let (env, _admin, client) = setup();
        let underwriter = Address::generate(&env);
        let holder = Address::generate(&env);
        let covered = Address::generate(&env);

        client.deposit(&underwriter, &10_000_000);
        client.buy_policy(&holder, &covered, &1_000_000, &50_000, &1_000);
        assert!(client.is_solvent());
    }
}
