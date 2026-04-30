#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Bytes, Env};

use crate::storage::{
    get_admin, get_analytics, get_round, get_round_count, get_ticket_buyer, get_ticket_price,
    increment_round_count, is_initialized, is_paused, set_admin, set_analytics, set_paused,
    set_round, set_ticket_buyer, set_ticket_price,
};
use crate::types::{Analytics, Error, Round, RoundStatus};

#[contract]
pub struct Lottery;

#[contractimpl]
impl Lottery {
    /// Initialize the contract. `ticket_price` is in stroops (1 XLM = 10^7 stroops).
    pub fn initialize(env: Env, admin: Address, ticket_price: i128) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if ticket_price <= 0 {
            return Err(Error::InvalidPrice);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_ticket_price(&env, ticket_price);
        set_paused(&env, false);
        set_analytics(
            &env,
            &Analytics {
                total_rounds: 0,
                completed_rounds: 0,
                cancelled_rounds: 0,
                total_tickets_sold: 0,
                total_prize_pool: 0,
                total_prizes_claimed: 0,
            },
        );
        Ok(())
    }

    /// Admin starts a new lottery round. Returns the new round ID.
    pub fn start_round(env: Env, duration_secs: u64) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        if duration_secs == 0 {
            return Err(Error::InvalidDuration);
        }

        let round_id = increment_round_count(&env);
        let now = env.ledger().timestamp();
        let ticket_price = get_ticket_price(&env);

        // Commit seed: sha256(start_timestamp || round_id) — public, verifiable.
        let mut seed_input = Bytes::new(&env);
        seed_input.extend_from_array(&now.to_be_bytes());
        seed_input.extend_from_array(&(round_id as u64).to_be_bytes());
        let committed_seed = env.crypto().sha256(&seed_input).into();

        let round = Round {
            id: round_id,
            status: RoundStatus::Open,
            start_time: now,
            end_time: now + duration_secs,
            ticket_price,
            total_tickets: 0,
            prize_pool: 0,
            winner_ticket_id: None,
            winner: None,
            committed_seed,
            claimed: false,
        };

        set_round(&env, &round);

        let mut analytics = get_analytics(&env);
        analytics.total_rounds += 1;
        set_analytics(&env, &analytics);

