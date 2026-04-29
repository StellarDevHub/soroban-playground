//! # Sports Prediction Market
//!
//! A Soroban smart contract for decentralized sports betting with:
//! - Three-way markets (Home / Draw / Away)
//! - Odds stored as basis points (10000 = 1.00x, 20000 = 2.00x)
//! - Oracle-based resolution
//! - Emergency pause / unpause (admin only)
//! - Proportional payout from the total pool
//! - Locked odds per bet for analytics

#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contractmeta, Address, Env, String};

use crate::storage::{
    get_admin, get_market, get_market_count, get_position, increment_market_count, is_initialized,
    is_paused, set_admin, set_market, set_paused, set_position,
};
use crate::types::{BetPosition, Error, MarketStatus, Sport, SportMarket};

contractmeta!(
    key = "Description",
    val = "Decentralized sports prediction market with live odds and betting analytics"
);

// Minimum odds: 1.01x = 10100 bp
const MIN_ODDS_BP: u32 = 10100;

#[contract]
pub struct SportsPredictionMarket;

#[contractimpl]
impl SportsPredictionMarket {
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    /// Pause all betting activity (admin only).
    pub fn pause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        get_admin(&env)?.require_auth();
        set_paused(&env, true);
        Ok(())
    }

    /// Resume betting activity (admin only).
    pub fn unpause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        get_admin(&env)?.require_auth();
        set_paused(&env, false);
        Ok(())
    }

    // ── Market lifecycle ──────────────────────────────────────────────────────

    /// Create a new sports market.
    ///
    /// `sport`: 0=Football, 1=Basketball, 2=Baseball, 3=Soccer, 4=Tennis, 5=Other  
    /// `odds_*_bp`: odds in basis points (e.g. 20000 = 2.00x). Must be ≥ 10100.
    #[allow(clippy::too_many_arguments)]
    pub fn create_market(
        env: Env,
        creator: Address,
        description: String,
        sport: u32,
        home_team: String,
        away_team: String,
        resolution_deadline: u64,
        oracle: Address,
        odds_home_bp: u32,
        odds_draw_bp: u32,
        odds_away_bp: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        creator.require_auth();

        if resolution_deadline <= env.ledger().timestamp() {
            return Err(Error::MarketExpired);
        }
        if odds_home_bp < MIN_ODDS_BP || odds_draw_bp < MIN_ODDS_BP || odds_away_bp < MIN_ODDS_BP {
            return Err(Error::InvalidOdds);
        }

        let sport_enum = match sport {
            0 => Sport::Football,
            1 => Sport::Basketball,
            2 => Sport::Baseball,
            3 => Sport::Soccer,
            4 => Sport::Tennis,
            _ => Sport::Other,
        };

        let id = increment_market_count(&env);
        let market = SportMarket {
            id,
            creator,
            description,
            sport: sport_enum,
            home_team,
            away_team,
            status: MarketStatus::Open,
            resolution_deadline,
            oracle,
            winning_outcome: None,
            odds_home_bp,
            odds_draw_bp,
            odds_away_bp,
            total_home_stake: 0,
            total_draw_stake: 0,
            total_away_stake: 0,
            created_at: env.ledger().timestamp(),
        };
        set_market(&env, &market);
        Ok(id)
    }

    /// Update odds for an open market (oracle only, before any bets are placed).
    pub fn update_odds(
        env: Env,
        market_id: u32,
        odds_home_bp: u32,
        odds_draw_bp: u32,
        odds_away_bp: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let mut market = get_market(&env, market_id)?;
        market.oracle.require_auth();

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if odds_home_bp < MIN_ODDS_BP || odds_draw_bp < MIN_ODDS_BP || odds_away_bp < MIN_ODDS_BP {
            return Err(Error::InvalidOdds);
        }

        market.odds_home_bp = odds_home_bp;
        market.odds_draw_bp = odds_draw_bp;
        market.odds_away_bp = odds_away_bp;
        set_market(&env, &market);
        Ok(())
    }

    /// Place a bet on a market outcome.
    ///
    /// `outcome`: 0=Home, 1=Draw, 2=Away
    pub fn place_bet(
        env: Env,
        bettor: Address,
        market_id: u32,
        outcome: u32,
        stake: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        bettor.require_auth();

        if stake <= 0 {
            return Err(Error::ZeroStake);
        }
        if outcome > 2 {
            return Err(Error::InvalidOutcome);
        }

        let mut market = get_market(&env, market_id)?;

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if env.ledger().timestamp() >= market.resolution_deadline {
            return Err(Error::MarketExpired);
        }

        let locked_odds = match outcome {
            0 => market.odds_home_bp,
            1 => market.odds_draw_bp,
            _ => market.odds_away_bp,
        };

        // Accumulate stake if same outcome; reject switching sides
        let position = match get_position(&env, market_id, &bettor) {
            Some(mut pos) => {
                if pos.outcome != outcome {
                    return Err(Error::InvalidOutcome);
                }
                pos.stake += stake;
                pos
            }
            None => BetPosition {
                market_id,
                bettor: bettor.clone(),
                outcome,
                stake,
                odds_bp: locked_odds,
                placed_at: env.ledger().timestamp(),
            },
        };

        match outcome {
            0 => market.total_home_stake += stake,
            1 => market.total_draw_stake += stake,
            _ => market.total_away_stake += stake,
        }

        set_position(&env, &position);
        set_market(&env, &market);
        Ok(())
    }

    /// Resolve a market (oracle only).
    ///
    /// `winning_outcome`: 0=Home, 1=Draw, 2=Away
    pub fn resolve_market(env: Env, market_id: u32, winning_outcome: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let mut market = get_market(&env, market_id)?;
        market.oracle.require_auth();

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if winning_outcome > 2 {
            return Err(Error::InvalidOutcome);
        }

        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(winning_outcome);
        set_market(&env, &market);
        Ok(())
    }

    /// Cancel a market (admin only).
    pub fn cancel_market(env: Env, market_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        get_admin(&env)?.require_auth();

        let mut market = get_market(&env, market_id)?;
        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }

        market.status = MarketStatus::Cancelled;
        set_market(&env, &market);
        Ok(())
    }

    // ── Payouts ───────────────────────────────────────────────────────────────

    /// Calculate payout for a bettor.
    ///
    /// - Cancelled market → full stake refund.
    /// - Resolved market → proportional share of total pool for winners.
    /// - Losing bet → 0.
    pub fn calculate_payout(env: Env, market_id: u32, bettor: Address) -> Result<i128, Error> {
        let market = get_market(&env, market_id)?;

        if market.status == MarketStatus::Cancelled {
            let pos = get_position(&env, market_id, &bettor)
                .ok_or(Error::PositionNotFound)?;
            return Ok(pos.stake);
        }

        if market.status != MarketStatus::Resolved {
            return Err(Error::MarketNotResolved);
        }

        let winning_outcome = market.winning_outcome.ok_or(Error::MarketNotResolved)?;
        let pos = get_position(&env, market_id, &bettor)
            .ok_or(Error::PositionNotFound)?;

        if pos.outcome != winning_outcome {
            return Ok(0);
        }

        let total_pool =
            market.total_home_stake + market.total_draw_stake + market.total_away_stake;
        let winning_pool = match winning_outcome {
            0 => market.total_home_stake,
            1 => market.total_draw_stake,
            _ => market.total_away_stake,
        };

        if winning_pool == 0 {
            return Ok(0);
        }

        Ok(pos.stake * total_pool / winning_pool)
    }

    // ── Analytics ─────────────────────────────────────────────────────────────

    /// Returns (total_pool, home_pct_bp, draw_pct_bp, away_pct_bp).
    /// Percentages are in basis points (10000 = 100%).
    pub fn get_pool_analytics(env: Env, market_id: u32) -> Result<(i128, u32, u32, u32), Error> {
        let m = get_market(&env, market_id)?;
        let total = m.total_home_stake + m.total_draw_stake + m.total_away_stake;
        if total == 0 {
            return Ok((0, 0, 0, 0));
        }
        let home_pct = (m.total_home_stake * 10000 / total) as u32;
        let draw_pct = (m.total_draw_stake * 10000 / total) as u32;
        let away_pct = (m.total_away_stake * 10000 / total) as u32;
        Ok((total, home_pct, draw_pct, away_pct))
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_market(env: Env, market_id: u32) -> Result<SportMarket, Error> {
        get_market(&env, market_id)
    }

    pub fn get_position(env: Env, market_id: u32, bettor: Address) -> Result<BetPosition, Error> {
        get_position(&env, market_id, &bettor).ok_or(Error::PositionNotFound)
    }

    pub fn market_count(env: Env) -> u32 {
        get_market_count(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
