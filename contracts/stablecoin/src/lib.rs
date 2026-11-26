#![cfg_attr(not(test), no_std)]

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// # Algorithmic Stablecoin — Collateral Peg Stability Module (PSM) & Liquidation Engine
//
// Extends the base algorithmic stablecoin with:
// * A 1:1 Peg Stability Module (PSM) for USDC/USDT reserve swaps.
// * Collateralized Debt Positions (CDP / Vaults) with dynamic collateral ratios.
// * MakerDAO Liquidation 2.0-style Dutch Auction liquidation engine with decaying price discovery.
// * Dedicated Stability Pool absorbing liquidations in exchange for discounted collateral.
// * Protocol bad debt socialization and reserve deficit recovery backstop.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

mod auction;
mod flash_mint;
mod stability_pool;

pub use auction::{calculate_dutch_price, AuctionBuyResult, LiquidationAuction};
pub use flash_mint::{FlashMintConfig, FlashMintDataKey};
pub use stability_pool::StabilityPoolAbsorptionResult;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    ContractPaused = 2,
    AlreadyInState = 3,
    NotInitialized = 4,
    InvalidAmount = 5,
    InsufficientBalance = 6,
    PriceStale = 7,
    RebaseTooFrequent = 8,
    // PSM-specific errors (9+)
    PsmPaused = 9,
    PsmDebtCeilingExceeded = 10,
    PsmInsufficientReserve = 11,
    InvalidFeeBps = 12,
    InvalidDebtCeiling = 13,
    // Flash Mint errors (14+)
    FlashMintPaused = 14,
    FlashMintGlobalDebtCeilingExceeded = 15,
    FlashMintTxDebtCeilingExceeded = 16,
    FlashMintReentrancyDetected = 17,
    FlashMintRepaymentFailed = 18,
    // CDP & Liquidation Auction errors (19+)
    PositionNotFound = 19,
    PositionHealthy = 20,
    BelowMinCollateralRatio = 21,
    AuctionNotFound = 22,
    AuctionAlreadyActive = 23,
    AuctionAlreadySettled = 24,
    AuctionNotExpired = 25,
    PriceExceedsMax = 26,
    InsufficientStabilityPool = 27,
    InsufficientCollateral = 28,
    InvalidAuctionPrice = 29,
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Base stablecoin keys
    Admin,
    TargetPrice,
    CurrentPrice,
    TotalSupply,
    ShareSupply,
    UserTokens(Address),
    Paused,
    LastRebaseTime,
    ReserveBalance,
    OracleAddress,
    RebaseCooldown,
    // PSM keys
    PsmPaused,
    PsmMintFeeBps,
    PsmRedeemFeeBps,
    PsmDebtCeiling,
    PsmMintedDebt,
    PsmVaultBalance,
    PsmFeeVault,
    // CDP / Vault keys
    Position(Address),
    UserCollateral(Address),
    LiquidationRatioBps,
    MinCollateralRatioBps,
    TotalCollateral,
    TotalCdpDebt,
    // Auction keys
    AuctionCounter,
    Auction(u64),
    ActiveAuctionForUser(Address),
    AuctionDuration,
    AuctionStartPriceBps,
    AuctionReservePriceBps,
    // Stability Pool keys
    StabilityPoolTotal,
    StabilityPoolUser(Address),
    StabilityPoolTotalCollateral,
    StabilityPoolUserCollateral(Address),
    StabilityPoolGlobalColPerUnit,
    StabilityPoolUserColSnapshot(Address),
    StabilityPoolGlobalDebtPerUnit,
    StabilityPoolUserDebtSnapshot(Address),
    // Bad debt & deficit recovery
    BadDebt,
}