        Ok(round_id)
    }

    /// Purchase a ticket for an open lottery round. Returns the assigned ticket ID.
    ///
    /// In production this would transfer `ticket_price` tokens from `buyer`; here
    /// the economic accounting is tracked on-chain and settlement is off-chain.
    pub fn buy_ticket(env: Env, buyer: Address, round_id: u32) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        buyer.require_auth();

        let mut round = get_round(&env, round_id)?;

        if round.status != RoundStatus::Open {
            return Err(Error::RoundNotOpen);
        }
        if env.ledger().timestamp() >= round.end_time {
            return Err(Error::RoundNotOpen);
        }

        round.total_tickets += 1;
        round.prize_pool += round.ticket_price;
        let ticket_id = round.total_tickets;

        set_ticket_buyer(&env, round_id, ticket_id, &buyer);
        set_round(&env, &round);

        let mut analytics = get_analytics(&env);
        analytics.total_tickets_sold += 1;
        analytics.total_prize_pool += round.ticket_price;
        set_analytics(&env, &analytics);

        Ok(ticket_id)
    }

    /// Admin draws the winner for a completed (ended) round using verifiable randomness.
    ///
    /// Randomness derivation (public, auditable):
    ///   entropy = sha256(committed_seed || draw_sequence || draw_timestamp)
    ///   winner_ticket = (first_4_bytes_of_entropy as u32 % total_tickets) + 1
    pub fn draw_winner(env: Env, round_id: u32) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut round = get_round(&env, round_id)?;

        if round.status == RoundStatus::Completed {
            return Err(Error::RoundAlreadyDrawn);
        }
        if round.status == RoundStatus::Cancelled {
            return Err(Error::RoundCancelled);
        }
        if env.ledger().timestamp() < round.end_time {
            return Err(Error::RoundStillOpen);
        }
        if round.total_tickets == 0 {
            return Err(Error::NoTicketsSold);
        }

        // Combine committed seed with draw-time ledger state for unpredictable entropy.
        let draw_seq = env.ledger().sequence();
        let draw_ts = env.ledger().timestamp();

        let mut entropy_input = Bytes::new(&env);
        entropy_input.extend_from_array(&round.committed_seed.to_array());
        entropy_input.extend_from_array(&(draw_seq as u64).to_be_bytes());
        entropy_input.extend_from_array(&draw_ts.to_be_bytes());
        let entropy_hash = env.crypto().sha256(&entropy_input);
        let hash_bytes = entropy_hash.to_array();

        // Extract a u32 from the first 4 bytes and map to a ticket in [1, total_tickets].
        let entropy_u32 = u32::from_be_bytes([hash_bytes[0], hash_bytes[1], hash_bytes[2], hash_bytes[3]]);
        let winner_ticket_id = (entropy_u32 % round.total_tickets) + 1;
        let winner = get_ticket_buyer(&env, round_id, winner_ticket_id)?;

        round.status = RoundStatus::Completed;
        round.winner_ticket_id = Some(winner_ticket_id);
        round.winner = Some(winner.clone());
        set_round(&env, &round);

        let mut analytics = get_analytics(&env);
        analytics.completed_rounds += 1;
        set_analytics(&env, &analytics);

        Ok(winner)
    }

    /// Winner claims the prize pool. Returns the claimable amount.
    pub fn claim_prize(env: Env, round_id: u32, claimant: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        claimant.require_auth();

        let mut round = get_round(&env, round_id)?;

        if round.status != RoundStatus::Completed {
            return Err(Error::RoundNotCompleted);
        }
        if round.claimed {
            return Err(Error::AlreadyClaimed);
        }
        let winner = round.winner.clone().ok_or(Error::RoundNotCompleted)?;
        if winner != claimant {
            return Err(Error::NotWinner);
        }

        round.claimed = true;
        set_round(&env, &round);

        let mut analytics = get_analytics(&env);
        analytics.total_prizes_claimed += round.prize_pool;
        set_analytics(&env, &analytics);

        Ok(round.prize_pool)
    }

    /// Admin cancels an open round (emergency, or to clean up an ended round with no tickets).
    pub fn cancel_round(env: Env, round_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut round = get_round(&env, round_id)?;
        if round.status == RoundStatus::Completed {
            return Err(Error::RoundAlreadyDrawn);
        }
        if round.status == RoundStatus::Cancelled {
            return Err(Error::RoundCancelled);
        }

        round.status = RoundStatus::Cancelled;
        set_round(&env, &round);

        let mut analytics = get_analytics(&env);
        analytics.cancelled_rounds += 1;
        set_analytics(&env, &analytics);

        Ok(())
    }

    /// Admin pauses the contract. Blocks ticket purchases and new rounds.
    pub fn pause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_paused(&env, true);
        Ok(())
    }

    /// Admin unpauses the contract.
    pub fn unpause(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_paused(&env, false);
        Ok(())
    }

    // ── Read-only queries ──────────────────────────────────────────────────────

    pub fn get_round(env: Env, round_id: u32) -> Result<Round, Error> {
        get_round(&env, round_id)
    }

    pub fn get_ticket_buyer(env: Env, round_id: u32, ticket_id: u32) -> Result<Address, Error> {
        get_ticket_buyer(&env, round_id, ticket_id)
    }

    pub fn get_analytics(env: Env) -> Result<Analytics, Error> {
        ensure_initialized(&env)?;
        Ok(get_analytics(&env))
    }

    pub fn get_round_count(env: Env) -> u32 {
        get_round_count(&env)
    }

    pub fn get_ticket_price(env: Env) -> i128 {
        get_ticket_price(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        Err(Error::NotInitialized)
    } else {
        Ok(())
    }
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        Err(Error::ContractPaused)
    } else {
        Ok(())
    }
}
