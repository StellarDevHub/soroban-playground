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
    /// Asset locked by the borrower as collateral (set by `post_collateral`).
    pub collateral_asset: Option<Address>,
    /// Collateral amount still held by the contract.
    pub collateral_held: i128,
    /// Fixed price (in the loan asset) at which all collateral can be bought
    /// by a liquidator after default.
    pub liquidation_price: i128,
    /// Sum of principal of senior positions that have claimed.
    pub senior_claimed_principal: i128,
    /// Sum of principal of junior positions that have claimed.
    pub junior_claimed_principal: i128,
    /// Total paid out to senior lenders so far.
    pub senior_paid: i128,
    /// Total paid out to junior lenders so far.
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
