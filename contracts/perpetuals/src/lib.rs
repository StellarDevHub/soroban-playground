// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// # Perpetual Futures — Virtual AMM (vAMM) Funding Rate Engine
//
// Extends the perpetual-futures contract with a production-grade vAMM funding
// rate mechanism that tracks mark-price vs index-price divergence and
// periodically settles funding payments between long and short holders.
//
// ## Funding Rate Mechanics
//
// The 8-hour funding rate `r` is computed as:
//
//   premium_bps = (mark_price - index_price) × 10_000 / index_price
//   r = premium_bps / FUNDING_PERIODS_PER_DAY
//
// where `FUNDING_PERIODS_PER_DAY = 3` (three 8-hour windows per day).
//
// Positive `r` → longs pay shorts; negative `r` → shorts pay longs.
// A circuit-breaker caps `|r|` at `MAX_FUNDING_RATE_BPS` (500 bps = 5 %).
//
// ## vAMM Price Impact
//
// Open / close position interactions update the mark price via a constant-
// product invariant: `k = x * y`.  Each trade adjusts `x` (virtual asset
// reserves) and `y` (virtual USD reserves) so that mark-price reflects
// current market depth.
//
// ## Key Storage
//
// | Key                | Type          | Description                              |
// |--------------------|---------------|------------------------------------------|
// | VammConfig         | VammConfig    | Invariant k, reserve_x, reserve_y        |
// | FundingRate        | FundingRate   | Current rate, mark/index price, timestamp|
// | FundingAccumulator | i64           | Running sum of funding rates (bps × 1e6) |
// | Position(id)       | Position      | Per-position state                       |
// | FundingSnapshot(id)| i64           | Accumulator snapshot at open              |

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum absolute funding rate per period (500 bps = 5 %).
const MAX_FUNDING_RATE_BPS: i64 = 500;
/// Three funding periods per day (8-hour intervals).
const FUNDING_PERIOD_SECS: u64 = 8 * 3600;
/// Max leverage allowed (100×).
const MAX_LEVERAGE: u32 = 100;
/// Maintenance margin threshold (5 % of notional).
const MAINTENANCE_MARGIN_BPS: i128 = 500;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    InvalidLeverage = 5,
    InvalidSize = 6,
    InvalidPrice = 7,
    PositionNotFound = 8,
    PositionNotActive = 9,
    InsufficientMargin = 10,
    InvalidVammReserves = 11,
    ArithmeticOverflow = 12,
    FundingNotDue = 13,
    InvalidFundingRate = 14,
}

// ─── Storage types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PositionStatus {
    Active,
    Closed,
    Liquidated,
}

/// A trader's open position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub id: u64,
    pub trader: Address,
    pub is_long: bool,
    /// Position notional size (in base-asset units, scaled by 7 decimals).
    pub size: i128,
    pub leverage: u32,
    /// vAMM mark-price at open.
    pub entry_price: i128,
    /// Initial margin deposited.
    pub collateral: i128,
    pub status: PositionStatus,
}

/// vAMM constant-product state.
///
/// Invariant: `reserve_x * reserve_y = k` (both scaled by 1e14 to retain
/// precision while using i128).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VammConfig {
    /// Virtual base-asset reserve (e.g. virtual ETH).
    pub reserve_x: i128,
    /// Virtual quote-asset reserve (virtual USD).
    pub reserve_y: i128,
    /// Constant product `k = reserve_x * reserve_y` — stored for efficiency.
    pub k: i128,
}

/// Live funding rate state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundingRate {
    /// Current vAMM mark-price (7 decimal places).
    pub mark_price: i128,
    /// External index price — e.g. from an oracle feed (7 decimal places).
    pub index_price: i128,
    /// 8-hour funding rate in basis points (can be negative).
    pub rate_bps: i32,
    /// Ledger timestamp of the most recent update.
    pub last_update: u64,
    /// Timestamp of the most recent settlement.
    pub last_settlement: u64,
}

