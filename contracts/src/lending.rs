#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    Address, Env, String, Symbol, Vec, Map, BytesN, IntoVal, Val,
    log, panic_with_error,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Loans,
    CreditScores,
    CollateralTokens,
    LiquidationThreshold,
    InterestRate,
    Admin,
    Nonce,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Loan {
    pub id: BytesN<32>,
    pub borrower: Address,
    pub collateral_amount: i128,
    pub loan_amount: i128,
    pub interest_rate: u64,
    pub creation_time: u64,
    pub last_repayment: u64,
    pub total_repaid: i128,
    pub status: LoanStatus,
    pub collateral_token: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoanStatus {
    Active,
    Repaid,
    Liquidated,
    Defaulted,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditScore {
    pub user: Address,
    pub score: u64,
    pub total_loans: u32,
    pub successful_repayments: u32,
    pub defaulted_loans: u32,
    pub last_updated: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LendingError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    LoanNotFound = 4,
    InsufficientCollateral = 5,
    LoanNotActive = 6,
    RepaymentExceedsDebt = 7,
    CollateralValueTooLow = 8,
    LiquidationThresholdReached = 9,
    InvalidAmount = 10,
    TransferFailed = 11,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanCreatedEvent {
    pub loan_id: BytesN<32>,
    pub borrower: Address,
    pub collateral_amount: i128,
    pub loan_amount: i128,
    pub interest_rate: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepaymentEvent {
    pub loan_id: BytesN<32>,
    pub borrower: Address,
    pub amount: i128,
    pub remaining_debt: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidationEvent {
    pub loan_id: BytesN<32>,
    pub borrower: Address,
    pub collateral_seized: i128,
}

pub struct LendingContract;

#[contractimpl]
impl LendingContract {
    pub fn init(
        env: Env,
        admin: Address,
        collateral_token: Address,
        liquidation_threshold: u64,
        base_interest_rate: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, LendingError::AlreadyInitialized);
        }
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CollateralTokens, &collateral_token);
        env.storage().instance().set(&DataKey::LiquidationThreshold, &liquidation_threshold);
        env.storage().instance().set(&DataKey::InterestRate, &base_interest_rate);
        env.storage().instance().set(&DataKey::Nonce, &0u64);
        env.storage().instance().set(&DataKey::Loans, &Vec::<Loan>::new(&env));
        env.storage().instance().set(&DataKey::CreditScores, &Map::<Address, CreditScore>::new(&env));
    }

    pub fn create_loan(
        env: Env,
        borrower: Address,
        collateral_amount: i128,
        loan_amount: i128,
    ) -> BytesN<32> {
        borrower.require_auth();
        
        if collateral_amount <= 0 || loan_amount <= 0 {
            panic_with_error!(&env, LendingError::InvalidAmount);
        }
        
        let min_collateral = loan_amount * 150 / 100;
        if collateral_amount < min_collateral {
            panic_with_error!(&env, LendingError::InsufficientCollateral);
        }
        
        let mut nonce: u64 = env.storage().instance().get(&DataKey::Nonce).unwrap();
        nonce += 1;
        env.storage().instance().set(&DataKey::Nonce, &nonce);
        
        let mut loan_id_bytes = [0u8; 32];
        let nonce_bytes = nonce.to_be_bytes();
        loan_id_bytes[..8].copy_from_slice(&nonce_bytes);
        let borrower_bytes = borrower.to_string().to_bytes();
        for (i, &byte) in borrower_bytes.iter().take(24).enumerate() {
            loan_id_bytes[8 + i] = byte;
        }
        let loan_id = BytesN::from_array(&env, &loan_id_bytes);
        
        let interest_rate: u64 = env.storage().instance().get(&DataKey::InterestRate).unwrap();
        let now = env.ledger().timestamp();
        
        let loan = Loan {
            id: loan_id.clone(),
            borrower: borrower.clone(),
            collateral_amount,
            loan_amount,
            interest_rate,
            creation_time: now,
            last_repayment: now,
            total_repaid: 0,
            status: LoanStatus::Active,
            collateral_token: env.storage().instance().get(&DataKey::CollateralTokens).unwrap(),
        };
        
        let mut loans: Vec<Loan> = env.storage().instance().get(&DataKey::Loans).unwrap();
        loans.push_back(loan.clone());
        env.storage().instance().set(&DataKey::Loans, &loans);
        
        Self::update_credit_score(&env, &borrower, true);
        
        env.events().publish(
            (Symbol::new(&env, "loan_created"), Symbol::new(&env, "v1")),
            LoanCreatedEvent {
                loan_id: loan_id.clone(),
                borrower: borrower.clone(),
                collateral_amount,
                loan_amount,
                interest_rate,
            },
        );
        
        loan_id
    }

    pub fn repay_loan(env: Env, borrower: Address, loan_id: BytesN<32>, amount: i128) -> i128 {
        borrower.require_auth();
        
        let mut loans: Vec<Loan> = env.storage().instance().get(&DataKey::Loans).unwrap();
        let idx = loans.iter().position(|l| l.id == loan_id).ok_or_else(|| {
            panic_with_error!(&env, LendingError::LoanNotFound);
        }).unwrap();
        
        let mut loan = loans.get(idx).unwrap();
        
        if loan.borrower != borrower {
            panic_with_error!(&env, LendingError::Unauthorized);
        }
        if loan.status != LoanStatus::Active {
            panic_with_error!(&env, LendingError::LoanNotActive);
        }
        
        let current_debt = Self::calculate_debt(&env, &loan);
        if amount > current_debt {
            panic_with_error!(&env, LendingError::RepaymentExceedsDebt);
        }
        
        loan.total_repaid += amount;
        loan.last_repayment = env.ledger().timestamp();
        
        let remaining_debt = current_debt - amount;
        
        if remaining_debt == 0 {
            loan.status = LoanStatus::Repaid;
            Self::update_credit_score(&env, &borrower, true);
        }
        
        loans.set(idx, loan.clone());
        env.storage().instance().set(&DataKey::Loans, &loans);
        
        env.events().publish(
            (Symbol::new(&env, "loan_repayment"), Symbol::new(&env, "v1")),
            RepaymentEvent {
                loan_id: loan_id.clone(),
                borrower: borrower.clone(),
                amount,
                remaining_debt,
            },
        );
        
        remaining_debt
    }

    pub fn liquidate_loan(env: Env, caller: Address, loan_id: BytesN<32>) {
        caller.require_auth();
        Self::require_admin(&env, &caller);
        
        let mut loans: Vec<Loan> = env.storage().instance().get(&DataKey::Loans).unwrap();
        let idx = loans.iter().position(|l| l.id == loan_id).ok_or_else(|| {
            panic_with_error!(&env, LendingError::LoanNotFound);
        }).unwrap();
        
        let mut loan = loans.get(idx).unwrap();
        
        if loan.status != LoanStatus::Active {
            panic_with_error!(&env, LendingError::LoanNotActive);
        }
        
        let threshold: u64 = env.storage().instance().get(&DataKey::LiquidationThreshold).unwrap();
        let current_debt = Self::calculate_debt(&env, &loan);
        let collateral_value = loan.collateral_amount;
        
        let health_factor = (collateral_value * 100) / current_debt;
        if health_factor >= threshold {
            panic_with_error!(&env, LendingError::LiquidationThresholdNotReached);
        }
        
        loan.status = LoanStatus::Liquidated;
        loans.set(idx, loan.clone());
        env.storage().instance().set(&DataKey::Loans, &loans);
        
        Self::update_credit_score(&env, &loan.borrower, false);
        
        env.events().publish(
            (Symbol::new(&env, "loan_liquidated"), Symbol::new(&env, "v1")),
            LiquidationEvent {
                loan_id: loan_id.clone(),
                borrower: loan.borrower.clone(),
                collateral_seized: loan.collateral_amount,
            },
        );
    }

    pub fn get_loan(env: Env, loan_id: BytesN<32>) -> Option<Loan> {
        let loans: Vec<Loan> = env.storage().instance().get(&DataKey::Loans).unwrap();
        loans.iter().find(|l| l.id == loan_id).cloned()
    }

    pub fn get_user_loans(env: Env, user: Address) -> Vec<Loan> {
        let loans: Vec<Loan> = env.storage().instance().get(&DataKey::Loans).unwrap();
        loans.iter().filter(|l| l.borrower == user).collect()
    }

    pub fn get_credit_score(env: Env, user: Address) -> CreditScore {
        let scores: Map<Address, CreditScore> = env.storage().instance().get(&DataKey::CreditScores).unwrap_or(Map::new(&env));
        scores.get(user).unwrap_or(CreditScore {
            user: user.clone(),
            score: 500,
            total_loans: 0,
            successful_repayments: 0,
            defaulted_loans: 0,
            last_updated: 0,
        })
    }

    fn calculate_debt(env: &Env, loan: &Loan) -> i128 {
        let time_elapsed = env.ledger().timestamp() - loan.creation_time;
        let interest = (loan.loan_amount * loan.interest_rate as i128 * time_elapsed as i128) / (10000 * 31536000);
        loan.loan_amount + interest - loan.total_repaid
    }

    fn update_credit_score(env: &Env, user: &Address, successful: bool) {
        let mut scores: Map<Address, CreditScore> = env.storage().instance().get(&DataKey::CreditScores).unwrap_or(Map::new(env));
        
        let mut score = scores.get(user.clone()).unwrap_or(CreditScore {
            user: user.clone(),
            score: 500,
            total_loans: 0,
            successful_repayments: 0,
            defaulted_loans: 0,
            last_updated: 0,
        });
        
        score.total_loans += 1;
        score.last_updated = env.ledger().timestamp();
        
        if successful {
            score.successful_repayments += 1;
            score.score = score.score.saturating_add(20).min(1000);
        } else {
            score.defaulted_loans += 1;
            score.score = score.score.saturating_sub(50).max(0);
        }
        
        scores.set(user.clone(), score.clone());
        env.storage().instance().set(&DataKey::CreditScores, &scores);
    }

    fn require_admin(env: &Env, address: &Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if *address != admin {
            panic_with_error!(env, LendingError::Unauthorized);
        }
    }
}
