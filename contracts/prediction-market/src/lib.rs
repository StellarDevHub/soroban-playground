#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

use crate::storage::{
    get_admin, get_market, get_market_count, get_position, increment_market_count, is_initialized,
    set_admin, set_market, set_position,
};
use crate::types::{Error, Market, MarketStatus, MarketType, Position};

#[contract]
pub struct PredictionMarket;

#[contractimpl]
impl PredictionMarket {
    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    /// Create a new prediction market.
    /// market_type: 0 = Binary, 1 = Scalar
    pub fn create_market(
        env: Env,
        creator: Address,
        question: String,
        market_type: u32,
        resolution_deadline: u64,
        oracle: Address,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        creator.require_auth();

        if resolution_deadline <= env.ledger().timestamp() {
            return Err(Error::MarketExpired);
        }

        let mtype = match market_type {
            0 => MarketType::Binary,
            1 => MarketType::Scalar,
            _ => return Err(Error::InvalidMarketType),
        };

        let id = increment_market_count(&env);

        let market = Market {
            id,
            creator,
            question,
            market_type: mtype,
            status: MarketStatus::Open,
            resolution_deadline,
            oracle,
            winning_outcome: None,
            total_yes_stake: 0,
            total_no_stake: 0,
            created_at: env.ledger().timestamp(),
        };

        set_market(&env, &market);
        Ok(id)
    }

    /// Place a position on a market outcome.
    /// outcome: 1 = YES, 0 = NO
    pub fn place_bet(
        env: Env,
        trader: Address,
        market_id: u32,
        outcome: u32,
        stake: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        trader.require_auth();

        if stake <= 0 {
            return Err(Error::ZeroStake);
        }
        if outcome > 1 {
            return Err(Error::InvalidOutcome);
        }

        let mut market = get_market(&env, market_id)?;

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if env.ledger().timestamp() >= market.resolution_deadline {
            return Err(Error::MarketExpired);
        }

        // Update or create position
        let position = match get_position(&env, market_id, &trader) {
            Some(mut pos) => {
                // Allow updating stake on same outcome; reject switching sides
                if pos.outcome != outcome {
                    return Err(Error::InvalidOutcome);
                }
                pos.stake += stake;
                pos
            }
            None => Position {
                market_id,
                trader: trader.clone(),
                outcome,
                stake,
            },
        };

        // Update market totals
        if outcome == 1 {
            market.total_yes_stake += stake;
        } else {
            market.total_no_stake += stake;
        }

        set_position(&env, &position);
        set_market(&env, &market);
        Ok(())
    }

    /// Resolve a market (oracle only).
    /// winning_outcome: 1 = YES, 0 = NO
    pub fn resolve_market(
        env: Env,
        market_id: u32,
        winning_outcome: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;

        let mut market = get_market(&env, market_id)?;

        // Only the designated oracle can resolve
        market.oracle.require_auth();

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if winning_outcome > 1 {
            return Err(Error::InvalidOutcome);
        }

        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(winning_outcome);
        set_market(&env, &market);
        Ok(())
    }

    /// Cancel a market (admin or creator only, before resolution deadline).
    pub fn cancel_market(env: Env, market_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;

        let admin = get_admin(&env)?;
        let mut market = get_market(&env, market_id)?;

        // Admin or creator can cancel
        let caller_is_admin = admin == market.creator;
        if !caller_is_admin {
            admin.require_auth();
        } else {
            market.creator.require_auth();
        }

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }

        market.status = MarketStatus::Cancelled;
        set_market(&env, &market);
        Ok(())
    }

    /// Calculate payout for a trader on a resolved market.
    /// Returns the payout amount (stake * total_pool / winning_pool).
    pub fn calculate_payout(env: Env, market_id: u32, trader: Address) -> Result<i128, Error> {
        let market = get_market(&env, market_id)?;

        if market.status == MarketStatus::Cancelled {
            // Full refund on cancellation
            let pos = get_position(&env, market_id, &trader)
                .ok_or(Error::PositionNotFound)?;
            return Ok(pos.stake);
        }

        if market.status != MarketStatus::Resolved {
            return Err(Error::MarketNotResolved);
        }

        let winning_outcome = market.winning_outcome.ok_or(Error::MarketNotResolved)?;
        let pos = get_position(&env, market_id, &trader)
            .ok_or(Error::PositionNotFound)?;

        if pos.outcome != winning_outcome {
            return Ok(0); // Lost
        }

        let total_pool = market.total_yes_stake + market.total_no_stake;
        let winning_pool = if winning_outcome == 1 {
            market.total_yes_stake
        } else {
            market.total_no_stake
        };

        if winning_pool == 0 {
            return Ok(0);
        }

        // payout = stake * total_pool / winning_pool
        Ok(pos.stake * total_pool / winning_pool)
    }

    // ── Read-only queries ──────────────────────────────────────────────────────

    pub fn get_market(env: Env, market_id: u32) -> Result<Market, Error> {
        get_market(&env, market_id)
    }

    pub fn get_position(env: Env, market_id: u32, trader: Address) -> Result<Position, Error> {
        get_position(&env, market_id, &trader).ok_or(Error::PositionNotFound)
    }

    pub fn market_count(env: Env) -> u32 {
        get_market_count(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}
