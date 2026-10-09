// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Guess the Number — Example/Reference Contract
//!
//! > **This is a reference/example contract.** It is intended purely for
//! > learning Soroban basics and is NOT included in any production deployment.
//! > See `contracts/guess-the-number/README.md` for details.
//!
//! ## How it works
//!
//! 1. An admin initialises the game and commits a **hashed answer** (the
//!    SHA-256 hash of the secret number as a 32-byte value).  The secret itself
//!    is never stored on-chain.
//! 2. A player calls `guess(number)`.  The contract hashes the candidate using
//!    the same scheme and compares it to the stored hash.
//! 3. If the hashes match the guess is correct.  If not, the guess count
//!    increments and the player may try again.
//!
//! ## Security note — commit-reveal scheme
//!
//! Storing only the hash (not the plaintext answer) prevents trivial on-chain
//! inspection of the answer.  A determined adversary can still brute-force a
//! small integer range offline, so this contract is **not suitable for
//! high-stakes games** — it is a teaching example only.
//!
//! ## No debug backdoors
//!
//! This contract intentionally does **not** expose any `get_answer`,
//! `reveal_answer`, or similar function.  The answer is never stored in
//! plaintext; the commit is only the hash.

#![no_std]

mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env};

use crate::types::{DataKey, Error, GameResult};

#[contract]
pub struct GuessTheNumber;

#[contractimpl]
impl GuessTheNumber {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the game.
    ///
    /// `answer_hash` must be the SHA-256 hash of the secret number serialised
    /// as a big-endian u64 byte string (8 bytes).  The admin is responsible for
    /// computing the hash off-chain before calling this function.
    ///
    /// The game can only be initialised once; call `reset` to start a new round.
    pub fn initialize(
        env: Env,
        admin: Address,
        answer_hash: BytesN<32>,
        max_guesses: u32,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if max_guesses == 0 {
            return Err(Error::InvalidMaxGuesses);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AnswerHash, &answer_hash);
        env.storage()
            .instance()
            .set(&DataKey::MaxGuesses, &max_guesses);
        env.storage().instance().set(&DataKey::GuessCount, &0u32);
        env.storage().instance().set(&DataKey::Solved, &false);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Submit a guess.  Returns whether the guess is correct.
    ///
    /// The caller supplies the pre-image (`candidate_hash`) — i.e. the
    /// SHA-256 hash they computed off-chain for their guessed number — which
    /// the contract compares to the stored `answer_hash`.
    ///
    /// By comparing hashes rather than plaintext the contract avoids ever
    /// revealing the plaintext answer.
    pub fn guess(
        env: Env,
        player: Address,
        candidate_hash: BytesN<32>,
    ) -> Result<GameResult, Error> {
        require_initialized(&env)?;
        player.require_auth();

        let solved: bool = env
            .storage()
            .instance()
            .get(&DataKey::Solved)
            .unwrap_or(false);
        if solved {
            return Err(Error::AlreadySolved);
        }

        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxGuesses)
            .unwrap_or(0);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::GuessCount)
            .unwrap_or(0);

        if count >= max {
            return Err(Error::NoGuessesRemaining);
        }

        let new_count = count + 1;
        env.storage()
            .instance()
            .set(&DataKey::GuessCount, &new_count);

        let answer_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::AnswerHash)
            .ok_or(Error::NotInitialized)?;

        if candidate_hash == answer_hash {
            env.storage().instance().set(&DataKey::Solved, &true);
            env.events()
                .publish((symbol_short!("solved"),), (player, new_count));
            Ok(GameResult::Correct)
        } else {
            let guesses_left = max - new_count;
            env.events()
                .publish((symbol_short!("wrong"),), (player, guesses_left));
            Ok(GameResult::Wrong { guesses_left })
        }
    }

    /// Reset the game for a new round. Admin only.
    pub fn reset(
        env: Env,
        admin: Address,
        new_answer_hash: BytesN<32>,
        max_guesses: u32,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if max_guesses == 0 {
            return Err(Error::InvalidMaxGuesses);
        }
        env.storage()
            .instance()
            .set(&DataKey::AnswerHash, &new_answer_hash);
        env.storage()
            .instance()
            .set(&DataKey::MaxGuesses, &max_guesses);
        env.storage().instance().set(&DataKey::GuessCount, &0u32);
        env.storage().instance().set(&DataKey::Solved, &false);
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    /// Returns the number of guesses used so far.
    pub fn guess_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::GuessCount)
            .unwrap_or(0)
    }

    /// Returns the maximum allowed guesses.
    pub fn max_guesses(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxGuesses)
            .unwrap_or(0)
    }

    /// Returns whether the game has been solved.
    pub fn is_solved(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Solved)
            .unwrap_or(false)
    }

    /// Returns remaining guesses (0 if exhausted or already solved).
    pub fn guesses_remaining(env: Env) -> u32 {
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxGuesses)
            .unwrap_or(0);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::GuessCount)
            .unwrap_or(0);
        let solved: bool = env
            .storage()
            .instance()
            .get(&DataKey::Solved)
            .unwrap_or(false);
        if solved {
            0
        } else {
            max.saturating_sub(count)
        }
    }

    // NOTE: There is intentionally NO `get_answer` or `reveal_answer` function.
    // The plaintext answer is never stored on-chain; only its hash is committed.
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    if admin != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