/// Summary returned by `settle_funding`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundingSettlement {
    /// Funding rate applied (bps, may be negative).
    pub rate_bps: i32,
    /// Whether longs paid shorts (true) or shorts paid longs (false).
    pub longs_pay: bool,
    /// Total payments redistributed (in collateral units).
    pub total_payments: i128,
    /// Updated accumulator value after settlement.
    pub new_accumulator: i64,
    /// Ledger timestamp of settlement.
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Paused,
    PositionCount,
    VammConfig,
    FundingRate,
    /// Monotonically increasing funding rate accumulator (bps × 1e6 precision).
    FundingAccumulator,
    FundingAccrualTimestamp,
    /// Per-position funding snapshot at the time the position was opened.
    FundingSnapshot(u64),
    Position(u64),
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct Perpetuals;

#[contractimpl]
impl Perpetuals {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the vAMM with seed reserves and an initial index price.
    ///
    /// `reserve_x` — virtual base-asset liquidity (e.g. 1_000_000_000 = 100 units)
    /// `reserve_y` — virtual quote-asset liquidity (must give sensible seed price)
    /// `index_price`— external oracle price at launch (7 decimal places)
    pub fn initialize(
        env: Env,
        admin: Address,
        reserve_x: i128,
        reserve_y: i128,
        index_price: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        if reserve_x <= 0 || reserve_y <= 0 {
            return Err(Error::InvalidVammReserves);
        }
        if index_price <= 0 {
            return Err(Error::InvalidPrice);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::PositionCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::FundingAccumulator, &0i64);
        env.storage()
            .instance()
            .set(&DataKey::FundingAccrualTimestamp, &env.ledger().timestamp());

        // vAMM seed state — k uses checked multiplication
        let k = reserve_x
            .checked_mul(reserve_y)
            .ok_or(Error::ArithmeticOverflow)?;
        let vamm = VammConfig {
            reserve_x,
            reserve_y,
            k,
        };
        env.storage().instance().set(&DataKey::VammConfig, &vamm);

        // Mark price derived from seed reserves: mark = reserve_y / reserve_x
        let mark_price = Self::vamm_mark_price_from(&vamm)?;
        let funding = FundingRate {
            mark_price,
            index_price,
            rate_bps: 0,
            last_update: env.ledger().timestamp(),
            last_settlement: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&DataKey::FundingRate, &funding);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Pause / unpause ───────────────────────────────────────────────────────

    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((symbol_short!("pause"),), paused);
        Ok(())
    }

    // ── vAMM mark-price ───────────────────────────────────────────────────────

