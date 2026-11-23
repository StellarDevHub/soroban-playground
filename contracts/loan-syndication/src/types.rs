use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    ReentrantCall = 5,
    LoanNotFound = 6,
    InvalidAmount = 7,
    InvalidTerms = 8,
    InvalidTranche = 9,
    FundingClosed = 10,
    TrancheCapacityExceeded = 11,
    LoanNotFunded = 12,
    InvalidLoanStatus = 13,
    LoanNotMatured = 14,
    NothingToClaim = 15,
    ArithmeticOverflow = 16,
    CollateralRequired = 17,
    RecoveryPending = 18,
    NothingToLiquidate = 19,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Tranche {
    Senior,
    Junior,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LoanStatus {
    Funding,
    Active,
    Repaid,
    Defaulted,
    Cancelled,
}

/// A fully specified fixed-term syndicated loan.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Loan {
    pub id: u32,
    pub borrower: Address,
    pub asset: Address,
    pub status: LoanStatus,
    pub principal_target: i128,
    pub senior_target: i128,
    pub junior_target: i128,
    pub senior_funded: i128,
    pub junior_funded: i128,
    /// Fixed whole-term yield in basis points.
    pub senior_yield_bps: u32,
    /// Fixed whole-term yield in basis points.
    pub junior_yield_bps: u32,
    pub funding_deadline: u64,
    pub maturity: u64,
    pub grace_period: u64,
    /// Repayments held by the contract for the distribution waterfall.
    pub repaid: i128,
    pub total_claimed: i128,
    pub created_at: u64,
    pub collateral_asset: Option<Address>,
    pub collateral_held: i128,
    pub liquidation_price: i128,
    pub senior_claimed_principal: i128,
    pub junior_claimed_principal: i128,
    pub senior_paid: i128,
    pub junior_paid: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranchePosition {
    pub loan_id: u32,
    pub lender: Address,
    pub tranche: Tranche,
    pub principal: i128,
    pub claimed: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrancheSummary {
    pub tranche: Tranche,
    pub target: i128,
    pub funded: i128,
    pub yield_bps: u32,
    pub amount_due: i128,
    pub settlement_allocation: i128,
}
