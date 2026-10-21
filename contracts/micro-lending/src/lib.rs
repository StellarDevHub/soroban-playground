//! # Peer-to-Peer Micro-Lending with Social Endorsement Credit Scoring
//!
//! ## Overview
//! Borrowers create micro-loan requests specifying amount, term, and interest.
//! Trusted **guarantors** stake endorsement collateral backing a percentage of
//! the loan.  Lenders fund loans once guarantors meet the minimum coverage.
//!
//! **Lifecycle:**
//! 1. Borrower calls `create_loan` – specifies amount, term (ledgers),
//!    interest rate (bps), minimum guarantor coverage (%), and installment count.
//! 2. Guarantors call `endorse` – each stakes collateral covering a portion of
//!    the loan.  Once total coverage ≥ min_coverage the loan becomes **Funded**.
//! 3. Lender calls `fund_loan` – transfers the principal to the borrower.
//! 4. Borrower calls `repay` – makes installment payments (principal + interest
//!    pro-rated over installments).  A grace period of `GRACE_LEDGERS` is
//!    allowed after each installment due-date before the loan defaults.
//! 5. On successful full repayment, borrower's on-chain credit score increases.
//! 6. If a payment is missed beyond the grace period anyone can call
//!    `declare_default`; guarantor collateral is slashed to compensate the
//!    lender.  Borrower's credit score decreases.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Basis points denominator
const BPS: i128 = 10_000;
/// Grace period (in ledgers) after a missed installment before default
const GRACE_LEDGERS: u32 = 100;
/// Credit score awarded on successful full repayment
const CREDIT_REWARD: i64 = 10;
/// Credit score penalty on default
const CREDIT_PENALTY: i64 = 25;
/// Maximum number of guarantors per loan
const MAX_GUARANTORS: u32 = 10;
/// Initial / maximum credit score
const MAX_CREDIT_SCORE: i64 = 1000;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    LoanNotFound = 4,
    LoanNotPending = 5,
    LoanNotFunded = 6,
    LoanAlreadyFunded = 7,
    LoanAlreadyClosed = 8,
    InsufficientCoverage = 9,
    InvalidAmount = 10,
    TooManyGuarantors = 11,
    AlreadyEndorsed = 12,
    GracePeriodNotExpired = 13,
    LoanNotDefaulted = 14,
    NoInstallmentDue = 15,
    Paused = 16,
    InvalidInstallmentCount = 17,
    SelfEndorsement = 18,
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LoanStatus {
    /// Awaiting enough guarantor endorsements
    Pending,
    /// Fully endorsed and funded by lender; repayment in progress
    Active,
    /// All installments repaid
    Repaid,
    /// Borrower defaulted; guarantors slashed
    Defaulted,
    /// Endorsed but not yet funded (lender not assigned)
    Endorsed,
}

/// Guarantor stake record
#[contracttype]
#[derive(Clone)]
pub struct Endorsement {
    pub guarantor: Address,
    /// Amount of collateral staked (slashed on default)
    pub stake: i128,
    /// Percentage of the loan this endorsement covers (bps)
    pub coverage_bps: u64,
}

/// Full loan record
#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub id: u32,
    pub borrower: Address,
    /// Lender address (set when funded)
    pub lender: Address,
    /// Principal amount
    pub principal: i128,
    /// Annual interest rate in bps (e.g. 500 = 5 %)
    pub interest_rate_bps: u64,
    /// Loan term in ledgers
    pub term_ledgers: u32,
    /// Number of installments
    pub installment_count: u32,
    /// Number of installments paid
    pub installments_paid: u32,
    /// Ledger when loan was funded (activated)
    pub funded_ledger: u32,
    /// Status
    pub status: LoanStatus,
    /// Minimum guarantor coverage required (bps of principal)
    pub min_coverage_bps: u64,
    /// Total guarantor coverage currently staked (bps)
    pub total_coverage_bps: u64,
    /// Total collateral staked by guarantors
    pub total_stake: i128,
    /// Endorsements list
    pub endorsements: Vec<Endorsement>,
    /// Amount repaid so far
    pub amount_repaid: i128,
}