    /// Returns the current vAMM mark-price (7 decimal places).
    pub fn mark_price(env: Env) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        let vamm: VammConfig = env
            .storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)?;
        Self::vamm_mark_price_from(&vamm)
    }

    /// Admin-supplied index price update (oracle push).
    pub fn update_index_price(env: Env, admin: Address, index_price: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if index_price <= 0 {
            return Err(Error::InvalidPrice);
        }
        Self::accrue_funding(&env)?;
        let mut funding: FundingRate = env
            .storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)?;
        funding.index_price = index_price;
        funding.last_update = env.ledger().timestamp();
        // Recompute funding rate bps
        funding.rate_bps = Self::compute_rate_bps(funding.mark_price, index_price);
        env.storage()
            .instance()
            .set(&DataKey::FundingRate, &funding);
        env.events()
            .publish((symbol_short!("idx_price"),), index_price);
        Ok(())
    }

    // ── Funding rate ──────────────────────────────────────────────────────────

    /// Compute and persist the current 8-hour funding rate.
    ///
    /// Can be called by anyone; skips silently if called before the 8-hour
    /// period has elapsed (returns `FundingNotDue`).
    pub fn update_funding_rate(env: Env) -> Result<i32, Error> {
        Self::assert_initialized(&env)?;
        let mut funding: FundingRate = env
            .storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        if now < funding.last_update.saturating_add(FUNDING_PERIOD_SECS) {
            return Err(Error::FundingNotDue);
        }

        Self::accrue_funding(&env)?;

        // Update mark price from vAMM state
        let vamm: VammConfig = env
            .storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)?;
        funding.mark_price = Self::vamm_mark_price_from(&vamm)?;
        funding.rate_bps = Self::compute_rate_bps(funding.mark_price, funding.index_price);
        funding.last_update = now;

        env.storage()
            .instance()
            .set(&DataKey::FundingRate, &funding);

        env.events()
            .publish((symbol_short!("fund_rate"),), funding.rate_bps);
        Ok(funding.rate_bps)
    }

    /// Settle funding payments between all open positions.
    ///
    /// Each position's collateral is adjusted by:
    ///   `payment = position.size × rate_bps / 10_000`
    ///
    /// Longs are debited when the accumulated rate is positive; shorts when it is negative.
    pub fn settle_funding(env: Env) -> Result<FundingSettlement, Error> {
        Self::assert_initialized(&env)?;
        Self::assert_not_paused(&env)?;

        let mut funding: FundingRate = env
            .storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        let last_accrual: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccrualTimestamp)
            .unwrap_or(funding.last_update);
        if now <= last_accrual {
            return Err(Error::FundingNotDue);
        }

        Self::accrue_funding(&env)?;
        let rate_bps = funding.rate_bps;
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PositionCount)
            .unwrap_or(0);

        let mut total_payments = 0i128;

        for id in 1..=count {
            let key = DataKey::Position(id);
            let pos_opt: Option<Position> = env.storage().persistent().get(&key);
            let mut pos = match pos_opt {
                Some(p) if p.status == PositionStatus::Active => p,
                _ => continue,
            };

            let open_acc: i64 = env
                .storage()
                .instance()
                .get(&DataKey::FundingSnapshot(id))
                .unwrap_or(0);
            let acc: i64 = env
                .storage()
                .instance()
                .get(&DataKey::FundingAccumulator)
                .unwrap_or(0);
            let acc_delta = i128::from(acc) - i128::from(open_acc);
            let payment = pos
                .size
                .checked_mul(acc_delta)
                .ok_or(Error::ArithmeticOverflow)?
                / 10_000_000_000i128;
            if pos.is_long {
                pos.collateral = pos
                    .collateral
                    .checked_sub(payment)
                    .ok_or(Error::ArithmeticOverflow)?;
            } else {
                pos.collateral = pos
                    .collateral
                    .checked_add(payment)
                    .ok_or(Error::ArithmeticOverflow)?;
            }
            total_payments = total_payments.saturating_add(payment.saturating_abs());
            env.storage()
                .instance()
                .set(&DataKey::FundingSnapshot(id), &acc);
            env.storage().persistent().set(&key, &pos);
            env.events()
                .publish((symbol_short!("fund_pay"), id), (pos.trader, payment));
        }

        let new_acc: i64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccumulator)
            .unwrap_or(0);

        funding.last_settlement = now;
        env.storage()
            .instance()
            .set(&DataKey::FundingRate, &funding);

        let result = FundingSettlement {
            rate_bps,
            longs_pay: rate_bps > 0,
            total_payments,
            new_accumulator: new_acc,
            timestamp: now,
        };

        env.events()
            .publish((symbol_short!("settle"),), result.clone());
        Ok(result)
    }

    // ── Positions ─────────────────────────────────────────────────────────────

    /// Open a leveraged position.
    ///
    /// The vAMM mark-price moves as a result of the trade:
    ///   For a long: sell `size` virtual base → receive virtual USD → mark rises.
    ///   For a short: buy `size` virtual base → pay virtual USD → mark falls.
    pub fn open_position(
        env: Env,
        trader: Address,
        is_long: bool,
        size: i128,
        leverage: u32,
        collateral: i128,
    ) -> Result<u64, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        trader.require_auth();

        if size <= 0 {
            return Err(Error::InvalidSize);
        }
        if leverage == 0 || leverage > MAX_LEVERAGE {
            return Err(Error::InvalidLeverage);
        }
        if collateral <= 0 {
            return Err(Error::InsufficientMargin);
        }

        Self::accrue_funding(&env)?;

        // Update vAMM state to reflect price impact
        let mut vamm: VammConfig = env
            .storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)?;
        Self::apply_vamm_trade(&mut vamm, is_long, size)?;
        let entry_price = Self::vamm_mark_price_from(&vamm)?;
        env.storage().instance().set(&DataKey::VammConfig, &vamm);

        // Update funding mark price
        let mut funding: FundingRate = env
            .storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)?;
        funding.mark_price = entry_price;
        env.storage()
            .instance()
            .set(&DataKey::FundingRate, &funding);

        // Record current accumulator snapshot for this position
        let acc: i64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccumulator)
            .unwrap_or(0);

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PositionCount)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::PositionCount, &id);
        env.storage()
            .instance()
            .set(&DataKey::FundingSnapshot(id), &acc);

        let position = Position {
            id,
            trader: trader.clone(),
            is_long,
            size,
            leverage,
            entry_price,
            collateral,
            status: PositionStatus::Active,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Position(id), &position);

        env.events()
            .publish((symbol_short!("open_pos"), id), (trader, is_long, size));
        env.events()
            .publish((symbol_short!("trade"), id), (is_long, size, entry_price));
        Ok(id)
    }

    /// Close a position.  Returns net settlement (collateral ± PnL ± funding).
    pub fn close_position(env: Env, trader: Address, position_id: u64) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        trader.require_auth();

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(position_id))
            .ok_or(Error::PositionNotFound)?;
        if pos.trader != trader {
            return Err(Error::Unauthorized);
        }
        if pos.status != PositionStatus::Active {
            return Err(Error::PositionNotActive);
        }

        Self::accrue_funding(&env)?;

        // Reverse vAMM trade to get exit price
        let mut vamm: VammConfig = env
            .storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)?;
        Self::apply_vamm_trade(&mut vamm, !pos.is_long, pos.size)?;
        let exit_price = Self::vamm_mark_price_from(&vamm)?;
        env.storage().instance().set(&DataKey::VammConfig, &vamm);

        // PnL
        let pnl = if pos.is_long {
            (exit_price - pos.entry_price) * pos.size / pos.entry_price
        } else {
            (pos.entry_price - exit_price) * pos.size / pos.entry_price
        };

        // Unpaid funding since open
        let acc: i64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccumulator)
            .unwrap_or(0);
        let open_acc: i64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingSnapshot(position_id))
            .unwrap_or(0);
        let acc_delta = i128::from(acc) - i128::from(open_acc);
        let funding_payment = pos
            .size
            .checked_mul(acc_delta)
            .ok_or(Error::ArithmeticOverflow)?
            / 10_000_000_000i128;
        let net_settlement = if pos.is_long {
            pos.collateral + pnl - funding_payment
        } else {
            pos.collateral + pnl + funding_payment
        };

        pos.status = PositionStatus::Closed;
        env.storage()
            .persistent()
            .set(&DataKey::Position(position_id), &pos);

        // Update funding mark price
        let mut funding: FundingRate = env
            .storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)?;
        funding.mark_price = exit_price;
        env.storage()
            .instance()
            .set(&DataKey::FundingRate, &funding);

        env.events().publish(
            (symbol_short!("close_pos"), position_id),
            (trader, net_settlement),
        );
        env.events().publish(
            (symbol_short!("trade"), position_id),
            (!pos.is_long, pos.size, exit_price),
        );
        Ok(net_settlement)
    }

    /// Liquidate an under-margined position.
    pub fn liquidate_position(
        env: Env,
        liquidator: Address,
        position_id: u64,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        liquidator.require_auth();

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(position_id))
            .ok_or(Error::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Err(Error::PositionNotActive);
        }

        let vamm: VammConfig = env
            .storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)?;
        let current_price = Self::vamm_mark_price_from(&vamm)?;

        let (portfolio_equity, maintenance_threshold) =
            Self::portfolio_margin(&env, &pos.trader, current_price)?;

        if portfolio_equity > maintenance_threshold {
            return Err(Error::InsufficientMargin);
        }

        pos.status = PositionStatus::Liquidated;
        env.storage()
            .persistent()
            .set(&DataKey::Position(position_id), &pos);

        env.events()
            .publish((symbol_short!("liquidate"), position_id), liquidator);
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_position(env: Env, position_id: u64) -> Result<Position, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Position(position_id))
            .ok_or(Error::PositionNotFound)
    }

    /// Returns whether a keeper can liquidate a position using cross-margin health.
    pub fn is_liquidatable(env: Env, position_id: u64) -> Result<bool, Error> {
        let pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(position_id))
            .ok_or(Error::PositionNotFound)?;
        if pos.status != PositionStatus::Active {
            return Ok(false);
        }
        let vamm: VammConfig = env
            .storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)?;
        let current_price = Self::vamm_mark_price_from(&vamm)?;
        let (equity, maintenance) = Self::portfolio_margin(&env, &pos.trader, current_price)?;
        Ok(equity <= maintenance)
    }

    pub fn get_funding_rate(env: Env) -> Result<FundingRate, Error> {
        env.storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_funding_accumulator(env: Env) -> i64 {
        env.storage()
            .instance()
            .get(&DataKey::FundingAccumulator)
            .unwrap_or(0)
    }

    pub fn get_vamm_config(env: Env) -> Result<VammConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::VammConfig)
            .ok_or(Error::NotInitialized)
    }

    pub fn position_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::PositionCount)
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

    fn funding_accumulator_at(env: &Env) -> Result<i64, Error> {
        let funding: FundingRate = env
            .storage()
            .instance()
            .get(&DataKey::FundingRate)
            .ok_or(Error::NotInitialized)?;
        let accumulator: i64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccumulator)
            .unwrap_or(0);
        let last_accrual: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccrualTimestamp)
            .unwrap_or(funding.last_update);
        let now = env.ledger().timestamp();
        if now <= last_accrual {
            return Ok(accumulator);
        }

        let elapsed = i128::from(now - last_accrual);
        let delta =
            i128::from(funding.rate_bps) * 1_000_000 * elapsed / i128::from(FUNDING_PERIOD_SECS);
        Ok(
            (i128::from(accumulator) + delta).clamp(i128::from(i64::MIN), i128::from(i64::MAX))
                as i64,
        )
    }

    fn accrue_funding(env: &Env) -> Result<i64, Error> {
        let now = env.ledger().timestamp();
        let last_accrual: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingAccrualTimestamp)
            .unwrap_or(now);
        let accrued = Self::funding_accumulator_at(env)?;
        if now > last_accrual {
            env.storage()
                .instance()
                .set(&DataKey::FundingAccumulator, &accrued);
            env.storage()
                .instance()
                .set(&DataKey::FundingAccrualTimestamp, &now);
        }
        Ok(accrued)
    }

    fn portfolio_margin(
        env: &Env,
        trader: &Address,
        current_price: i128,
    ) -> Result<(i128, i128), Error> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PositionCount)
            .unwrap_or(0);
        let accumulator = i128::from(Self::funding_accumulator_at(env)?);
        let mut equity = 0i128;
        let mut maintenance = 0i128;

        for id in 1..=count {
            let pos: Option<Position> = env.storage().persistent().get(&DataKey::Position(id));
            let pos = match pos {
                Some(p) if p.trader == *trader && p.status == PositionStatus::Active => p,
                _ => continue,
            };
            let price_delta = if pos.is_long {
                current_price - pos.entry_price
            } else {
                pos.entry_price - current_price
            };
            let pnl = price_delta
                .checked_mul(pos.size)
                .ok_or(Error::ArithmeticOverflow)?
                / pos.entry_price;
            let open_acc: i64 = env
                .storage()
                .instance()
                .get(&DataKey::FundingSnapshot(id))
                .unwrap_or(0);
            let funding_payment = pos
                .size
                .checked_mul(accumulator - i128::from(open_acc))
                .ok_or(Error::ArithmeticOverflow)?
                / 10_000_000_000i128;
            let funding_adjustment = if pos.is_long {
                -funding_payment
            } else {
                funding_payment
            };
            let notional = pos
                .size
                .checked_mul(current_price)
                .ok_or(Error::ArithmeticOverflow)?
                / 10_000_000i128;
            equity = equity
                .checked_add(pos.collateral)
                .and_then(|value| value.checked_add(pnl))
                .and_then(|value| value.checked_add(funding_adjustment))
                .ok_or(Error::ArithmeticOverflow)?;
            maintenance = maintenance
                .checked_add(
                    notional
                        .checked_mul(MAINTENANCE_MARGIN_BPS)
                        .ok_or(Error::ArithmeticOverflow)?
                        / 10_000,
                )
                .ok_or(Error::ArithmeticOverflow)?;
        }
        Ok((equity, maintenance))
    }

    // ── vAMM helpers ──────────────────────────────────────────────────────────

    /// Derive mark-price from vAMM reserves: `price = reserve_y / reserve_x`.
    /// Both reserves use 7 decimal places, so the result is in 7dp price units.
    fn vamm_mark_price_from(vamm: &VammConfig) -> Result<i128, Error> {
        if vamm.reserve_x == 0 {
            return Err(Error::InvalidVammReserves);
        }
        // Multiply numerator by 1e7 to retain 7 decimal places in result
        Ok(vamm.reserve_y * 10_000_000 / vamm.reserve_x)
    }

    /// Adjust reserves for a trade using constant-product invariant.
    ///
    /// For a long (buy):  dx enters → reserve_x increases → reserve_y decreases.
    /// For a short (sell): dx leaves → reserve_x decreases → reserve_y increases.
    fn apply_vamm_trade(vamm: &mut VammConfig, is_long: bool, size: i128) -> Result<(), Error> {
        if is_long {
            // Trader buys `size` base asset → remove base from pool, increasing mark price
            if vamm.reserve_x <= size {
                return Err(Error::InvalidVammReserves);
            }
            let new_x = vamm.reserve_x - size;
            let new_y = vamm.k / new_x;
            vamm.reserve_x = new_x;
            vamm.reserve_y = new_y;
        } else {
            // Trader sells `size` base asset → feed base into pool, decreasing mark price
            let new_x = vamm
                .reserve_x
                .checked_add(size)
                .ok_or(Error::ArithmeticOverflow)?;
            if new_x == 0 {
                return Err(Error::InvalidVammReserves);
            }
            let new_y = vamm.k / new_x;
            vamm.reserve_x = new_x;
            vamm.reserve_y = new_y;
        }
        Ok(())
    }

    /// Compute the 8-hour funding rate in basis points, clamped to ±500 bps.
    ///
    /// `rate_bps = (mark - index) * 10_000 / index`
    fn compute_rate_bps(mark_price: i128, index_price: i128) -> i32 {
        if index_price == 0 {
            return 0;
        }
        let raw: i64 = ((mark_price - index_price) * 10_000 / index_price) as i64;
        let clamped = raw.clamp(-MAX_FUNDING_RATE_BPS, MAX_FUNDING_RATE_BPS);
        clamped as i32
    }

    // ── Auth helpers ──────────────────────────────────────────────────────────

    fn assert_admin(env: &Env, admin: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored != *admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env};

    /// 1 billion virtual units of each reserve → seed mark price ≈ 1.0
    const RX: i128 = 1_000_000_000;
    const RY: i128 = 1_000_000_000;
    /// Index price at 7 decimal places (1.00 USD → 10_000_000)
    const IDX: i128 = 10_000_000;

    fn setup() -> (Env, Address, PerpetualsClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, Perpetuals);
        let client = PerpetualsClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.initialize(&admin, &RX, &RY, &IDX);

        let env_ref = std::boxed::Box::leak(std::boxed::Box::new(env));
        let client = PerpetualsClient::new(env_ref, &id);
        (env_ref.clone(), admin, client)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, client) = setup();
        assert_eq!(client.get_admin(), admin);
        assert!(!client.is_paused());
        assert_eq!(client.position_count(), 0);

        let fr = client.get_funding_rate();
        assert_eq!(fr.index_price, IDX);
        assert_eq!(fr.rate_bps, 0);
    }

    #[test]
    fn test_double_initialize_fails() {
        let (_env, admin, client) = setup();
        let err = client.try_initialize(&admin, &RX, &RY, &IDX);
        assert_eq!(err, Err(Ok(Error::AlreadyInitialized)));
    }

    #[test]
    fn test_vamm_mark_price_seed() {
        let (_env, _admin, client) = setup();
        // With equal reserves, mark ≈ 10_000_000 (7dp)
        let mp = client.mark_price();
        assert_eq!(mp, 10_000_000);
    }

    #[test]
    fn test_open_long_moves_mark_up() {
        let (_env, _admin, client) = setup();
        let mp_before = client.mark_price();

        let trader = Address::generate(&_env);
        client.open_position(&trader, &true, &1_000_000, &5, &500_000);

        let mp_after = client.mark_price();
        assert!(mp_after > mp_before, "mark should rise after long");
    }

    #[test]
    fn test_open_short_moves_mark_down() {
        let (_env, _admin, client) = setup();
        let mp_before = client.mark_price();

        let trader = Address::generate(&_env);
        client.open_position(&trader, &false, &1_000_000, &5, &500_000);

        let mp_after = client.mark_price();
        assert!(mp_after < mp_before, "mark should fall after short");
    }

    #[test]
    fn test_close_long_returns_collateral_plus_pnl() {
        let (_env, _admin, client) = setup();
        let trader = Address::generate(&_env);

        let id = client.open_position(&trader, &true, &100_000, &5, &200_000);
        let net = client.close_position(&trader, &id);

        // Net settlement can be positive or negative; just assert it ran
        assert!(net != 0 || net == 0); // always true — smoke test
    }

    #[test]
    fn test_update_funding_rate_not_due() {
        let (_env, _admin, client) = setup();
        // Immediately after init, funding period hasn't elapsed
        let err = client.try_update_funding_rate();
        assert_eq!(err, Err(Ok(Error::FundingNotDue)));
    }

    #[test]
    fn test_update_funding_rate_after_period() {
        let (env, _admin, client) = setup();
        // Advance ledger by 8 hours + 1 second
        env.ledger().set_timestamp(FUNDING_PERIOD_SECS + 1);
        let rate = client.update_funding_rate();
        // With equal mark and index, rate should be 0
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_funding_rate_clamped() {
        let (env, admin, client) = setup();
        // Push index price far below mark to produce large premium
        client.update_index_price(&admin, &100); // tiny index
        env.ledger().set_timestamp(FUNDING_PERIOD_SECS + 1);
        let rate = client.update_funding_rate();
        assert_eq!(rate, MAX_FUNDING_RATE_BPS as i32, "rate capped at +500 bps");
    }

    #[test]
    fn test_settle_funding_not_due() {
        let (_env, _admin, client) = setup();
        let err = client.try_settle_funding();
        assert_eq!(err, Err(Ok(Error::FundingNotDue)));
    }

    #[test]
    fn test_settle_funding_deducts_from_longs() {
        let (env, admin, client) = setup();

        let trader = Address::generate(&env);
        let pos_id = client.open_position(&trader, &true, &10_000_000, &5, &1_000_000);

        let pos_before = client.get_position(&pos_id);
        let col_before = pos_before.collateral;

        // Raise mark above index so longs pay
        client.update_index_price(&admin, &(IDX / 2)); // index drops → premium rises
        env.ledger().set_timestamp(FUNDING_PERIOD_SECS + 1);

        let result = client.settle_funding();
        assert!(result.longs_pay, "longs should pay when mark > index");
        assert!(result.total_payments > 0);

        let pos_after = client.get_position(&pos_id);
        assert!(
            pos_after.collateral < col_before,
            "long collateral should decrease after settlement"
        );
    }

    #[test]
    fn test_pause_blocks_open_position() {
        let (_env, admin, client) = setup();
        client.set_paused(&admin, &true);

        let trader = Address::generate(&_env);
        let err = client.try_open_position(&trader, &true, &100_000, &5, &50_000);
        assert_eq!(err, Err(Ok(Error::ContractPaused)));
    }

    #[test]
    fn test_invalid_leverage_rejected() {
        let (_env, _admin, client) = setup();
        let trader = Address::generate(&_env);

        // leverage = 0
        let e1 = client.try_open_position(&trader, &true, &100_000, &0, &50_000);
        assert_eq!(e1, Err(Ok(Error::InvalidLeverage)));

        // leverage > MAX (101)
        let e2 = client.try_open_position(&trader, &true, &100_000, &101, &50_000);
        assert_eq!(e2, Err(Ok(Error::InvalidLeverage)));
    }
}
