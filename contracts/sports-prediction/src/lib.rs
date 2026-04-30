#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, symbol_short};
use crate::storage::{
    get_admin, get_market, get_market_count, get_bet, increment_market_count, 
    is_initialized, set_admin, set_initialized, set_market, set_bet, is_paused, set_paused
};
use crate::types::{Error, SportMarket, MarketStatus, Bet, Outcome};

#[contract]
pub struct SportsPrediction;

#[contractimpl]
impl SportsPrediction {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        Ok(())
    }

    pub fn create_market(
        env: Env,
        event_name: String,
        outcomes_names: Vec<String>,
        resolution_deadline: u64,
        oracle: Address,
    ) -> Result<u32, Error> {
        ensure_not_paused(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        if resolution_deadline <= env.ledger().timestamp() {
            return Err(Error::MarketExpired);
        }

        let mut outcomes = Vec::new(&env);
        for name in outcomes_names.iter() {
            outcomes.push_back(Outcome {
                name,
                total_stake: 0,
            });
        }

        let id = increment_market_count(&env);
        let market = SportMarket {
            id,
            creator: admin,
            event_name,
            outcomes,
            status: MarketStatus::Open,
            resolution_deadline,
            oracle,
            winning_outcome_index: None,
            created_at: env.ledger().timestamp(),
        };

        set_market(&env, &market);
        
        env.events().publish(
            (symbol_short!("market"), symbol_short!("created")),
            id
        );

        Ok(id)
    }

    pub fn place_bet(
        env: Env,
        bettor: Address,
        market_id: u32,
        outcome_index: u32,
        stake: i128,
    ) -> Result<(), Error> {
        ensure_not_paused(&env)?;
        bettor.require_auth();

        if stake <= 0 {
            return Err(Error::ZeroStake);
        }

        let mut market = get_market(&env, market_id)?;

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if env.ledger().timestamp() >= market.resolution_deadline {
            return Err(Error::MarketExpired);
        }
        if outcome_index >= market.outcomes.len() {
            return Err(Error::InvalidOutcome);
        }

        // Update or create bet
        let mut bet = match get_bet(&env, market_id, &bettor) {
            Some(mut b) => {
                if b.outcome_index != outcome_index {
                    return Err(Error::InvalidOutcome); // Cannot change outcome
                }
                b.stake += stake;
                b
            }
            None => Bet {
                market_id,
                bettor: bettor.clone(),
                outcome_index,
                stake,
            },
        };

        // Update outcome total stake
        let mut outcomes = market.outcomes;
        let mut outcome = outcomes.get(outcome_index).unwrap();
        outcome.total_stake += stake;
        outcomes.set(outcome_index, outcome);
        market.outcomes = outcomes;

        set_bet(&env, &bet);
        set_market(&env, &market);

        env.events().publish(
            (symbol_short!("bet"), symbol_short!("placed")),
            (market_id, bettor, outcome_index, stake)
        );

        Ok(())
    }

    pub fn resolve_market(
        env: Env,
        market_id: u32,
        winning_outcome_index: u32,
    ) -> Result<(), Error> {
        let mut market = get_market(&env, market_id)?;
        market.oracle.require_auth();

        if market.status != MarketStatus::Open {
            return Err(Error::MarketAlreadyResolved);
        }
        if winning_outcome_index >= market.outcomes.len() {
            return Err(Error::InvalidOutcome);
        }

        market.status = MarketStatus::Resolved;
        market.winning_outcome_index = Some(winning_outcome_index);
        set_market(&env, &market);

        env.events().publish(
            (symbol_short!("market"), symbol_short!("resolved")),
            (market_id, winning_outcome_index)
        );

        Ok(())
    }

    pub fn set_pause(env: Env, paused: bool) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_paused(&env, paused);
        Ok(())
    }

    // Queries
    pub fn get_market(env: Env, id: u32) -> Result<SportMarket, Error> {
        get_market(&env, id)
    }

    pub fn get_bet(env: Env, market_id: u32, bettor: Address) -> Result<Bet, Error> {
        get_bet(&env, market_id, &bettor).ok_or(Error::PositionNotFound)
    }
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::Paused);
    }
    Ok(())
}
