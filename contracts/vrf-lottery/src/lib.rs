//! # Fair Lottery Protocol with VRF Seed Consumption
//!
//! ## Overview
//! Each lottery round collects ticket purchases within a defined ledger-epoch
//! window.  Randomness is sourced from a commit-reveal / VRF beacon pattern:
//!
//! 1. **Commit phase** – The VRF operator publishes a hash commitment to a
//!    secret seed before ticket sales close.
//! 2. **Reveal phase** – After the epoch ends the operator reveals the seed;
//!    the contract verifies it against the commitment and derives the winning
//!    indices:
//!    ```text
//!    WinnerIndex    = RandomSeed % TotalTickets
//!    RunnerUpIndex  = (RandomSeed / TotalTickets) % TotalTickets
//!    ```
//! 3. **Prize distribution** – 90 % winner, 5 % runner-up, 5 % treasury.
//! 4. **Rollover** – If ticket sales fall below the minimum quorum the prize
//!    pool rolls over to the next round and the round is voided.

#![no_std]

use soroban_sdk::{
    bytes, bytesn, contract, contracterror, contractimpl, contracttype, crypto::Hash,
    symbol_short, token, Address, Bytes, BytesN, Env, Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Ticket price in the collateral token (7-decimal fixed-point).
const TICKET_PRICE: i128 = 10_000_000; // 1 unit
/// Minimum tickets sold before the round is valid (no rollover).
const MIN_QUORUM: u32 = 3;
/// Basis points for prize split.
const BPS: i128 = 10_000;
const WINNER_BPS: i128 = 9_000;   // 90 %
const RUNNER_BPS: i128 = 500;     // 5 %
const TREASURY_BPS: i128 = 500;   // 5 %
/// Minimum number of ledgers a round stays open for ticket purchases.
const MIN_ROUND_LEDGERS: u32 = 20;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    RoundNotOpen = 4,
    RoundAlreadyOpen = 5,
    RoundNotEnded = 6,
    RoundAlreadyRevealed = 7,
    CommitmentMismatch = 8,
    NoTickets = 9,
    AlreadyClaimed = 10,
    NotWinner = 11,
    InvalidAmount = 12,
    Paused = 13,
    CommitAlreadySet = 14,
    CommitNotSet = 15,
    RoundNotFound = 16,
    MinRoundLedgers = 17,
    SeedTooShort = 18,
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RoundStatus {
    Open,       // Accepting ticket purchases
    Committed,  // VRF operator committed a hash, still accepting tickets until end_ledger
    Ended,      // end_ledger passed, awaiting reveal
    Revealed,   // Seed revealed, winners determined
    Rolled,     // Quorum not met – prize rolled to next round
}

#[contracttype]
#[derive(Clone)]
pub struct Round {
    pub id: u32,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub ticket_count: u32,
    pub prize_pool: i128,
    pub status: RoundStatus,
    /// SHA-256 commitment to the VRF seed (32 bytes)
    pub commitment: BytesN<32>,
    /// Revealed seed (32 bytes, zeroed until reveal)
    pub seed: BytesN<32>,
    pub winner_index: u32,
    pub runner_up_index: u32,
    pub rolled_over: i128,  // amount rolled in from previous round
}

#[contracttype]
#[derive(Clone)]
pub struct State {
    pub admin: Address,
    pub treasury: Address,
    pub ticket_token: Address, // token used to buy tickets
    pub current_round: u32,
    pub paused: bool,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    State,
    Round(u32),
    /// Tickets owned by a buyer in a specific round: (round_id, buyer) -> Vec<u32>
    Tickets(u32, Address),
    /// Whether a winner/runner-up has claimed in a round
    Claimed(u32, u32), // (round_id, ticket_index)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct VrfLottery;

#[contractimpl]
impl VrfLottery {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialize the contract. Must be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
        ticket_token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let state = State {
            admin,
            treasury,
            ticket_token,
            current_round: 0,
            paused: false,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("init"),), ());
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();
        state.paused = true;
        env.storage().instance().set(&DataKey::State, &state);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();
        state.paused = false;
        env.storage().instance().set(&DataKey::State, &state);
        Ok(())
    }

    // ── Round Management ──────────────────────────────────────────────────────

    /// Start a new lottery round.  `duration_ledgers` must be >= MIN_ROUND_LEDGERS.
    pub fn start_round(
        env: Env,
        admin: Address,
        duration_ledgers: u32,
    ) -> Result<u32, Error> {
        let mut state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();
        Self::assert_not_paused(&state)?;

        if duration_ledgers < MIN_ROUND_LEDGERS {
            return Err(Error::MinRoundLedgers);
        }

        // Ensure no currently-open round exists
        if state.current_round > 0 {
            let prev: Round = env
                .storage()
                .instance()
                .get(&DataKey::Round(state.current_round))
                .ok_or(Error::RoundNotFound)?;
            if prev.status == RoundStatus::Open || prev.status == RoundStatus::Committed {
                return Err(Error::RoundAlreadyOpen);
            }
        }

        // Carry over any rolled prize pool
        let rolled_over = if state.current_round > 0 {
            let prev: Round = env
                .storage()
                .instance()
                .get(&DataKey::Round(state.current_round))
                .unwrap();
            if prev.status == RoundStatus::Rolled {
                prev.prize_pool
            } else {
                0
            }
        } else {
            0
        };

        state.current_round += 1;
        let new_id = state.current_round;
        let start = env.ledger().sequence();

        let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
        let round = Round {
            id: new_id,
            start_ledger: start,
            end_ledger: start + duration_ledgers,
            ticket_count: 0,
            prize_pool: rolled_over,
            status: RoundStatus::Open,
            commitment: zero_bytes.clone(),
            seed: zero_bytes,
            winner_index: 0,
            runner_up_index: 0,
            rolled_over,
        };

        env.storage()
            .instance()
            .set(&DataKey::Round(new_id), &round);
        env.storage().instance().set(&DataKey::State, &state);

        env.events()
            .publish((symbol_short!("rnd_start"),), (new_id, start, start + duration_ledgers));
        Ok(new_id)
    }

    // ── Ticket Purchases ──────────────────────────────────────────────────────

    /// Purchase `count` tickets in the current open round.
    pub fn buy_tickets(
        env: Env,
        buyer: Address,
        count: u32,
    ) -> Result<Vec<u32>, Error> {
        let state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        buyer.require_auth();

        if count == 0 {
            return Err(Error::InvalidAmount);
        }

        let round_id = state.current_round;
        let mut round: Round = env
            .storage()
            .instance()
            .get(&DataKey::Round(round_id))
            .ok_or(Error::RoundNotFound)?;

        if round.status != RoundStatus::Open && round.status != RoundStatus::Committed {
            return Err(Error::RoundNotOpen);
        }
        if env.ledger().sequence() > round.end_ledger {
            return Err(Error::RoundNotOpen);
        }

        let cost = TICKET_PRICE.checked_mul(count as i128).unwrap_or(i128::MAX);
        let tok = token::Client::new(&env, &state.ticket_token);
        tok.transfer(&buyer, &env.current_contract_address(), &cost);

        let start_index = round.ticket_count;
        let mut indices = Vec::new(&env);
        for i in 0..count {
            indices.push_back(start_index + i);
        }

        round.ticket_count += count;
        round.prize_pool += cost;

        let ticket_key = DataKey::Tickets(round_id, buyer.clone());
        let mut existing: Vec<u32> = env
            .storage()
            .instance()
            .get(&ticket_key)
            .unwrap_or_else(|| Vec::new(&env));
        for i in 0..indices.len() {
            existing.push_back(indices.get(i).unwrap());
        }
        env.storage().instance().set(&ticket_key, &existing);
        env.storage()
            .instance()
            .set(&DataKey::Round(round_id), &round);

        env.events()
            .publish((symbol_short!("tickets"),), (buyer, round_id, count, start_index));
        Ok(indices)
    }

    // ── Commit-Reveal ─────────────────────────────────────────────────────────

    /// VRF operator commits a SHA-256 hash of the secret seed.
    /// Must happen before the round's end_ledger.
    pub fn commit_seed(
        env: Env,
        operator: Address,
        round_id: u32,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::require_admin(&state, &operator);
        operator.require_auth();

        let mut round: Round = env
            .storage()
            .instance()
            .get(&DataKey::Round(round_id))
            .ok_or(Error::RoundNotFound)?;

        if round.status != RoundStatus::Open {
            return Err(Error::RoundNotOpen);
        }

        let zero_check = BytesN::from_array(&env, &[0u8; 32]);
        if round.commitment != zero_check {
            return Err(Error::CommitAlreadySet);
        }

        round.commitment = commitment.clone();
        round.status = RoundStatus::Committed;
        env.storage()
            .instance()
            .set(&DataKey::Round(round_id), &round);

        env.events()
            .publish((symbol_short!("committed"),), (round_id, commitment));
        Ok(())
    }

    /// Reveal the seed after the round's end_ledger has passed.
    /// The contract verifies SHA-256(seed) == commitment, then selects winners.
    pub fn reveal_seed(
        env: Env,
        operator: Address,
        round_id: u32,
        seed: BytesN<32>,
    ) -> Result<(u32, u32), Error> {
        let state = Self::load_state(&env)?;
        Self::require_admin(&state, &operator);
        operator.require_auth();

        let mut round: Round = env
            .storage()
            .instance()
            .get(&DataKey::Round(round_id))
            .ok_or(Error::RoundNotFound)?;

        if round.status != RoundStatus::Committed {
            return Err(Error::CommitNotSet);
        }
        if env.ledger().sequence() <= round.end_ledger {
            return Err(Error::RoundNotEnded);
        }

        // Verify commitment: SHA-256(seed) == commitment
        let seed_bytes: Bytes = seed.clone().into();
        let hash: BytesN<32> = env.crypto().sha256(&seed_bytes);
        if hash != round.commitment {
            return Err(Error::CommitmentMismatch);
        }

        // Check quorum
        if round.ticket_count < MIN_QUORUM {
            round.status = RoundStatus::Rolled;
            env.storage()
                .instance()
                .set(&DataKey::Round(round_id), &round);
            env.events()
                .publish((symbol_short!("rolled"),), (round_id, round.prize_pool));
            return Ok((0, 0));
        }

        // Derive winner indices from seed bytes
        let seed_arr = seed.to_array();
        let random_u64 = u64::from_be_bytes([
            seed_arr[0], seed_arr[1], seed_arr[2], seed_arr[3],
            seed_arr[4], seed_arr[5], seed_arr[6], seed_arr[7],
        ]);
        let total = round.ticket_count as u64;
        let winner_index = (random_u64 % total) as u32;
        let secondary = random_u64.wrapping_div(total).wrapping_add(random_u64 >> 32);
        let runner_up_index = if total > 1 {
            let r = (secondary % (total - 1)) as u32;
            if r >= winner_index { r + 1 } else { r }
        } else {
            winner_index
        };

        round.seed = seed.clone();
        round.winner_index = winner_index;
        round.runner_up_index = runner_up_index;
        round.status = RoundStatus::Revealed;

        env.storage()
            .instance()
            .set(&DataKey::Round(round_id), &round);

        env.events().publish(
            (symbol_short!("revealed"),),
            (round_id, winner_index, runner_up_index),
        );
        Ok((winner_index, runner_up_index))
    }

    // ── Prize Claims ──────────────────────────────────────────────────────────

    /// Claim the winner prize for a specific ticket index.
    pub fn claim_prize(
        env: Env,
        claimant: Address,
        round_id: u32,
        ticket_index: u32,
    ) -> Result<i128, Error> {
        let state = Self::load_state(&env)?;
        claimant.require_auth();

        let round: Round = env
            .storage()
            .instance()
            .get(&DataKey::Round(round_id))
            .ok_or(Error::RoundNotFound)?;

        if round.status != RoundStatus::Revealed {
            return Err(Error::RoundNotEnded);
        }

        // Verify claimant owns this ticket
        let tickets: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::Tickets(round_id, claimant.clone()))
            .ok_or(Error::NotWinner)?;

        let mut owns = false;
        for i in 0..tickets.len() {
            if tickets.get(i).unwrap() == ticket_index {
                owns = true;
                break;
            }
        }
        if !owns {
            return Err(Error::NotWinner);
        }

        // Determine payout
        let is_winner = ticket_index == round.winner_index;
        let is_runner = ticket_index == round.runner_up_index;
        if !is_winner && !is_runner {
            return Err(Error::NotWinner);
        }

        let claim_key = DataKey::Claimed(round_id, ticket_index);
        if env.storage().instance().has(&claim_key) {
            return Err(Error::AlreadyClaimed);
        }
        env.storage().instance().set(&claim_key, &true);

        let payout = if is_winner {
            round.prize_pool * WINNER_BPS / BPS
        } else {
            round.prize_pool * RUNNER_BPS / BPS
        };

        let tok = token::Client::new(&env, &state.ticket_token);
        tok.transfer(&env.current_contract_address(), &claimant, &payout);

        // If winner also triggers treasury transfer (5% to treasury, done once)
        if is_winner {
            let treasury_payout = round.prize_pool * TREASURY_BPS / BPS;
            tok.transfer(
                &env.current_contract_address(),
                &state.treasury,
                &treasury_payout,
            );
        }

        env.events()
            .publish((symbol_short!("claimed"),), (claimant, round_id, ticket_index, payout));
        Ok(payout)
    }

    // ── View Functions ────────────────────────────────────────────────────────

    pub fn get_round(env: Env, round_id: u32) -> Result<Round, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Round(round_id))
            .ok_or(Error::RoundNotFound)
    }

    pub fn get_current_round_id(env: Env) -> Result<u32, Error> {
        let state = Self::load_state(&env)?;
        Ok(state.current_round)
    }

    pub fn get_tickets(env: Env, round_id: u32, buyer: Address) -> Vec<u32> {
        env.storage()
            .instance()
            .get(&DataKey::Tickets(round_id, buyer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn load_state(env: &Env) -> Result<State, Error> {
        env.storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(Error::NotInitialized)
    }

    fn require_admin(state: &State, caller: &Address) {
        if &state.admin != caller {
            panic!("unauthorized");
        }
    }

    fn assert_not_paused(state: &State) -> Result<(), Error> {
        if state.paused {
            Err(Error::Paused)
        } else {
            Ok(())
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, BytesN, Env,
    };

    fn setup() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let buyer = Address::generate(&env);

        let tok_id = env.register_stellar_asset_contract_v2(admin.clone());
        let tok_addr = tok_id.address();

        let contract_id = env.register(VrfLottery, ());
        let client = VrfLotteryClient::new(&env, &contract_id);
        client.initialize(&admin, &treasury, &tok_addr);

        // Fund buyer
        StellarAssetClient::new(&env, &tok_addr).mint(&buyer, &1_000_000_000);

        (env, contract_id, admin, treasury, buyer)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, _admin, _treasury, _buyer) = setup();
        let client = VrfLotteryClient::new(&env, &contract_id);
        let round_id = client.get_current_round_id();
        assert_eq!(round_id, 0);
    }

    #[test]
    fn test_start_round_and_buy_tickets() {
        let (env, contract_id, admin, _treasury, buyer) = setup();
        let client = VrfLotteryClient::new(&env, &contract_id);

        let round_id = client.start_round(&admin, &MIN_ROUND_LEDGERS);
        assert_eq!(round_id, 1);

        let tickets = client.buy_tickets(&buyer, &3);
        assert_eq!(tickets.len(), 3);
        assert_eq!(tickets.get(0).unwrap(), 0);
        assert_eq!(tickets.get(1).unwrap(), 1);
        assert_eq!(tickets.get(2).unwrap(), 2);

        let round = client.get_round(&1);
        assert_eq!(round.ticket_count, 3);
    }

    #[test]
    fn test_commit_reveal_and_claim() {
        let (env, contract_id, admin, _treasury, buyer) = setup();
        let client = VrfLotteryClient::new(&env, &contract_id);

        client.start_round(&admin, &MIN_ROUND_LEDGERS);

        // Buy enough tickets to meet quorum
        client.buy_tickets(&buyer, &MIN_QUORUM);

        // Build a deterministic seed
        let seed_arr = [1u8; 32];
        let seed: BytesN<32> = BytesN::from_array(&env, &seed_arr);

        // Commit hash of seed
        let seed_bytes: Bytes = seed.clone().into();
        let commitment: BytesN<32> = env.crypto().sha256(&seed_bytes);
        client.commit_seed(&admin, &1, &commitment);

        // Advance ledger past end_ledger
        env.ledger().with_mut(|l| {
            l.sequence_number += MIN_ROUND_LEDGERS + 1;
        });

        let (winner, _runner) = client.reveal_seed(&admin, &1, &seed);
        // With 3 tickets winner must be 0, 1, or 2
        assert!(winner < MIN_QUORUM);

        // The buyer owns all tickets so they are the winner
        let payout = client.claim_prize(&buyer, &1, &winner);
        assert!(payout > 0);
    }

    #[test]
    fn test_rollover_on_insufficient_quorum() {
        let (env, contract_id, admin, _treasury, buyer) = setup();
        let client = VrfLotteryClient::new(&env, &contract_id);

        client.start_round(&admin, &MIN_ROUND_LEDGERS);
        // Buy only 1 ticket (below quorum of 3)
        client.buy_tickets(&buyer, &1);

        let seed_arr = [2u8; 32];
        let seed: BytesN<32> = BytesN::from_array(&env, &seed_arr);
        let seed_bytes: Bytes = seed.clone().into();
        let commitment: BytesN<32> = env.crypto().sha256(&seed_bytes);
        client.commit_seed(&admin, &1, &commitment);

        env.ledger().with_mut(|l| {
            l.sequence_number += MIN_ROUND_LEDGERS + 1;
        });

        let (w, r) = client.reveal_seed(&admin, &1, &seed);
        assert_eq!(w, 0);
        assert_eq!(r, 0);

        let round = client.get_round(&1);
        // Should be rolled
        assert_eq!(round.status, RoundStatus::Rolled);
    }
}