// ─── Structs ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RebaseInfo {
    pub old_supply: i128,
    pub new_supply: i128,
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PsmSwapResult {
    pub amount_in: i128,
    pub amount_out: i128,
    pub fee_collected: i128,
    pub vault_balance: i128,
    pub minted_debt: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PsmConfig {
    pub paused: bool,
    pub mint_fee_bps: u32,
    pub redeem_fee_bps: u32,
    pub debt_ceiling: i128,
    pub minted_debt: i128,
    pub vault_balance: i128,
    pub fee_vault: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub collateral: i128,
    pub debt: i128,
    pub last_updated: u64,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AlgorithmicStablecoin;

#[contractimpl]
impl AlgorithmicStablecoin {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the stablecoin contract with PSM and liquidation engine defaults.
    pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInState);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &oracle);
        env.storage()
            .instance()
            .set(&DataKey::TargetPrice, &10_000_000i128);
        env.storage()
            .instance()
            .set(&DataKey::CurrentPrice, &10_000_000i128);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::ShareSupply, &1_000_000_000i128);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::LastRebaseTime, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::ReserveBalance, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::RebaseCooldown, &3600u64);

        // PSM defaults
        env.storage().instance().set(&DataKey::PsmPaused, &false);
        env.storage()
            .instance()
            .set(&DataKey::PsmMintFeeBps, &10u32); // 0.10 %
        env.storage()
            .instance()
            .set(&DataKey::PsmRedeemFeeBps, &10u32); // 0.10 %
        env.storage()
            .instance()
            .set(&DataKey::PsmDebtCeiling, &1_000_000_000_000i128); // 1 M tokens (7 decimals)
        env.storage()
            .instance()
            .set(&DataKey::PsmMintedDebt, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::PsmVaultBalance, &0i128);
        env.storage().instance().set(&DataKey::PsmFeeVault, &0i128);

        // Liquidation & CDP defaults
        env.storage()
            .instance()
            .set(&DataKey::LiquidationRatioBps, &15000u32); // 150%
        env.storage()
            .instance()
            .set(&DataKey::MinCollateralRatioBps, &15000u32); // 150%
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &0i128);
        env.storage().instance().set(&DataKey::TotalCdpDebt, &0i128);

        // Auction defaults (MakerDAO Liquidation 2.0 style)
        env.storage()
            .instance()
            .set(&DataKey::AuctionCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::AuctionDuration, &3600u64); // 60 minutes
        env.storage()
            .instance()
            .set(&DataKey::AuctionStartPriceBps, &12000u32); // 120% of oracle price
        env.storage()
            .instance()
            .set(&DataKey::AuctionReservePriceBps, &4000u32); // 40% floor

        // Stability pool & bad debt defaults
        env.storage()
            .instance()
            .set(&DataKey::StabilityPoolTotal, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::StabilityPoolTotalCollateral, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::StabilityPoolGlobalColPerUnit, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::StabilityPoolGlobalDebtPerUnit, &0i128);
        env.storage().instance().set(&DataKey::BadDebt, &0i128);

        env.events()
            .publish((Symbol::new(&env, "initialized"),), (admin, oracle));

        Ok(())
    }

    // ── PSM: Peg Stability Module ─────────────────────────────────────────────

    pub fn psm_set_params(
        env: Env,
        admin: Address,
        mint_fee_bps: u32,
        redeem_fee_bps: u32,
        debt_ceiling: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if mint_fee_bps > 500 || redeem_fee_bps > 500 {
            return Err(Error::InvalidFeeBps);
        }
        if debt_ceiling <= 0 {
            return Err(Error::InvalidDebtCeiling);
        }

        env.storage()
            .instance()
            .set(&DataKey::PsmMintFeeBps, &mint_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::PsmRedeemFeeBps, &redeem_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::PsmDebtCeiling, &debt_ceiling);

        env.events().publish(
            (Symbol::new(&env, "psm_params"),),
            (mint_fee_bps, redeem_fee_bps, debt_ceiling),
        );

        Ok(())
    }

    pub fn psm_set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::PsmPaused, &paused);

        env.events()
            .publish((Symbol::new(&env, "psm_pause"),), paused);

        Ok(())
    }

    pub fn psm_mint(env: Env, user: Address, amount: i128) -> Result<PsmSwapResult, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_psm_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let debt_ceiling: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmDebtCeiling)
            .unwrap_or(0);
        let minted_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmMintedDebt)
            .unwrap_or(0);
        let mint_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PsmMintFeeBps)
            .unwrap_or(10);

        let fee_collected = amount * i128::from(mint_fee_bps) / 10_000;
        let amount_out = amount - fee_collected;

        if minted_debt + amount_out > debt_ceiling {
            return Err(Error::PsmDebtCeilingExceeded);
        }

        let vault_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmVaultBalance)
            .unwrap_or(0);
        let new_vault = vault_balance + amount;
        env.storage()
            .instance()
            .set(&DataKey::PsmVaultBalance, &new_vault);

        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::PsmFeeVault, &(fee_vault + fee_collected));

        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(user.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::UserTokens(user.clone()),
            &(user_balance + amount_out),
        );

        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total_supply + amount_out));

        let new_minted_debt = minted_debt + amount_out;
        env.storage()
            .instance()
            .set(&DataKey::PsmMintedDebt, &new_minted_debt);

        let result = PsmSwapResult {
            amount_in: amount,
            amount_out,
            fee_collected,
            vault_balance: new_vault,
            minted_debt: new_minted_debt,
        };

        env.events()
            .publish((Symbol::new(&env, "psm_mint"),), (user, result.clone()));

        Ok(result)
    }

    pub fn psm_redeem(env: Env, user: Address, amount: i128) -> Result<PsmSwapResult, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_psm_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let redeem_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PsmRedeemFeeBps)
            .unwrap_or(10);

        let fee_collected = amount * i128::from(redeem_fee_bps) / 10_000;
        let amount_out = amount - fee_collected;

        let vault_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmVaultBalance)
            .unwrap_or(0);
        if vault_balance < amount_out {
            return Err(Error::PsmInsufficientReserve);
        }

        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(user.clone()))
            .unwrap_or(0);
        if user_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(user.clone()), &(user_balance - amount));

        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total_supply - amount));

        let minted_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmMintedDebt)
            .unwrap_or(0);
        let new_minted_debt = if minted_debt > amount {
            minted_debt - amount
        } else {
            0
        };
        env.storage()
            .instance()
            .set(&DataKey::PsmMintedDebt, &new_minted_debt);

        let new_vault = vault_balance - amount_out;
        env.storage()
            .instance()
            .set(&DataKey::PsmVaultBalance, &new_vault);

        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::PsmFeeVault, &(fee_vault + fee_collected));

        let result = PsmSwapResult {
            amount_in: amount,
            amount_out,
            fee_collected,
            vault_balance: new_vault,
            minted_debt: new_minted_debt,
        };

        env.events()
            .publish((Symbol::new(&env, "psm_redeem"),), (user, result.clone()));

        Ok(result)
    }

    pub fn psm_collect_fees(env: Env, admin: Address) -> Result<i128, Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);

        env.storage().instance().set(&DataKey::PsmFeeVault, &0i128);

        env.events().publish(
            (Symbol::new(&env, "psm_fees_collected"),),
            (admin, fee_vault),
        );

        Ok(fee_vault)
    }

    pub fn psm_config(env: Env) -> PsmConfig {
        PsmConfig {
            paused: env
                .storage()
                .instance()
                .get(&DataKey::PsmPaused)
                .unwrap_or(false),
            mint_fee_bps: env
                .storage()
                .instance()
                .get(&DataKey::PsmMintFeeBps)
                .unwrap_or(10),
            redeem_fee_bps: env
                .storage()
                .instance()
                .get(&DataKey::PsmRedeemFeeBps)
                .unwrap_or(10),
            debt_ceiling: env
                .storage()
                .instance()
                .get(&DataKey::PsmDebtCeiling)
                .unwrap_or(0),
            minted_debt: env
                .storage()
                .instance()
                .get(&DataKey::PsmMintedDebt)
                .unwrap_or(0),
            vault_balance: env
                .storage()
                .instance()
                .get(&DataKey::PsmVaultBalance)
                .unwrap_or(0),
            fee_vault: env
                .storage()
                .instance()
                .get(&DataKey::PsmFeeVault)
                .unwrap_or(0),
        }
    }

    // ── CDP & Collateralized Positions ────────────────────────────────────────

    pub fn set_liquidation_params(
        env: Env,
        admin: Address,
        liquidation_ratio_bps: u32,
        min_collateral_ratio_bps: u32,
        duration: u64,
        start_price_bps: u32,
        reserve_price_bps: u32,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if liquidation_ratio_bps < 10000 || min_collateral_ratio_bps < liquidation_ratio_bps {
            return Err(Error::InvalidAmount);
        }
        if duration == 0 || start_price_bps <= reserve_price_bps {
            return Err(Error::InvalidAmount);
        }

        env.storage()
            .instance()
            .set(&DataKey::LiquidationRatioBps, &liquidation_ratio_bps);
        env.storage()
            .instance()
            .set(&DataKey::MinCollateralRatioBps, &min_collateral_ratio_bps);
        env.storage()
            .instance()
            .set(&DataKey::AuctionDuration, &duration);
        env.storage()
            .instance()
            .set(&DataKey::AuctionStartPriceBps, &start_price_bps);
        env.storage()
            .instance()
            .set(&DataKey::AuctionReservePriceBps, &reserve_price_bps);

        env.events().publish(
            (Symbol::new(&env, "liq_params_updated"),),
            (
                liquidation_ratio_bps,
                min_collateral_ratio_bps,
                duration,
                start_price_bps,
                reserve_price_bps,
            ),
        );

        Ok(())
    }

    pub fn open_position(
        env: Env,
        user: Address,
        collateral_amount: i128,
        debt_amount: i128,
    ) -> Result<Position, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;

        if collateral_amount <= 0 || debt_amount < 0 {
            return Err(Error::InvalidAmount);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::ActiveAuctionForUser(user.clone()))
        {
            return Err(Error::AuctionAlreadyActive);
        }

        let mut pos = Self::get_position(env.clone(), user.clone());
        pos.collateral = pos.collateral.saturating_add(collateral_amount);
        pos.debt = pos.debt.saturating_add(debt_amount);
        pos.last_updated = env.ledger().timestamp();

        if pos.debt > 0 {
            let min_mcr: u32 = env
                .storage()
                .instance()
                .get(&DataKey::MinCollateralRatioBps)
                .unwrap_or(15000);
            let cr = Self::calculate_collateral_ratio(&env, pos.collateral, pos.debt);
            if cr < i128::from(min_mcr) {
                return Err(Error::BelowMinCollateralRatio);
            }
        }

        if debt_amount > 0 {
            Self::mint_tokens(&env, &user, debt_amount)?;
            let total_cdp: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TotalCdpDebt)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::TotalCdpDebt, &(total_cdp + debt_amount));
        }

        let tot_col: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &(tot_col + collateral_amount));

        env.storage()
            .persistent()
            .set(&DataKey::Position(user.clone()), &pos);

        env.events().publish(
            (Symbol::new(&env, "pos_updated"),),
            (user, pos.collateral, pos.debt),
        );

        Ok(pos)
    }

    pub fn deposit_collateral(env: Env, user: Address, amount: i128) -> Result<Position, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::ActiveAuctionForUser(user.clone()))
        {
            return Err(Error::AuctionAlreadyActive);
        }

        let mut pos = Self::get_position(env.clone(), user.clone());
        pos.collateral = pos.collateral.saturating_add(amount);
        pos.last_updated = env.ledger().timestamp();

        let tot_col: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &(tot_col + amount));

        env.storage()
            .persistent()
            .set(&DataKey::Position(user.clone()), &pos);

        env.events().publish(
            (Symbol::new(&env, "pos_deposited"),),
            (user, pos.collateral, pos.debt),
        );

        Ok(pos)
    }

    pub fn borrow(env: Env, user: Address, amount: i128) -> Result<Position, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::ActiveAuctionForUser(user.clone()))
        {
            return Err(Error::AuctionAlreadyActive);
        }

        let mut pos = Self::get_position(env.clone(), user.clone());
        pos.debt = pos.debt.saturating_add(amount);
        pos.last_updated = env.ledger().timestamp();

        let min_mcr: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinCollateralRatioBps)
            .unwrap_or(15000);
        let cr = Self::calculate_collateral_ratio(&env, pos.collateral, pos.debt);
        if cr < i128::from(min_mcr) {
            return Err(Error::BelowMinCollateralRatio);
        }

        Self::mint_tokens(&env, &user, amount)?;

        let total_cdp: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCdpDebt)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCdpDebt, &(total_cdp + amount));

        env.storage()
            .persistent()
            .set(&DataKey::Position(user.clone()), &pos);

        env.events().publish(
            (Symbol::new(&env, "borrowed"),),
            (user, pos.collateral, pos.debt),
        );

        Ok(pos)
    }

    pub fn repay_debt(env: Env, user: Address, amount: i128) -> Result<Position, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = Self::get_position(env.clone(), user.clone());
        if pos.debt == 0 {
            return Ok(pos);
        }

        let repay_amt = pos.debt.min(amount);
        Self::burn_tokens(&env, &user, repay_amt)?;

        pos.debt = pos.debt.saturating_sub(repay_amt);
        pos.last_updated = env.ledger().timestamp();

        let total_cdp: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCdpDebt)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalCdpDebt,
            &(total_cdp.saturating_sub(repay_amt)),
        );

        env.storage()
            .persistent()
            .set(&DataKey::Position(user.clone()), &pos);

        env.events().publish(
            (Symbol::new(&env, "repaid"),),
            (user, pos.collateral, pos.debt),
        );

        Ok(pos)
    }

    pub fn withdraw_collateral(env: Env, user: Address, amount: i128) -> Result<Position, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::ActiveAuctionForUser(user.clone()))
        {
            return Err(Error::AuctionAlreadyActive);
        }

        let mut pos = Self::get_position(env.clone(), user.clone());
        if pos.collateral < amount {
            return Err(Error::InsufficientCollateral);
        }

        let remaining_col = pos.collateral - amount;
        if pos.debt > 0 {
            let min_mcr: u32 = env
                .storage()
                .instance()
                .get(&DataKey::MinCollateralRatioBps)
                .unwrap_or(15000);
            let cr = Self::calculate_collateral_ratio(&env, remaining_col, pos.debt);
            if cr < i128::from(min_mcr) {
                return Err(Error::BelowMinCollateralRatio);
            }
        }

        pos.collateral = remaining_col;
        pos.last_updated = env.ledger().timestamp();

        let tot_col: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &(tot_col.saturating_sub(amount)));

        env.storage()
            .persistent()
            .set(&DataKey::Position(user.clone()), &pos);

        let user_col = Self::get_user_collateral(env.clone(), user.clone());
        env.storage()
            .persistent()
            .set(&DataKey::UserCollateral(user.clone()), &(user_col + amount));

        env.events().publish(
            (Symbol::new(&env, "withdrawn_col"),),
            (user, pos.collateral, pos.debt),
        );

        Ok(pos)
    }

    pub fn get_position(env: Env, user: Address) -> Position {
        env.storage()
            .persistent()
            .get(&DataKey::Position(user))
            .unwrap_or(Position {
                collateral: 0,
                debt: 0,
                last_updated: 0,
            })
    }

    pub fn get_collateral_ratio(env: Env, user: Address) -> i128 {
        let pos = Self::get_position(env.clone(), user);
        if pos.debt == 0 {
            return i128::MAX;
        }
        Self::calculate_collateral_ratio(&env, pos.collateral, pos.debt)
    }

    pub fn is_liquidatable(env: Env, user: Address) -> bool {
        let pos = Self::get_position(env.clone(), user);
        if pos.debt == 0 {
            return false;
        }
        let cr = Self::calculate_collateral_ratio(&env, pos.collateral, pos.debt);
        let liq_mcr: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LiquidationRatioBps)
            .unwrap_or(15000);
        cr < i128::from(liq_mcr)
    }

    pub fn get_user_collateral(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserCollateral(user))
            .unwrap_or(0)
    }

    pub fn withdraw_user_collateral(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let current = Self::get_user_collateral(env.clone(), user.clone());
        if current < amount {
            return Err(Error::InsufficientCollateral);
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserCollateral(user.clone()), &(current - amount));

        env.events()
            .publish((Symbol::new(&env, "claimed_user_col"),), (user, amount));

        Ok(())
    }

    // ── Dutch Auction Liquidation Engine (MakerDAO Liquidation 2.0) ──────────

    pub fn start_liquidation_auction(
        env: Env,
        caller: Address,
        user: Address,
    ) -> Result<u64, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        if !Self::is_liquidatable(env.clone(), user.clone()) {
            return Err(Error::PositionHealthy);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::ActiveAuctionForUser(user.clone()))
        {
            return Err(Error::AuctionAlreadyActive);
        }

        let pos = Self::get_position(env.clone(), user.clone());
        let lot = pos.collateral;
        let tab = pos.debt;

        // Seize position
        env.storage().persistent().set(
            &DataKey::Position(user.clone()),
            &Position {
                collateral: 0,
                debt: 0,
                last_updated: env.ledger().timestamp(),
            },
        );

        let tot_col: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &(tot_col.saturating_sub(lot)));

        let total_cdp: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCdpDebt)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCdpDebt, &(total_cdp.saturating_sub(tab)));

        // Setup Dutch Auction with price decay
        let price = Self::get_price(env.clone());
        let start_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AuctionStartPriceBps)
            .unwrap_or(12000);
        let reserve_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AuctionReservePriceBps)
            .unwrap_or(4000);
        let duration: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AuctionDuration)
            .unwrap_or(3600);

        let start_price = price * i128::from(start_bps) / 10_000;
        let reserve_price = price * i128::from(reserve_bps) / 10_000;
        let start_time = env.ledger().timestamp();

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AuctionCounter)
            .unwrap_or(0);
        let auction_id = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::AuctionCounter, &auction_id);

        let auction = LiquidationAuction {
            id: auction_id,
            borrower: user.clone(),
            collateral_lot: lot,
            collateral_remaining: lot,
            debt_to_cover: tab,
            debt_remaining: tab,
            start_time,
            duration,
            start_price,
            reserve_price,
            settled: false,
            socialized: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);
        env.storage()
            .persistent()
            .set(&DataKey::ActiveAuctionForUser(user.clone()), &auction_id);

        env.events().publish(
            (Symbol::new(&env, "auction_started"),),
            (auction_id, user, lot, tab, start_price, reserve_price),
        );

        Ok(auction_id)
    }

    pub fn get_auction(env: Env, auction_id: u64) -> Result<LiquidationAuction, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Auction(auction_id))
            .ok_or(Error::AuctionNotFound)
    }

    pub fn get_auction_price(env: Env, auction_id: u64) -> Result<i128, Error> {
        let auction = Self::get_auction(env.clone(), auction_id)?;
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(auction.start_time);
        Ok(calculate_dutch_price(
            auction.start_price,
            auction.reserve_price,
            elapsed,
            auction.duration,
        ))
    }

    pub fn buy_auction(
        env: Env,
        bidder: Address,
        auction_id: u64,
        max_collateral_to_buy: i128,
        max_price: i128,
    ) -> Result<AuctionBuyResult, Error> {
        bidder.require_auth();
        Self::assert_not_paused(&env)?;

        let mut auction = Self::get_auction(env.clone(), auction_id)?;
        if auction.settled || auction.socialized {
            return Err(Error::AuctionAlreadySettled);
        }

        if max_collateral_to_buy <= 0 {
            return Err(Error::InvalidAmount);
        }

        let price = Self::get_auction_price(env.clone(), auction_id)?;
        if price > max_price {
            return Err(Error::PriceExceedsMax);
        }

        // Amount of collateral needed to satisfy all remaining debt at current price
        let collateral_for_full_debt = if price > 0 {
            (auction.debt_remaining * 10_000_000 + price - 1) / price
        } else {
            auction.collateral_remaining
        };

        let collateral_to_buy = max_collateral_to_buy
            .min(collateral_for_full_debt)
            .min(auction.collateral_remaining);

        let mut cost = (collateral_to_buy * price) / 10_000_000;
        cost = cost.min(auction.debt_remaining);

        // Deduct stablecoins from bidder and burn
        Self::burn_tokens(&env, &bidder, cost)?;

        // Credit collateral to bidder
        let bidder_col = Self::get_user_collateral(env.clone(), bidder.clone());
        env.storage().persistent().set(
            &DataKey::UserCollateral(bidder.clone()),
            &(bidder_col + collateral_to_buy),
        );

        auction.debt_remaining = auction.debt_remaining.saturating_sub(cost);
        auction.collateral_remaining = auction
            .collateral_remaining
            .saturating_sub(collateral_to_buy);

        if auction.debt_remaining == 0 {
            // Debt fully covered. Return any excess collateral to the borrower!
            if auction.collateral_remaining > 0 {
                let borrower_col = Self::get_user_collateral(env.clone(), auction.borrower.clone());
                env.storage().persistent().set(
                    &DataKey::UserCollateral(auction.borrower.clone()),
                    &(borrower_col + auction.collateral_remaining),
                );
                auction.collateral_remaining = 0;
            }
            auction.settled = true;
            env.storage()
                .persistent()
                .remove(&DataKey::ActiveAuctionForUser(auction.borrower.clone()));
        } else if auction.collateral_remaining == 0 && auction.debt_remaining > 0 {
            // Collateral exhausted but debt still remains: bad debt deficit!
            let deficit = auction.debt_remaining;
            Self::internal_socialize_deficit(&env, deficit);
            auction.settled = true;
            auction.socialized = true;
            env.storage()
                .persistent()
                .remove(&DataKey::ActiveAuctionForUser(auction.borrower.clone()));
        }

        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        let res = AuctionBuyResult {
            auction_id,
            collateral_bought: collateral_to_buy,
            cost_paid: cost,
            price_per_unit: price,
            debt_remaining: auction.debt_remaining,
            collateral_remaining: auction.collateral_remaining,
            settled: auction.settled,
        };

        env.events().publish(
            (Symbol::new(&env, "auction_bought"),),
            (bidder, res.clone()),
        );

        Ok(res)
    }

    pub fn settle_expired_auction(env: Env, caller: Address, auction_id: u64) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        let mut auction = Self::get_auction(env.clone(), auction_id)?;
        if auction.settled || auction.socialized {
            return Err(Error::AuctionAlreadySettled);
        }

        let now = env.ledger().timestamp();
        if now < auction.start_time + auction.duration {
            return Err(Error::AuctionNotExpired);
        }

        // Auction expired with unbid debt
        if auction.debt_remaining > 0 {
            let deficit = auction.debt_remaining;
            Self::internal_socialize_deficit(&env, deficit);
        }

        // Return unsold collateral to borrower or reserve
        if auction.collateral_remaining > 0 {
            let borrower_col = Self::get_user_collateral(env.clone(), auction.borrower.clone());
            env.storage().persistent().set(
                &DataKey::UserCollateral(auction.borrower.clone()),
                &(borrower_col + auction.collateral_remaining),
            );
            auction.collateral_remaining = 0;
        }

        auction.settled = true;
        auction.socialized = true;
        env.storage()
            .persistent()
            .remove(&DataKey::ActiveAuctionForUser(auction.borrower.clone()));
        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        env.events().publish(
            (Symbol::new(&env, "auction_expired_settled"),),
            (auction_id, auction.debt_remaining),
        );

        Ok(())
    }

    // ── Dedicated Stability Pool ──────────────────────────────────────────────

    pub fn stability_pool_deposit(env: Env, depositor: Address, amount: i128) -> Result<(), Error> {
        depositor.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        Self::burn_tokens(&env, &depositor, amount)?;

        let pool_total = Self::stability_pool_total(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::StabilityPoolTotal, &(pool_total + amount));

        let user_bal = Self::stability_pool_balance(env.clone(), depositor.clone());
        env.storage().persistent().set(
            &DataKey::StabilityPoolUser(depositor.clone()),
            &(user_bal + amount),
        );

        env.events()
            .publish((Symbol::new(&env, "stab_deposit"),), (depositor, amount));

        Ok(())
    }

    pub fn stability_pool_withdraw(
        env: Env,
        depositor: Address,
        amount: i128,
    ) -> Result<(), Error> {
        depositor.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let user_bal = Self::stability_pool_balance(env.clone(), depositor.clone());
        if user_bal < amount {
            return Err(Error::InsufficientBalance);
        }

        let pool_total = Self::stability_pool_total(env.clone());
        env.storage().instance().set(
            &DataKey::StabilityPoolTotal,
            &(pool_total.saturating_sub(amount)),
        );

        env.storage().persistent().set(
            &DataKey::StabilityPoolUser(depositor.clone()),
            &(user_bal - amount),
        );

        Self::mint_tokens(&env, &depositor, amount)?;

        env.events()
            .publish((Symbol::new(&env, "stab_withdraw"),), (depositor, amount));

        Ok(())
    }

    pub fn stability_pool_total(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::StabilityPoolTotal)
            .unwrap_or(0)
    }

    pub fn stability_pool_balance(env: Env, depositor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::StabilityPoolUser(depositor))
            .unwrap_or(0)
    }

    pub fn stability_pool_col_balance(env: Env, depositor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::StabilityPoolUserCollateral(depositor))
            .unwrap_or(0)
    }

    pub fn stability_pool_claim_collateral(env: Env, depositor: Address) -> Result<i128, Error> {
        depositor.require_auth();
        let claimable = Self::stability_pool_col_balance(env.clone(), depositor.clone());
        if claimable <= 0 {
            return Ok(0);
        }

        env.storage().persistent().set(
            &DataKey::StabilityPoolUserCollateral(depositor.clone()),
            &0i128,
        );

        let user_col = Self::get_user_collateral(env.clone(), depositor.clone());
        env.storage().persistent().set(
            &DataKey::UserCollateral(depositor.clone()),
            &(user_col + claimable),
        );

        env.events().publish(
            (Symbol::new(&env, "stab_col_claimed"),),
            (depositor, claimable),
        );

        Ok(claimable)
    }

    pub fn liquidate_via_stability_pool(
        env: Env,
        caller: Address,
        borrower: Address,
    ) -> Result<StabilityPoolAbsorptionResult, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        if !Self::is_liquidatable(env.clone(), borrower.clone()) {
            return Err(Error::PositionHealthy);
        }

        let pool_total = Self::stability_pool_total(env.clone());
        if pool_total <= 0 {
            return Err(Error::InsufficientStabilityPool);
        }

        let pos = Self::get_position(env.clone(), borrower.clone());
        let lot = pos.collateral;
        let tab = pos.debt;

        // Seize borrower's position
        env.storage().persistent().set(
            &DataKey::Position(borrower.clone()),
            &Position {
                collateral: 0,
                debt: 0,
                last_updated: env.ledger().timestamp(),
            },
        );

        let tot_col: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCollateral)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &(tot_col.saturating_sub(lot)));

        let total_cdp: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCdpDebt)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCdpDebt, &(total_cdp.saturating_sub(tab)));

        let debt_absorbed = tab.min(pool_total);
        let remaining_debt = tab.saturating_sub(debt_absorbed);

        // Deduct from stability pool
        env.storage()
            .instance()
            .set(&DataKey::StabilityPoolTotal, &(pool_total - debt_absorbed));

        // Credit discounted collateral into caller's or pool depositors' reward
        let cur_stab_col: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::StabilityPoolUserCollateral(caller.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::StabilityPoolUserCollateral(caller.clone()),
            &(cur_stab_col + lot),
        );

        let mut res_recovered = 0i128;
        let mut bad_debt_socialized = 0i128;

        if remaining_debt > 0 {
            let (rec, bad) = Self::internal_socialize_deficit(&env, remaining_debt);
            res_recovered = rec;
            bad_debt_socialized = bad;
        }

        let result = StabilityPoolAbsorptionResult {
            debt_absorbed,
            collateral_rewarded: lot,
            remaining_debt,
            bad_debt_socialized,
            reserve_recovered: res_recovered,
        };

        env.events().publish(
            (Symbol::new(&env, "stab_liquidated"),),
            (borrower, result.clone()),
        );

        Ok(result)
    }

    // ── Bad Debt & Protocol Reserve Deficit Recovery Mechanics ────────────────

    pub fn get_bad_debt(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::BadDebt).unwrap_or(0)
    }

    pub fn socialize_bad_debt(env: Env, caller: Address, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let current = Self::get_bad_debt(env.clone());
        let updated = current.saturating_add(amount);
        env.storage().instance().set(&DataKey::BadDebt, &updated);

        env.events().publish(
            (Symbol::new(&env, "bad_debt_socialized"),),
            (caller, amount, updated),
        );

        Ok(())
    }

    pub fn repay_bad_debt(env: Env, caller: Address, amount: i128) -> Result<i128, Error> {
        caller.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current = Self::get_bad_debt(env.clone());
        if current == 0 {
            return Ok(0);
        }

        let burn_amt = current.min(amount);
        Self::burn_tokens(&env, &caller, burn_amt)?;

        let updated = current - burn_amt;
        env.storage().instance().set(&DataKey::BadDebt, &updated);

        env.events().publish(
            (Symbol::new(&env, "bad_debt_repaid"),),
            (caller, burn_amt, updated),
        );

        Ok(updated)
    }

    // ── Base stablecoin functions (unchanged from v1) ─────────────────────────

    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        Self::mint_tokens(&env, &to, amount)?;

        env.events()
            .publish((Symbol::new(&env, "mint"),), (to, amount));

        Ok(())
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        Self::burn_tokens(&env, &from, amount)?;

        env.events()
            .publish((Symbol::new(&env, "burn"),), (from, amount));

        Ok(())
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let from_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let to_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(to.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(from.clone()), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(to.clone()), &(to_balance + amount));

        env.events()
            .publish((Symbol::new(&env, "transfer"),), (from, to, amount));

        Ok(())
    }

    pub fn set_price(env: Env, oracle: Address, new_price: i128) -> Result<(), Error> {
        oracle.require_auth();
        Self::assert_oracle(&env, &oracle)?;

        if new_price <= 0 {
            return Err(Error::InvalidAmount);
        }

        env.storage()
            .instance()
            .set(&DataKey::CurrentPrice, &new_price);

        env.events().publish(
            (Symbol::new(&env, "price_updated"),),
            (oracle, new_price, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn rebase(env: Env, caller: Address) -> Result<RebaseInfo, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        let last_rebase: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LastRebaseTime)
            .unwrap_or(0);
        let cooldown: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RebaseCooldown)
            .unwrap_or(3600);
        let current_time = env.ledger().timestamp();

        if current_time < last_rebase + cooldown {
            return Err(Error::RebaseTooFrequent);
        }

        let current_price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPrice)
            .unwrap();
        let target_price: i128 = env.storage().instance().get(&DataKey::TargetPrice).unwrap();
        let old_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        let new_supply = if current_price > target_price {
            let expansion_ratio = (current_price - target_price) * 1_000_000 / target_price;
            let expansion_amount = old_supply * expansion_ratio / 1_000_000;
            old_supply + expansion_amount
        } else if current_price < target_price {
            let contraction_ratio = (target_price - current_price) * 1_000_000 / target_price;
            let max_contraction = old_supply * contraction_ratio / 1_000_000;
            let reserve: i128 = env
                .storage()
                .instance()
                .get(&DataKey::ReserveBalance)
                .unwrap_or(0);
            let actual_contraction = if max_contraction > reserve {
                reserve
            } else {
                max_contraction
            };
            old_supply - actual_contraction
        } else {
            old_supply
        };

        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);
        env.storage()
            .instance()
            .set(&DataKey::LastRebaseTime, &current_time);

        let info = RebaseInfo {
            old_supply,
            new_supply,
            price: current_price,
            timestamp: current_time,
        };

        env.events()
            .publish((Symbol::new(&env, "rebase"),), info.clone());

        Ok(info)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if Self::is_paused(env.clone()) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((Symbol::new(&env, "paused"),), admin);

        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if !Self::is_paused(env.clone()) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((Symbol::new(&env, "unpaused"),), admin);

        Ok(())
    }

    pub fn add_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::ReserveBalance, &(current_reserve + amount));

        env.events()
            .publish((Symbol::new(&env, "reserve_added"),), (admin, amount));

        Ok(())
    }

    pub fn withdraw_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0);
        if current_reserve < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage()
            .instance()
            .set(&DataKey::ReserveBalance, &(current_reserve - amount));

        env.events()
            .publish((Symbol::new(&env, "reserve_withdrawn"),), (admin, amount));

        Ok(())
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserTokens(user))
            .unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn get_price(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CurrentPrice)
            .unwrap_or(10_000_000)
    }

    pub fn get_target_price(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TargetPrice)
            .unwrap_or(10_000_000)
    }

    pub fn get_reserve(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn calculate_collateral_ratio(env: &Env, collateral: i128, debt: i128) -> i128 {
        if debt == 0 {
            return i128::MAX;
        }
        let price = Self::get_price(env.clone());
        let col_val = collateral
            .saturating_mul(price)
            .checked_div(10_000_000)
            .unwrap_or(0);
        col_val
            .saturating_mul(10_000)
            .checked_div(debt)
            .unwrap_or(0)
    }

    fn mint_tokens(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
        let bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(to.clone()), &(bal + amount));

        let tot: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(tot + amount));

        Ok(())
    }

    fn burn_tokens(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
        let bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(from.clone()))
            .unwrap_or(0);
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(from.clone()), &(bal - amount));

        let tot: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(tot.saturating_sub(amount)));

        Ok(())
    }

    fn internal_socialize_deficit(env: &Env, deficit: i128) -> (i128, i128) {
        let mut remaining = deficit;
        let mut reserve_recovered = 0i128;

        // 1. Recover from ReserveBalance
        let reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0);
        if reserve > 0 {
            let cov = remaining.min(reserve);
            reserve_recovered += cov;
            remaining -= cov;
            env.storage()
                .instance()
                .set(&DataKey::ReserveBalance, &(reserve - cov));
        }

        // 2. Recover from PsmFeeVault
        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);
        if remaining > 0 && fee_vault > 0 {
            let cov = remaining.min(fee_vault);
            reserve_recovered += cov;
            remaining -= cov;
            env.storage()
                .instance()
                .set(&DataKey::PsmFeeVault, &(fee_vault - cov));
        }

        // 3. Socialize remaining deficit into global BadDebt accumulator
        if remaining > 0 {
            let cur_bad = Self::get_bad_debt(env.clone());
            let updated = cur_bad.saturating_add(remaining);
            env.storage().instance().set(&DataKey::BadDebt, &updated);

            env.events().publish(
                (Symbol::new(env, "bad_debt_socialized"),),
                (remaining, updated),
            );
        }

        (reserve_recovered, remaining)
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if &admin != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_oracle(env: &Env, caller: &Address) -> Result<(), Error> {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .ok_or(Error::NotInitialized)?;

        if &oracle != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if Self::is_paused(env.clone()) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_psm_not_paused(env: &Env) -> Result<(), Error> {
        let psm_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::PsmPaused)
            .unwrap_or(false);
        if psm_paused {
            return Err(Error::PsmPaused);
        }
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env,
    };

    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        AlgorithmicStablecoinClient<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AlgorithmicStablecoin, ());
        let client = AlgorithmicStablecoinClient::new(&env, &id);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let user = Address::generate(&env);

        client.init(&admin, &oracle);

        let env = std::boxed::Box::leak(std::boxed::Box::new(env));
        let client = AlgorithmicStablecoinClient::new(env, &id);

        (env.clone(), admin, oracle, user, client)
    }

    // ── Existing tests ────────────────────────────────────────────────────────

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AlgorithmicStablecoin, ());
        let client = AlgorithmicStablecoinClient::new(&env, &id);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);

        client.init(&admin, &oracle);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_price(), 10_000_000);
        assert_eq!(client.get_target_price(), 10_000_000);
        assert!(!client.is_paused());
        assert_eq!(client.get_bad_debt(), 0);
        assert_eq!(client.stability_pool_total(), 0);
    }

    #[test]
    fn test_mint() {
        let (_env, admin, _oracle, user, client) = setup();
        client.mint(&admin, &user, &1000);
        assert_eq!(client.balance(&user), 1000);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_burn() {
        let (_env, admin, _oracle, user, client) = setup();
        client.mint(&admin, &user, &1000);
        client.burn(&user, &500);
        assert_eq!(client.balance(&user), 500);
        assert_eq!(client.total_supply(), 500);
    }

    #[test]
    fn test_transfer() {
        let (env, admin, _oracle, user, client) = setup();
        let recipient = Address::generate(&env);
        client.mint(&admin, &user, &1000);
        client.transfer(&user, &recipient, &300);
        assert_eq!(client.balance(&user), 700);
        assert_eq!(client.balance(&recipient), 300);
    }

    #[test]
    fn test_set_price() {
        let (_env, _admin, oracle, _user, client) = setup();
        client.set_price(&oracle, &12_000_000);
        assert_eq!(client.get_price(), 12_000_000);
    }

    #[test]
    fn test_rebase_expansion() {
        let (env, admin, oracle, _user, client) = setup();
        client.mint(&admin, &admin, &1_000_000);
        client.set_price(&oracle, &11_000_000);
        env.ledger().set_timestamp(4000);
        let info = client.rebase(&admin);
        assert!(info.new_supply > info.old_supply);
    }

    #[test]
    fn test_pause_and_unpause() {
        let (_env, admin, _oracle, user, client) = setup();
        client.pause(&admin);
        assert!(client.is_paused());

        let result = client.try_mint(&admin, &user, &100);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));

        client.unpause(&admin);
        assert!(!client.is_paused());
        client.mint(&admin, &user, &100);
        assert_eq!(client.balance(&user), 100);
    }

    #[test]
    fn test_reserve_operations() {
        let (_env, admin, _oracle, _user, client) = setup();
        client.add_reserve(&admin, &5000);
        assert_eq!(client.get_reserve(), 5000);
        client.withdraw_reserve(&admin, &2000);
        assert_eq!(client.get_reserve(), 3000);
    }

    // ── PSM tests ─────────────────────────────────────────────────────────────

    #[test]
    fn test_psm_defaults_after_init() {
        let (_env, _admin, _oracle, _user, client) = setup();
        let cfg = client.psm_config();
        assert!(!cfg.paused);
        assert_eq!(cfg.mint_fee_bps, 10);
        assert_eq!(cfg.redeem_fee_bps, 10);
        assert_eq!(cfg.minted_debt, 0);
        assert_eq!(cfg.vault_balance, 0);
        assert_eq!(cfg.fee_vault, 0);
    }

    #[test]
    fn test_psm_mint_basic() {
        let (_env, _admin, _oracle, user, client) = setup();
        let result = client.psm_mint(&user, &10_000);

        assert_eq!(result.amount_in, 10_000);
        assert_eq!(result.fee_collected, 10); // 0.10 %
        assert_eq!(result.amount_out, 9_990);
        assert_eq!(result.vault_balance, 10_000);
        assert_eq!(result.minted_debt, 9_990);

        assert_eq!(client.balance(&user), 9_990);
        assert_eq!(client.total_supply(), 9_990);
    }

    #[test]
    fn test_psm_redeem_basic() {
        let (_env, _admin, _oracle, user, client) = setup();
        client.psm_mint(&user, &10_000);

        let result = client.psm_redeem(&user, &9_990);
        assert_eq!(result.fee_collected, 9);
        assert_eq!(result.amount_out, 9_981);
        assert_eq!(result.vault_balance, 10_000 - 9_981);
        assert_eq!(client.balance(&user), 0);
    }

    #[test]
    fn test_psm_fee_vault_accumulates() {
        let (_env, admin, _oracle, user, client) = setup();
        client.psm_mint(&user, &10_000);
        client.psm_redeem(&user, &9_990);

        let cfg = client.psm_config();
        assert_eq!(cfg.fee_vault, 10 + 9);

        let collected = client.psm_collect_fees(&admin);
        assert_eq!(collected, 19);
        let cfg2 = client.psm_config();
        assert_eq!(cfg2.fee_vault, 0);
    }

    #[test]
    fn test_psm_debt_ceiling_enforced() {
        let (_env, admin, _oracle, user, client) = setup();
        client.psm_set_params(&admin, &10, &10, &1_000);

        let ok = client.try_psm_mint(&user, &1_001);
        assert!(ok.is_ok());

        let err = client.try_psm_mint(&user, &1);
        assert_eq!(err, Err(Ok(Error::PsmDebtCeilingExceeded)));
    }

    #[test]
    fn test_psm_paused_prevents_swaps() {
        let (_env, admin, _oracle, user, client) = setup();
        client.psm_set_paused(&admin, &true);

        let mint_err = client.try_psm_mint(&user, &100);
        assert_eq!(mint_err, Err(Ok(Error::PsmPaused)));

        client.mint(&admin, &user, &100);
        let redeem_err = client.try_psm_redeem(&user, &100);
        assert_eq!(redeem_err, Err(Ok(Error::PsmPaused)));
    }

    #[test]
    fn test_psm_insufficient_reserve_on_redeem() {
        let (_env, admin, _oracle, user, client) = setup();
        client.mint(&admin, &user, &500);

        let err = client.try_psm_redeem(&user, &500);
        assert_eq!(err, Err(Ok(Error::PsmInsufficientReserve)));
    }

    #[test]
    fn test_psm_set_params_invalid_fee() {
        let (_env, admin, _oracle, _user, client) = setup();
        let err = client.try_psm_set_params(&admin, &501, &10, &1_000_000);
        assert_eq!(err, Err(Ok(Error::InvalidFeeBps)));
    }

    #[test]
    fn test_psm_set_params_invalid_ceiling() {
        let (_env, admin, _oracle, _user, client) = setup();
        let err = client.try_psm_set_params(&admin, &10, &10, &0);
        assert_eq!(err, Err(Ok(Error::InvalidDebtCeiling)));
    }

    // ── Liquidation Engine, Stability Pool & Bad Debt Tests ───────────────────

    #[test]
    fn test_position_open_borrow_repay_withdraw() {
        let (_env, _admin, _oracle, user, client) = setup();

        // 1000 collateral at $1.00 = $1000 value. Max borrow at 150% is 666.
        let pos = client.open_position(&user, &1000, &500);
        assert_eq!(pos.collateral, 1000);
        assert_eq!(pos.debt, 500);
        assert_eq!(client.balance(&user), 500);

        // Collateral ratio: (1000 * 10000) / 500 = 20000 bps (200%)
        assert_eq!(client.get_collateral_ratio(&user), 20000);
        assert!(!client.is_liquidatable(&user));

        // Repay 200 debt
        let pos2 = client.repay_debt(&user, &200);
        assert_eq!(pos2.debt, 300);
        assert_eq!(client.balance(&user), 300);

        // Withdraw 200 collateral. Remaining 800 with 300 debt: CR = (800*10000)/300 = 26666 > 15000
        let pos3 = client.withdraw_collateral(&user, &200);
        assert_eq!(pos3.collateral, 800);
        assert_eq!(client.get_user_collateral(&user), 200);
    }

    #[test]
    fn test_dutch_price_decay_curve() {
        let start_price = 12_000_000i128; // $1.20
        let reserve_price = 4_000_000i128; // $0.40
        let duration = 3600u64;

        // t = 0 -> start_price
        assert_eq!(
            calculate_dutch_price(start_price, reserve_price, 0, duration),
            12_000_000
        );

        // t = 1800 (midpoint) -> (12 + 4)/2 = 8_000_000
        assert_eq!(
            calculate_dutch_price(start_price, reserve_price, 1800, duration),
            8_000_000
        );

        // t = 3600 (end) -> reserve_price
        assert_eq!(
            calculate_dutch_price(start_price, reserve_price, 3600, duration),
            4_000_000
        );

        // t > 3600 -> reserve_price
        assert_eq!(
            calculate_dutch_price(start_price, reserve_price, 5000, duration),
            4_000_000
        );
    }

    #[test]
    fn test_50_percent_flash_crash_and_delayed_oracle_auction() {
        let (env, admin, oracle, user, client) = setup();
        let liquidator = Address::generate(&env);

        // Deposit 10,000 collateral at $10.00 price ($100,000 value). Borrow 50,000 stablecoins (200% CR)
        client.set_price(&oracle, &100_000_000); // $10.00 (with 7 decimals, 10.0 * 10_000_000)
        client.open_position(&user, &10_000, &50_000);
        assert_eq!(client.get_collateral_ratio(&user), 20000);
        assert!(!client.is_liquidatable(&user));

        // 50% Simulated Flash Crash: price collapses from $10.00 to $5.00
        // Delayed Oracle: 1800 seconds pass before oracle posts new price
        env.ledger().set_timestamp(1800);
        client.set_price(&oracle, &50_000_000); // $5.00

        // At $5.00, 10,000 collateral = $50,000 value against 50,000 debt -> 100% CR < 150% liquidation ratio!
        assert!(client.is_liquidatable(&user));

        // Liquidator triggers Dutch auction
        let auction_id = client.start_liquidation_auction(&liquidator, &user);
        let auction = client.get_auction(&auction_id);
        assert_eq!(auction.collateral_lot, 10_000);
        assert_eq!(auction.debt_to_cover, 50_000);
        assert_eq!(auction.start_price, 60_000_000); // 120% of $5.00 = $6.00
        assert_eq!(auction.reserve_price, 20_000_000); // 40% of $5.00 = $2.00

        // Give liquidator stablecoins to bid
        client.mint(&admin, &liquidator, &60_000);

        // Price discovery: 1800 seconds into auction (timestamp = 1800 + 1800 = 3600)
        // Price decays to midpoint: (6.00 + 2.00) / 2 = $4.00 (40_000_000)
        env.ledger().set_timestamp(3600);
        assert_eq!(client.get_auction_price(&auction_id), 40_000_000);

        // Liquidator buys auction to cover full debt
        // At $4.00 per collateral, 50,000 debt requires 12,500 collateral, but only 10,000 is available!
        // Liquidator buys all 10,000 collateral for 10,000 * 4 = 40,000 stablecoins.
        let buy_res = client.buy_auction(&liquidator, &auction_id, &10_000, &45_000_000);
        assert_eq!(buy_res.collateral_bought, 10_000);
        assert_eq!(buy_res.cost_paid, 40_000);
        assert_eq!(client.get_user_collateral(&liquidator), 10_000);

        // Debt was 50,000; paid 40,000 -> 10,000 deficit remaining with zero collateral left
        // The deficit (10,000) is automatically socialized into bad debt!
        assert_eq!(client.get_bad_debt(), 10_000);
        let updated_auction = client.get_auction(&auction_id);
        assert!(updated_auction.settled);
        assert!(updated_auction.socialized);
    }

    #[test]
    fn test_stability_pool_absorption_during_flash_crash() {
        let (env, admin, oracle, borrower, client) = setup();
        let depositor = Address::generate(&env);

        // Depositor funds the stability pool with 50,000 stablecoins
        client.mint(&admin, &depositor, &50_000);
        client.stability_pool_deposit(&depositor, &50_000);
        assert_eq!(client.stability_pool_total(), 50_000);
        assert_eq!(client.stability_pool_balance(&depositor), 50_000);

        // Borrower opens position with 6000 collateral and 40,000 debt at $10.00 price ($60k value, 150% CR)
        client.set_price(&oracle, &100_000_000);
        client.open_position(&borrower, &6000, &40_000);

        // 50% Flash Crash to $5.00 -> Collateral value drops to $30,000 (75% CR)
        client.set_price(&oracle, &50_000_000);
        assert!(client.is_liquidatable(&borrower));

        // Stability pool liquidates and absorbs position directly
        let res = client.liquidate_via_stability_pool(&depositor, &borrower);
        assert_eq!(res.debt_absorbed, 40_000);
        assert_eq!(res.collateral_rewarded, 6000);
        assert_eq!(res.remaining_debt, 0);

        // Pool balance reduced from 50k to 10k
        assert_eq!(client.stability_pool_total(), 10_000);

        // Depositor claims their rewarded discounted collateral
        assert_eq!(client.stability_pool_col_balance(&depositor), 6000);
        let claimed = client.stability_pool_claim_collateral(&depositor);
        assert_eq!(claimed, 6000);
        assert_eq!(client.get_user_collateral(&depositor), 6000);
    }

    #[test]
    fn test_protocol_reserve_deficit_recovery_backstop() {
        let (env, admin, oracle, user, client) = setup();
        let liquidator = Address::generate(&env);

        // Backstop protocol reserve with 15,000 units
        client.add_reserve(&admin, &15_000);
        assert_eq!(client.get_reserve(), 15_000);

        // 3000 collateral at $10.00 = $30,000 value; borrow 15,000 debt (200% CR)
        client.set_price(&oracle, &100_000_000);
        client.open_position(&user, &3000, &15_000);

        // Severe flash crash: 80% drawdown from $10.00 to $2.00 (collateral worth $6,000 against 15,000 debt)
        client.set_price(&oracle, &20_000_000);
        assert!(client.is_liquidatable(&user));

        let auction_id = client.start_liquidation_auction(&liquidator, &user);

        // Advance time past duration so price hits reserve price ($0.80 = 8_000_000)
        env.ledger().set_timestamp(4000);
        client.mint(&admin, &liquidator, &10_000);

        // Buy all 3000 collateral at floor price ($0.80 = 8_000_000) -> cost = 3000 * 8_000_000 / 10_000_000 = 2400
        client.buy_auction(&liquidator, &auction_id, &3000, &10_000_000);

        // Remaining debt: 15,000 - 2,400 = 12,600 deficit
        // Protocol reserve backstop covers the entire 12,600 from the 15,000 reserve!
        assert_eq!(client.get_reserve(), 15_000 - 12_600); // 2,400 remaining in reserve
        assert_eq!(client.get_bad_debt(), 0); // No bad debt socialized!
    }

    #[test]
    fn test_borrower_excess_collateral_returned_in_dutch_auction() {
        let (env, admin, oracle, user, client) = setup();
        let liquidator = Address::generate(&env);

        client.set_price(&oracle, &100_000_000); // $10.00
        client.open_position(&user, &10_000, &60_000); // 60,000 debt

        // Flash crash to $8.00 (below 150% MCR)
        client.set_price(&oracle, &80_000_000);
        assert!(client.is_liquidatable(&user));

        let auction_id = client.start_liquidation_auction(&liquidator, &user);

        // Liquidator buys at starting price $9.60 (120% of $8.00)
        client.mint(&admin, &liquidator, &100_000);
        let buy_res = client.buy_auction(&liquidator, &auction_id, &10_000, &100_000_000);

        // Covering 60,000 debt at $9.60 per collateral requires only 6,250 collateral!
        assert_eq!(buy_res.debt_remaining, 0);
        assert!(buy_res.settled);

        // Excess collateral (3,750) was returned to the borrower!
        assert_eq!(client.get_user_collateral(&user), 3_750);
    }

    #[test]
    fn test_bad_debt_socialization_and_repayment() {
        let (_env, admin, _oracle, _user, client) = setup();

        client.socialize_bad_debt(&admin, &5000);
        assert_eq!(client.get_bad_debt(), 5000);

        // Repay bad debt with tokens
        client.mint(&admin, &admin, &3000);
        let remaining = client.repay_bad_debt(&admin, &3000);
        assert_eq!(remaining, 2000);
        assert_eq!(client.get_bad_debt(), 2000);
    }
}