/// Global state
#[contracttype]
#[derive(Clone)]
pub struct State {
    pub admin: Address,
    pub loan_token: Address,
    pub next_loan_id: u32,
    pub paused: bool,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    State,
    Loan(u32),
    /// On-chain credit score per address (i64)
    CreditScore(Address),
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct MicroLending;

#[contractimpl]
impl MicroLending {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, loan_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let state = State {
            admin,
            loan_token,
            next_loan_id: 1,
            paused: false,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("init"),), ());
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();
        state.paused = true;
        env.storage().instance().set(&DataKey::State, &state);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();
        state.paused = false;
        env.storage().instance().set(&DataKey::State, &state);
        Ok(())
    }

    // ── Loan Creation ─────────────────────────────────────────────────────────

    /// Borrower creates a micro-loan request.
    ///
    /// - `principal`           – amount requested
    /// - `interest_rate_bps`   – annualised rate in bps
    /// - `term_ledgers`        – loan duration in ledgers
    /// - `installment_count`   – number of equal repayment installments (1–24)
    /// - `min_coverage_bps`    – minimum total guarantor coverage as a % of
    ///                           principal in bps (e.g. 5 000 = 50 %)
    pub fn create_loan(
        env: Env,
        borrower: Address,
        principal: i128,
        interest_rate_bps: u64,
        term_ledgers: u32,
        installment_count: u32,
        min_coverage_bps: u64,
    ) -> Result<u32, Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        borrower.require_auth();

        if principal <= 0 {
            return Err(Error::InvalidAmount);
        }
        if installment_count == 0 || installment_count > 24 {
            return Err(Error::InvalidInstallmentCount);
        }

        let dummy_lender = env.current_contract_address();

        let loan = Loan {
            id: state.next_loan_id,
            borrower: borrower.clone(),
            lender: dummy_lender,
            principal,
            interest_rate_bps,
            term_ledgers,
            installment_count,
            installments_paid: 0,
            funded_ledger: 0,
            status: LoanStatus::Pending,
            min_coverage_bps,
            total_coverage_bps: 0,
            total_stake: 0,
            endorsements: Vec::new(&env),
            amount_repaid: 0,
        };

        let loan_id = state.next_loan_id;
        env.storage()
            .instance()
            .set(&DataKey::Loan(loan_id), &loan);
        state.next_loan_id += 1;
        env.storage().instance().set(&DataKey::State, &state);

        env.events()
            .publish((symbol_short!("loan_req"),), (borrower, loan_id, principal));
        Ok(loan_id)
    }

    // ── Endorsement ───────────────────────────────────────────────────────────

    /// Guarantor stakes `stake` tokens and pledges to cover `coverage_bps` of
    /// the loan principal.
    ///
    /// Once `total_coverage_bps` ≥ `min_coverage_bps` the loan transitions to
    /// `LoanStatus::Endorsed` (ready to be funded).
    pub fn endorse(
        env: Env,
        guarantor: Address,
        loan_id: u32,
        stake: i128,
        coverage_bps: u64,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        guarantor.require_auth();

        if stake <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut loan: Loan = env
            .storage()
            .instance()
            .get(&DataKey::Loan(loan_id))
            .ok_or(Error::LoanNotFound)?;

        if loan.status != LoanStatus::Pending {
            return Err(Error::LoanNotPending);
        }
        if guarantor == loan.borrower {
            return Err(Error::SelfEndorsement);
        }
        if loan.endorsements.len() >= MAX_GUARANTORS {
            return Err(Error::TooManyGuarantors);
        }

        // Check for duplicate endorser
        for i in 0..loan.endorsements.len() {
            let e = loan.endorsements.get(i).unwrap();
            if e.guarantor == guarantor {
                return Err(Error::AlreadyEndorsed);
            }
        }

        // Transfer stake from guarantor to contract (held in escrow)
        let tok = token::Client::new(&env, &state.loan_token);
        tok.transfer(&guarantor, &env.current_contract_address(), &stake);

        let endorsement = Endorsement {
            guarantor: guarantor.clone(),
            stake,
            coverage_bps,
        };
        loan.endorsements.push_back(endorsement);
        loan.total_coverage_bps += coverage_bps;
        loan.total_stake += stake;

        if loan.total_coverage_bps >= loan.min_coverage_bps {
            loan.status = LoanStatus::Endorsed;
        }

        env.storage()
            .instance()
            .set(&DataKey::Loan(loan_id), &loan);

        env.events().publish(
            (symbol_short!("endorsed"),),
            (guarantor, loan_id, stake, coverage_bps),
        );
        Ok(())
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    /// Lender funds the loan once sufficient endorsements are in place.
    /// Transfers principal to borrower.
    pub fn fund_loan(env: Env, lender: Address, loan_id: u32) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        lender.require_auth();

        let mut loan: Loan = env
            .storage()
            .instance()
            .get(&DataKey::Loan(loan_id))
            .ok_or(Error::LoanNotFound)?;

        if loan.status == LoanStatus::Active {
            return Err(Error::LoanAlreadyFunded);
        }
        if loan.status != LoanStatus::Endorsed {
            return Err(Error::InsufficientCoverage);
        }

        let tok = token::Client::new(&env, &state.loan_token);
        // Lender deposits principal to contract, which forwards to borrower
        tok.transfer(&lender, &env.current_contract_address(), &loan.principal);
        tok.transfer(
            &env.current_contract_address(),
            &loan.borrower,
            &loan.principal,
        );

        loan.lender = lender.clone();
        loan.funded_ledger = env.ledger().sequence();
        loan.status = LoanStatus::Active;

        env.storage()
            .instance()
            .set(&DataKey::Loan(loan_id), &loan);

        env.events()
            .publish((symbol_short!("funded"),), (lender, loan_id, loan.principal));
        Ok(())
    }

    // ── Repayment ─────────────────────────────────────────────────────────────

    /// Borrower repays one installment.
    ///
    /// Each installment amount =
    ///   (principal + total_interest) / installment_count
    ///
    /// Where total_interest = principal × rate_bps / BPS (simple interest,
    /// entire term).
    ///
    /// On the final installment the loan is closed, guarantor stakes are
    /// returned, and the borrower's credit score increases.
    pub fn repay(env: Env, borrower: Address, loan_id: u32) -> Result<i128, Error> {
        let state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        borrower.require_auth();

        let mut loan: Loan = env
            .storage()
            .instance()
            .get(&DataKey::Loan(loan_id))
            .ok_or(Error::LoanNotFound)?;

        if loan.status != LoanStatus::Active {
            return Err(Error::LoanNotFunded);
        }
        if borrower != loan.borrower {
            return Err(Error::Unauthorized);
        }

        // Total interest for the entire loan (simple interest)
        let total_interest = loan
            .principal
            .checked_mul(loan.interest_rate_bps as i128)
            .unwrap_or(i128::MAX)
            / BPS;
        let total_due = loan.principal + total_interest;
        let installment_amount = total_due / loan.installment_count as i128;

        // Verify installment is due (not too early – optional; we allow early)
        // For this implementation we allow repayment at any time after funding.

        let tok = token::Client::new(&env, &state.loan_token);
        // Borrower transfers installment to contract
        tok.transfer(
            &borrower,
            &env.current_contract_address(),
            &installment_amount,
        );

        // Forward installment to lender
        tok.transfer(
            &env.current_contract_address(),
            &loan.lender,
            &installment_amount,
        );

        loan.installments_paid += 1;
        loan.amount_repaid += installment_amount;

        if loan.installments_paid >= loan.installment_count {
            // Loan fully repaid
            loan.status = LoanStatus::Repaid;

            // Return guarantor stakes
            Self::return_stakes(&env, &state, &loan);

            // Increase borrower credit score
            Self::adjust_credit(&env, &loan.borrower, CREDIT_REWARD);

            env.events().publish(
                (symbol_short!("repaid"),),
                (borrower.clone(), loan_id, loan.amount_repaid),
            );
        }

        env.storage()
            .instance()
            .set(&DataKey::Loan(loan_id), &loan);

        env.events().publish(
            (symbol_short!("installment"),),
            (borrower, loan_id, installment_amount, loan.installments_paid),
        );
        Ok(installment_amount)
    }

    // ── Default Declaration ───────────────────────────────────────────────────

    /// Declare a loan in default if the grace period has elapsed since the
    /// missed installment due date.
    ///
    /// Anyone can call this.  Guarantor stakes are slashed pro-rata to cover
    /// the outstanding amount for the lender.
    pub fn declare_default(env: Env, caller: Address, loan_id: u32) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        caller.require_auth();

        let mut loan: Loan = env
            .storage()
            .instance()
            .get(&DataKey::Loan(loan_id))
            .ok_or(Error::LoanNotFound)?;

        if loan.status != LoanStatus::Active {
            return Err(Error::LoanNotFunded);
        }

        // Compute when the next installment was due
        let ledgers_per_installment = loan.term_ledgers / loan.installment_count;
        let next_due = loan.funded_ledger
            + ledgers_per_installment * (loan.installments_paid + 1);
        let current = env.ledger().sequence();

        if current < next_due + GRACE_LEDGERS {
            return Err(Error::GracePeriodNotExpired);
        }

        // Mark as defaulted
        loan.status = LoanStatus::Defaulted;

        // Slash guarantor stakes to compensate lender for outstanding balance
        let total_interest = loan
            .principal
            .checked_mul(loan.interest_rate_bps as i128)
            .unwrap_or(i128::MAX)
            / BPS;
        let total_due = loan.principal + total_interest;
        let paid = loan.amount_repaid;
        let outstanding = (total_due - paid).max(0);

        let tok = token::Client::new(&env, &state.loan_token);
        let total_stake = loan.total_stake;
        let mut slashed_total: i128 = 0;

        for i in 0..loan.endorsements.len() {
            let e = loan.endorsements.get(i).unwrap();
            // Each guarantor is slashed proportional to their coverage_bps
            let slash = if total_stake > 0 {
                (outstanding as u128 * e.stake as u128 / total_stake as u128) as i128
            } else {
                0
            };
            let slash = slash.min(e.stake);
            if slash > 0 {
                tok.transfer(&env.current_contract_address(), &loan.lender, &slash);
                slashed_total += slash;
            }
            // Return any remaining stake to the guarantor
            let remaining = e.stake - slash;
            if remaining > 0 {
                tok.transfer(
                    &env.current_contract_address(),
                    &e.guarantor,
                    &remaining,
                );
            }
        }

        // Penalise borrower credit score
        Self::adjust_credit(&env, &loan.borrower, -CREDIT_PENALTY);

        env.storage()
            .instance()
            .set(&DataKey::Loan(loan_id), &loan);

        env.events().publish(
            (symbol_short!("defaulted"),),
            (loan_id, outstanding, slashed_total),
        );
        Ok(())
    }

    // ── View Functions ────────────────────────────────────────────────────────

    pub fn get_loan(env: Env, loan_id: u32) -> Result<Loan, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Loan(loan_id))
            .ok_or(Error::LoanNotFound)
    }

    /// Returns the on-chain credit score for an address (0–1000).
    /// New addresses start at 100.
    pub fn get_credit_score(env: Env, user: Address) -> i64 {
        env.storage()
            .instance()
            .get(&DataKey::CreditScore(user))
            .unwrap_or(100)
    }

    /// Compute the next installment amount for a loan.
    pub fn installment_amount(env: Env, loan_id: u32) -> Result<i128, Error> {
        let loan: Loan = env
            .storage()
            .instance()
            .get(&DataKey::Loan(loan_id))
            .ok_or(Error::LoanNotFound)?;
        let total_interest = loan
            .principal
            .checked_mul(loan.interest_rate_bps as i128)
            .unwrap_or(i128::MAX)
            / BPS;
        Ok((loan.principal + total_interest) / loan.installment_count as i128)
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fn load_state(env: &Env) -> Result<State, Error> {
        env.storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(Error::NotInitialized)
    }

    fn require_admin(state: &State, caller: &Address) {
        if &state.admin != caller {
            panic!("unauthorized");
        }
    }

    fn assert_not_paused(state: &State) -> Result<(), Error> {
        if state.paused {
            Err(Error::Paused)
        } else {
            Ok(())
        }
    }

    /// Return all guarantor stakes (called on successful repayment).
    fn return_stakes(env: &Env, state: &State, loan: &Loan) {
        let tok = token::Client::new(env, &state.loan_token);
        for i in 0..loan.endorsements.len() {
            let e = loan.endorsements.get(i).unwrap();
            if e.stake > 0 {
                tok.transfer(
                    &env.current_contract_address(),
                    &e.guarantor,
                    &e.stake,
                );
            }
        }
    }

    /// Adjust an address's credit score, clamping to [0, MAX_CREDIT_SCORE].
    fn adjust_credit(env: &Env, user: &Address, delta: i64) {
        let current: i64 = env
            .storage()
            .instance()
            .get(&DataKey::CreditScore(user.clone()))
            .unwrap_or(100);
        let new_score = (current + delta).max(0).min(MAX_CREDIT_SCORE);
        env.storage()
            .instance()
            .set(&DataKey::CreditScore(user.clone()), &new_score);
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env,
    };

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let borrower = Address::generate(&env);
        let guarantor = Address::generate(&env);
        let lender = Address::generate(&env);

        let tok_id = env.register_stellar_asset_contract_v2(admin.clone());
        let tok = tok_id.address();
        let sac = StellarAssetClient::new(&env, &tok);
        sac.mint(&lender, &10_000_000_000);
        sac.mint(&guarantor, &10_000_000_000);

        let cid = env.register(MicroLending, ());
        let client = MicroLendingClient::new(&env, &cid);
        client.initialize(&admin, &tok);

        (env, cid, borrower, guarantor, lender, tok)
    }

    #[test]
    fn test_create_loan() {
        let (env, cid, borrower, _g, _l, _tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        let id = client.create_loan(
            &borrower,
            &1_000_000_i128,
            &500_u64,   // 5% interest
            &1000_u32,  // 1000 ledgers
            &4_u32,     // 4 installments
            &5_000_u64, // 50% min coverage
        );
        assert_eq!(id, 1);

        let loan = client.get_loan(&1);
        assert_eq!(loan.status, LoanStatus::Pending);
        assert_eq!(loan.principal, 1_000_000);
    }

    #[test]
    fn test_endorse_and_fund() {
        let (env, cid, borrower, guarantor, lender, _tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        client.create_loan(
            &borrower,
            &1_000_000_i128,
            &500_u64,
            &1000_u32,
            &4_u32,
            &5_000_u64, // 50% coverage needed
        );

        // Guarantor covers 60% (above threshold)
        client.endorse(&guarantor, &1, &600_000_i128, &6_000_u64);

        let loan = client.get_loan(&1);
        assert_eq!(loan.status, LoanStatus::Endorsed);

        client.fund_loan(&lender, &1);

        let loan = client.get_loan(&1);
        assert_eq!(loan.status, LoanStatus::Active);
    }

    #[test]
    fn test_full_repayment_increases_credit_score() {
        let (env, cid, borrower, guarantor, lender, tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        // Fund borrower so they can repay
        StellarAssetClient::new(&env, &tok).mint(&borrower, &10_000_000_000);

        client.create_loan(
            &borrower,
            &1_000_000_i128,
            &500_u64,
            &400_u32,
            &4_u32,
            &5_000_u64,
        );

        client.endorse(&guarantor, &1, &600_000_i128, &6_000_u64);
        client.fund_loan(&lender, &1);

        let initial_score = client.get_credit_score(&borrower);

        // Repay all 4 installments
        for _ in 0..4 {
            client.repay(&borrower, &1);
        }

        let loan = client.get_loan(&1);
        assert_eq!(loan.status, LoanStatus::Repaid);

        let final_score = client.get_credit_score(&borrower);
        assert!(final_score > initial_score);
    }

    #[test]
    fn test_default_slashes_guarantors() {
        let (env, cid, borrower, guarantor, lender, _tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        // term = 100 ledgers, 2 installments → due after 50 ledgers each
        client.create_loan(
            &borrower,
            &1_000_000_i128,
            &500_u64,
            &100_u32,
            &2_u32,
            &5_000_u64,
        );

        client.endorse(&guarantor, &1, &600_000_i128, &6_000_u64);
        client.fund_loan(&lender, &1);

        let funded_at = env.ledger().sequence();

        // Advance past first installment due + grace period
        // Due at funded_at + 50, grace = GRACE_LEDGERS (100), so default after funded_at + 150
        env.ledger().with_mut(|l| {
            l.sequence_number = funded_at + 50 + GRACE_LEDGERS + 1;
        });

        let caller = Address::generate(&env);
        client.declare_default(&caller, &1);

        let loan = client.get_loan(&1);
        assert_eq!(loan.status, LoanStatus::Defaulted);

        // Borrower credit score should have dropped
        let score = client.get_credit_score(&borrower);
        assert!(score < 100); // initial is 100, penalty is 25
    }

    #[test]
    fn test_insufficient_endorsement_blocks_funding() {
        let (env, cid, borrower, guarantor, lender, _tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        client.create_loan(
            &borrower,
            &1_000_000_i128,
            &500_u64,
            &100_u32,
            &2_u32,
            &8_000_u64, // 80% coverage needed
        );

        // Only cover 30%
        client.endorse(&guarantor, &1, &300_000_i128, &3_000_u64);

        // Should still be pending
        let loan = client.get_loan(&1);
        assert_eq!(loan.status, LoanStatus::Pending);

        // Funding attempt should fail
        let result = client.try_fund_loan(&lender, &1);
        assert!(result.is_err());
    }

    #[test]
    fn test_credit_score_view() {
        let (env, cid, borrower, _g, _l, _tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        // Default score for new address = 100
        let score = client.get_credit_score(&borrower);
        assert_eq!(score, 100_i64);
    }

    #[test]
    fn test_installment_amount_calculation() {
        let (env, cid, borrower, _g, _l, _tok) = setup();
        let client = MicroLendingClient::new(&env, &cid);

        // principal=1_000_000, rate=500bps(5%), 4 installments
        // interest = 1_000_000 * 500 / 10_000 = 50_000
        // total_due = 1_050_000
        // per installment = 262_500
        client.create_loan(
            &borrower,
            &1_000_000_i128,
            &500_u64,
            &400_u32,
            &4_u32,
            &5_000_u64,
        );

        let amt = client.installment_amount(&1);
        assert_eq!(amt, 262_500_i128);
    }
}
