// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Loan Syndication
//!
//! Collateral-backed multi-lender term loans with senior and junior tranches.
//! Senior lenders are paid first from repayments and recoveries; junior lenders
//! receive the residual and therefore provide first-loss default protection.
//!
//! Collateral is posted by the borrower before drawdown. After default anyone
//! can liquidate it at the fixed `liquidation_price`, and the proceeds flow
//! through the same senior-first waterfall as ordinary repayments. Rounding
//! remainders from pro-rata claims accumulate in a reserve that the admin can
//! sweep once all lenders of a tranche have claimed.
#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};

use crate::storage::{
    enter, exit, get_admin, get_loan, get_loan_count, get_position, is_initialized, is_paused,
    next_loan_id, set_initialized, set_loan, set_paused, set_position,
};
use crate::types::{Error, Loan, LoanStatus, Tranche, TranchePosition, TrancheSummary};

const BPS_DENOMINATOR: i128 = 10_000;
const MAX_YIELD_BPS: u32 = 10_000;
const MAX_GRACE_PERIOD: u64 = 90 * 24 * 60 * 60;

#[contract]
pub struct LoanSyndication;

#[contractimpl]
impl LoanSyndication {
    /// Initialize the contract. The admin can pause new risk and cancel loans
    /// that have not drawn down; lender withdrawals and repayments stay live.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_initialized(&env, &admin);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        get_admin(&env)?.require_auth();
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), true);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        get_admin(&env)?.require_auth();
        set_paused(&env, false);
        env.events().publish((symbol_short!("paused"),), false);
        Ok(())
    }

    /// Create a fixed-term syndicated loan.
    ///
    /// `senior_target` must be smaller than `principal_target`; the difference
    /// is the junior first-loss tranche. Yields are fixed for the whole term.
    #[allow(clippy::too_many_arguments)]
    pub fn create_loan(
        env: Env,
        borrower: Address,
        asset: Address,
        principal_target: i128,
        senior_target: i128,
        senior_yield_bps: u32,
        junior_yield_bps: u32,
        funding_deadline: u64,
        maturity: u64,
        grace_period: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        borrower.require_auth();
        validate_terms(
            &env,
            principal_target,
            senior_target,
            senior_yield_bps,
            junior_yield_bps,
            funding_deadline,
            maturity,
            grace_period,
        )?;

        let junior_target = principal_target
            .checked_sub(senior_target)
            .ok_or(Error::ArithmeticOverflow)?;
        let id = next_loan_id(&env)?;
        let loan = Loan {
            id,
            borrower: borrower.clone(),
            asset,
            status: LoanStatus::Funding,
            principal_target,
            senior_target,
            junior_target,
            senior_funded: 0,
            junior_funded: 0,
            senior_yield_bps,
            junior_yield_bps,
            funding_deadline,
            maturity,
            grace_period,
            repaid: 0,
            total_claimed: 0,
            created_at: env.ledger().timestamp(),
            collateral_asset: None,
            collateral_held: 0,
            liquidation_price: 0,
            senior_claimed_principal: 0,
            junior_claimed_principal: 0,
            senior_paid: 0,
            junior_paid: 0,
        };
        set_loan(&env, &loan);
        env.events().publish(
            (symbol_short!("created"), id),
            (borrower, principal_target, senior_target),
        );
        Ok(id)
    }

    /// Lock collateral for a loan that is still funding. The borrower also
    /// fixes the price at which a liquidator can buy all of it after default.
    pub fn post_collateral(
        env: Env,
        loan_id: u32,
        asset: Address,
        amount: i128,
        liquidation_price: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        validate_amount(amount)?;
        validate_amount(liquidation_price)?;
        let mut loan = get_loan(&env, loan_id)?;
        loan.borrower.require_auth();
        if loan.status != LoanStatus::Funding || loan.collateral_held > 0 {
            return Err(Error::InvalidLoanStatus);
        }

        enter(&env)?;
        loan.collateral_asset = Some(asset.clone());
        loan.collateral_held = amount;
        loan.liquidation_price = liquidation_price;
        set_loan(&env, &loan);
        token::Client::new(&env, &asset).transfer(
            &loan.borrower,
            &env.current_contract_address(),
            &amount,
        );
        exit(&env);
        env.events()
            .publish((symbol_short!("collat"), loan_id), (asset, amount));
        Ok(())
    }

    /// Fund either the senior (`0`) or junior (`1`) tranche.
    pub fn fund(
        env: Env,
        lender: Address,
        loan_id: u32,
        tranche: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        lender.require_auth();
        validate_amount(amount)?;
        let tranche = parse_tranche(tranche)?;
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Funding {
            return Err(Error::InvalidLoanStatus);
        }
        if env.ledger().timestamp() >= loan.funding_deadline {
            return Err(Error::FundingClosed);
        }

        let (funded, target) = tranche_funding(&loan, tranche);
        let new_funded = funded
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        if new_funded > target {
            return Err(Error::TrancheCapacityExceeded);
        }
        let mut position = get_position(&env, loan_id, &lender, tranche);
        position.principal = position
            .principal
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        enter(&env)?;
        match tranche {
            Tranche::Senior => loan.senior_funded = new_funded,
            Tranche::Junior => loan.junior_funded = new_funded,
        }
        set_loan(&env, &loan);
        set_position(&env, &position);
        token::Client::new(&env, &loan.asset).transfer(
            &lender,
            &env.current_contract_address(),
            &amount,
        );
        exit(&env);

        env.events().publish(
            (symbol_short!("funded"), loan_id),
            (lender, tranche, amount),
        );
        Ok(())
    }

    /// Draw the loan principal after both tranches reach their exact targets
    /// and collateral has been posted.
    pub fn drawdown(env: Env, loan_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        let mut loan = get_loan(&env, loan_id)?;
        loan.borrower.require_auth();
        if loan.status != LoanStatus::Funding {
            return Err(Error::InvalidLoanStatus);
        }
        if loan.senior_funded != loan.senior_target || loan.junior_funded != loan.junior_target {
            return Err(Error::LoanNotFunded);
        }
        if loan.collateral_held <= 0 {
            return Err(Error::CollateralRequired);
        }
        if env.ledger().timestamp() >= loan.maturity {
            return Err(Error::InvalidLoanStatus);
        }

        enter(&env)?;
        loan.status = LoanStatus::Active;
        set_loan(&env, &loan);
        token::Client::new(&env, &loan.asset).transfer(
            &env.current_contract_address(),
            &loan.borrower,
            &loan.principal_target,
        );
        exit(&env);
        env.events().publish(
            (symbol_short!("drawdown"), loan_id),
            (loan.borrower, loan.principal_target),
        );
        Ok(())
    }

    /// Repay principal and yield. Any authenticated payer may service the loan.
    /// Overpayments are capped at the remaining total amount due.
    pub fn repay(env: Env, payer: Address, loan_id: u32, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        payer.require_auth();
        validate_amount(amount)?;
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Active {
            return Err(Error::InvalidLoanStatus);
        }
        let total_due = total_due(&loan)?;
        let outstanding = total_due
            .checked_sub(loan.repaid)
            .ok_or(Error::ArithmeticOverflow)?;
        let actual = core::cmp::min(amount, outstanding);
        if actual <= 0 {
            return Err(Error::InvalidAmount);
        }

        enter(&env)?;
        loan.repaid = loan
            .repaid
            .checked_add(actual)
            .ok_or(Error::ArithmeticOverflow)?;
        if loan.repaid == total_due {
            loan.status = LoanStatus::Repaid;
        }
        set_loan(&env, &loan);
        token::Client::new(&env, &loan.asset).transfer(
            &payer,
            &env.current_contract_address(),
            &actual,
        );
        exit(&env);
        env.events().publish(
            (symbol_short!("repaid"), loan_id),
            (payer, actual, loan.repaid),
        );
        Ok(actual)
    }

    /// Mark an unpaid loan defaulted once maturity plus grace period has passed.
    /// This permissionless transition freezes the recovery waterfall.
    pub fn mark_default(env: Env, loan_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Active {
            return Err(Error::InvalidLoanStatus);
        }
        let default_time = loan
            .maturity
            .checked_add(loan.grace_period)
            .ok_or(Error::ArithmeticOverflow)?;
        if env.ledger().timestamp() < default_time {
            return Err(Error::LoanNotMatured);
        }
        loan.status = LoanStatus::Defaulted;
        set_loan(&env, &loan);
        env.events()
            .publish((symbol_short!("default"), loan_id), loan.repaid);
        Ok(())
    }

    /// Liquidate the borrower's collateral of a defaulted loan.
    ///
    /// The liquidator pays up to `liquidation_price` (capped at the debt still
    /// outstanding) in the loan asset and receives collateral pro-rata. The
    /// payment is added to `repaid`, so the senior-first waterfall distributes
    /// it exactly like a normal repayment. If the debt is fully covered the
    /// loan becomes `Repaid` and the borrower can reclaim leftover collateral.
    pub fn liquidate(env: Env, liquidator: Address, loan_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        liquidator.require_auth();
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Defaulted || loan.collateral_held <= 0 {
            return Err(Error::NothingToLiquidate);
        }
        let due = total_due(&loan)?;
        let outstanding = due
            .checked_sub(loan.repaid)
            .ok_or(Error::ArithmeticOverflow)?;
        let pay = core::cmp::min(loan.liquidation_price, outstanding);
        let seized = if pay >= loan.liquidation_price {
            loan.collateral_held
        } else {
            mul_div_floor(loan.collateral_held, pay, loan.liquidation_price)?
        };
        if pay <= 0 || seized <= 0 {
            return Err(Error::NothingToLiquidate);
        }
        let collateral_asset = loan
            .collateral_asset
            .clone()
            .ok_or(Error::CollateralRequired)?;

        enter(&env)?;
        loan.repaid = loan
            .repaid
            .checked_add(pay)
            .ok_or(Error::ArithmeticOverflow)?;
        loan.collateral_held = loan
            .collateral_held
            .checked_sub(seized)
            .ok_or(Error::ArithmeticOverflow)?;
        if loan.repaid == due {
            loan.status = LoanStatus::Repaid;
        }
        set_loan(&env, &loan);
        token::Client::new(&env, &loan.asset).transfer(
            &liquidator,
            &env.current_contract_address(),
            &pay,
        );
        token::Client::new(&env, &collateral_asset).transfer(
            &env.current_contract_address(),
            &liquidator,
            &seized,
        );
        exit(&env);
        env.events().publish(
            (symbol_short!("liquidate"), loan_id),
            (liquidator, pay, seized),
        );
        Ok(pay)
    }

    /// Return the remaining collateral to the borrower once the loan is
    /// repaid in full (or was cancelled before drawdown).
    pub fn reclaim_collateral(env: Env, loan_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let mut loan = get_loan(&env, loan_id)?;
        loan.borrower.require_auth();
        if loan.status != LoanStatus::Repaid && loan.status != LoanStatus::Cancelled {
            return Err(Error::InvalidLoanStatus);
        }
        let amount = loan.collateral_held;
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }
        let collateral_asset = loan
            .collateral_asset
            .clone()
            .ok_or(Error::CollateralRequired)?;

        enter(&env)?;
        loan.collateral_held = 0;
        set_loan(&env, &loan);
        token::Client::new(&env, &collateral_asset).transfer(
            &env.current_contract_address(),
            &loan.borrower,
            &amount,
        );
        exit(&env);
        env.events()
            .publish((symbol_short!("reclaim"), loan_id), amount);
        Ok(amount)
    }

    /// Cancel a loan before drawdown. The borrower or contract admin may call.
    pub fn cancel_loan(env: Env, caller: Address, loan_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        let mut loan = get_loan(&env, loan_id)?;
        if caller != loan.borrower && caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        if loan.status != LoanStatus::Funding {
            return Err(Error::InvalidLoanStatus);
        }
        loan.status = LoanStatus::Cancelled;
        set_loan(&env, &loan);
        env.events()
            .publish((symbol_short!("cancelled"), loan_id), caller);
        Ok(())
    }

    /// Expire a loan that was not drawn before its funding deadline.
    pub fn expire_loan(env: Env, loan_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Funding {
            return Err(Error::InvalidLoanStatus);
        }
        if env.ledger().timestamp() < loan.funding_deadline {
            return Err(Error::FundingClosed);
        }
        loan.status = LoanStatus::Cancelled;
        set_loan(&env, &loan);
        env.events()
            .publish((symbol_short!("expired"), loan_id), loan.repaid);
        Ok(())
    }

    /// Withdraw a lender's principal after cancellation or expiry.
    pub fn claim_refund(
        env: Env,
        lender: Address,
        loan_id: u32,
        tranche: u32,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        lender.require_auth();
        let tranche = parse_tranche(tranche)?;
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Cancelled {
            return Err(Error::InvalidLoanStatus);
        }
        let mut position = get_position(&env, loan_id, &lender, tranche);
        let refund = position
            .principal
            .checked_sub(position.claimed)
            .ok_or(Error::ArithmeticOverflow)?;
        if refund <= 0 {
            return Err(Error::NothingToClaim);
        }

        enter(&env)?;
        position.claimed = position.principal;
        loan.total_claimed = loan
            .total_claimed
            .checked_add(refund)
            .ok_or(Error::ArithmeticOverflow)?;
        set_position(&env, &position);
        set_loan(&env, &loan);
        token::Client::new(&env, &loan.asset).transfer(
            &env.current_contract_address(),
            &lender,
            &refund,
        );
        exit(&env);
        env.events().publish(
            (symbol_short!("refund"), loan_id),
            (lender, tranche, refund),
        );
        Ok(refund)
    }

    /// Claim a lender's pro-rata settlement. Senior allocation is calculated
    /// before junior allocation, making the junior tranche absorb defaults first.
    /// For a defaulted loan with collateral left, claims wait until the
    /// collateral has been liquidated so the recovery is fully counted.
    pub fn claim(env: Env, lender: Address, loan_id: u32, tranche: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        lender.require_auth();
        let tranche = parse_tranche(tranche)?;
        let mut loan = get_loan(&env, loan_id)?;
        if loan.status != LoanStatus::Repaid && loan.status != LoanStatus::Defaulted {
            return Err(Error::InvalidLoanStatus);
        }
        if loan.status == LoanStatus::Defaulted && loan.collateral_held > 0 {
            return Err(Error::RecoveryPending);
        }
        let mut position = get_position(&env, loan_id, &lender, tranche);
        let amount = position_claim(&loan, &position)?;
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }

        enter(&env)?;
        if position.claimed == 0 {
            match tranche {
                Tranche::Senior => {
                    loan.senior_claimed_principal = loan
                        .senior_claimed_principal
                        .checked_add(position.principal)
                        .ok_or(Error::ArithmeticOverflow)?;
                }
                Tranche::Junior => {
                    loan.junior_claimed_principal = loan
                        .junior_claimed_principal
                        .checked_add(position.principal)
                        .ok_or(Error::ArithmeticOverflow)?;
                }
            }
        }
        match tranche {
            Tranche::Senior => {
                loan.senior_paid = loan
                    .senior_paid
                    .checked_add(amount)
                    .ok_or(Error::ArithmeticOverflow)?;
            }
            Tranche::Junior => {
                loan.junior_paid = loan
                    .junior_paid
                    .checked_add(amount)
                    .ok_or(Error::ArithmeticOverflow)?;
            }
        }
        position.claimed = position
            .claimed
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        loan.total_claimed = loan
            .total_claimed
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        set_position(&env, &position);
        set_loan(&env, &loan);
        token::Client::new(&env, &loan.asset).transfer(
            &env.current_contract_address(),
            &lender,
            &amount,
        );
        exit(&env);
        env.events().publish(
            (symbol_short!("claimed"), loan_id),
            (lender, tranche, amount),
        );
        Ok(amount)
    }

    /// Rounding remainders ("dust") left in the contract once every lender of
    /// a tranche has claimed. Always zero until a tranche is fully claimed.
    pub fn reserve(env: Env, loan_id: u32) -> Result<i128, Error> {
        let loan = get_loan(&env, loan_id)?;
        final_dust(&loan)
    }

    /// Admin withdraws the reserve of fully claimed tranches.
    pub fn sweep_reserve(env: Env, loan_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        let mut loan = get_loan(&env, loan_id)?;
        let senior_dust = tranche_dust(&loan, Tranche::Senior)?;
        let junior_dust = tranche_dust(&loan, Tranche::Junior)?;
        let dust = senior_dust
            .checked_add(junior_dust)
            .ok_or(Error::ArithmeticOverflow)?;
        if dust <= 0 {
            return Err(Error::NothingToClaim);
        }

        enter(&env)?;
        if senior_dust > 0 {
            loan.senior_paid = tranche_allocation(&loan, Tranche::Senior)?;
        }
        if junior_dust > 0 {
            loan.junior_paid = tranche_allocation(&loan, Tranche::Junior)?;
        }
        set_loan(&env, &loan);
        token::Client::new(&env, &loan.asset).transfer(
            &env.current_contract_address(),
            &admin,
            &dust,
        );
        exit(&env);
        env.events()
            .publish((symbol_short!("sweep"), loan_id), dust);
        Ok(dust)
    }

    pub fn get_loan(env: Env, loan_id: u32) -> Result<Loan, Error> {
        get_loan(&env, loan_id)
    }

    pub fn get_position(
        env: Env,
        loan_id: u32,
        lender: Address,
        tranche: u32,
    ) -> Result<TranchePosition, Error> {
        let tranche = parse_tranche(tranche)?;
        Ok(get_position(&env, loan_id, &lender, tranche))
    }

    pub fn tranche_summary(env: Env, loan_id: u32, tranche: u32) -> Result<TrancheSummary, Error> {
        let loan = get_loan(&env, loan_id)?;
        let tranche = parse_tranche(tranche)?;
        let (target, funded, yield_bps) = match tranche {
            Tranche::Senior => (
                loan.senior_target,
                loan.senior_funded,
                loan.senior_yield_bps,
            ),
            Tranche::Junior => (
                loan.junior_target,
                loan.junior_funded,
                loan.junior_yield_bps,
            ),
        };
        Ok(TrancheSummary {
            tranche,
            target,
            funded,
            yield_bps,
            amount_due: tranche_due(target, yield_bps)?,
            settlement_allocation: tranche_allocation(&loan, tranche)?,
        })
    }

    pub fn calculate_claim(
        env: Env,
        loan_id: u32,
        lender: Address,
        tranche: u32,
    ) -> Result<i128, Error> {
        let loan = get_loan(&env, loan_id)?;
        let tranche = parse_tranche(tranche)?;
        let position = get_position(&env, loan_id, &lender, tranche);
        position_claim(&loan, &position)
    }

    pub fn total_due(env: Env, loan_id: u32) -> Result<i128, Error> {
        total_due(&get_loan(&env, loan_id)?)
    }

    pub fn loan_count(env: Env) -> u32 {
        get_loan_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn validate_amount(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_terms(
    env: &Env,
    principal_target: i128,
    senior_target: i128,
    senior_yield_bps: u32,
    junior_yield_bps: u32,
    funding_deadline: u64,
    maturity: u64,
    grace_period: u64,
) -> Result<(), Error> {
    if principal_target <= 0
        || senior_target <= 0
        || senior_target >= principal_target
        || senior_yield_bps > MAX_YIELD_BPS
        || junior_yield_bps > MAX_YIELD_BPS
        || junior_yield_bps < senior_yield_bps
        || funding_deadline <= env.ledger().timestamp()
        || maturity <= funding_deadline
        || grace_period > MAX_GRACE_PERIOD
    {
        return Err(Error::InvalidTerms);
    }
    Ok(())
}

fn parse_tranche(value: u32) -> Result<Tranche, Error> {
    match value {
        0 => Ok(Tranche::Senior),
        1 => Ok(Tranche::Junior),
        _ => Err(Error::InvalidTranche),
    }
}

fn tranche_funding(loan: &Loan, tranche: Tranche) -> (i128, i128) {
    match tranche {
        Tranche::Senior => (loan.senior_funded, loan.senior_target),
        Tranche::Junior => (loan.junior_funded, loan.junior_target),
    }
}

fn tranche_due(principal: i128, yield_bps: u32) -> Result<i128, Error> {
    let interest = mul_div_floor(principal, yield_bps as i128, BPS_DENOMINATOR)?;
    principal
        .checked_add(interest)
        .ok_or(Error::ArithmeticOverflow)
}

fn total_due(loan: &Loan) -> Result<i128, Error> {
    tranche_due(loan.senior_target, loan.senior_yield_bps)?
        .checked_add(tranche_due(loan.junior_target, loan.junior_yield_bps)?)
        .ok_or(Error::ArithmeticOverflow)
}

fn tranche_allocation(loan: &Loan, tranche: Tranche) -> Result<i128, Error> {
    let senior_due = tranche_due(loan.senior_target, loan.senior_yield_bps)?;
    match tranche {
        Tranche::Senior => Ok(core::cmp::min(loan.repaid, senior_due)),
        Tranche::Junior => {
            let residual = if loan.repaid > senior_due {
                loan.repaid
                    .checked_sub(senior_due)
                    .ok_or(Error::ArithmeticOverflow)?
            } else {
                0
            };
            let junior_due = tranche_due(loan.junior_target, loan.junior_yield_bps)?;
            Ok(core::cmp::min(residual, junior_due))
        }
    }
}

/// Dust of one tranche: its allocation minus what lenders were paid, but only
/// once every lender of that tranche has claimed (so nobody's share is touched).
fn tranche_dust(loan: &Loan, tranche: Tranche) -> Result<i128, Error> {
    let (funded, claimed_principal, paid) = match tranche {
        Tranche::Senior => (
            loan.senior_funded,
            loan.senior_claimed_principal,
            loan.senior_paid,
        ),
        Tranche::Junior => (
            loan.junior_funded,
            loan.junior_claimed_principal,
            loan.junior_paid,
        ),
    };
    if funded <= 0 || claimed_principal != funded {
        return Ok(0);
    }
    tranche_allocation(loan, tranche)?
        .checked_sub(paid)
        .ok_or(Error::ArithmeticOverflow)
}

fn final_dust(loan: &Loan) -> Result<i128, Error> {
    tranche_dust(loan, Tranche::Senior)?
        .checked_add(tranche_dust(loan, Tranche::Junior)?)
        .ok_or(Error::ArithmeticOverflow)
}

fn position_claim(loan: &Loan, position: &TranchePosition) -> Result<i128, Error> {
    if position.principal <= 0 {
        return Ok(0);
    }
    let tranche_funded = match position.tranche {
        Tranche::Senior => loan.senior_funded,
        Tranche::Junior => loan.junior_funded,
    };
    if tranche_funded <= 0 {
        return Ok(0);
    }
    let entitlement = mul_div_floor(
        tranche_allocation(loan, position.tranche)?,
        position.principal,
        tranche_funded,
    )?;
    entitlement
        .checked_sub(position.claimed)
        .ok_or(Error::ArithmeticOverflow)
}

fn mul_div_floor(left: i128, right: i128, denominator: i128) -> Result<i128, Error> {
    if left < 0 || right < 0 || denominator <= 0 {
        return Err(Error::InvalidAmount);
    }
    let first_gcd = gcd(left, denominator);
    let reduced_left = left / first_gcd;
    let remaining_denominator = denominator / first_gcd;
    let second_gcd = gcd(right, remaining_denominator);
    reduced_left
        .checked_mul(right / second_gcd)
        .ok_or(Error::ArithmeticOverflow)
        .map(|value| value / (remaining_denominator / second_gcd))
}

fn gcd(mut left: i128, mut right: i128) -> i128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}
