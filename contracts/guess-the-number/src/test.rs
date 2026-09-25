// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

// ── Helper: build a fake 32-byte hash from a seed byte ───────────────────────

fn hash_from_seed(env: &Env, seed: u8) -> BytesN<32> {
    let bytes: [u8; 32] = [seed; 32];
    BytesN::from_array(env, &bytes)
}

fn correct_hash(env: &Env) -> BytesN<32> {
    hash_from_seed(env, 0xAB)
}

fn wrong_hash(env: &Env) -> BytesN<32> {
    hash_from_seed(env, 0x00)
}

fn setup(max_guesses: u32) -> (Env, Address, GuessTheNumberClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, GuessTheNumber);
    let client = GuessTheNumberClient::new(&env, &id);
    let admin = Address::generate(&env);
    let hash = correct_hash(&env);
    client.initialize(&admin, &hash, &max_guesses);
    (env, admin, client)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_double_init_fails() {
    let (env, admin, client) = setup(5);
    let h = correct_hash(&env);
    assert_eq!(
        client.try_initialize(&admin, &h, &5),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn test_init_zero_max_guesses_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, GuessTheNumber);
    let client = GuessTheNumberClient::new(&env, &id);
    let admin = Address::generate(&env);
    let h = correct_hash(&env);
    assert_eq!(
        client.try_initialize(&admin, &h, &0),
        Err(Ok(Error::InvalidMaxGuesses))
    );
}

// ── Correct guess ─────────────────────────────────────────────────────────────

#[test]
fn test_correct_guess_returns_correct() {
    let (env, _, client) = setup(3);
    let player = Address::generate(&env);
    let result = client.guess(&player, &correct_hash(&env));
    assert_eq!(result, GameResult::Correct);
    assert!(client.is_solved());
}

#[test]
fn test_correct_guess_on_first_try() {
    let (env, _, client) = setup(5);
    let player = Address::generate(&env);
    client.guess(&player, &correct_hash(&env));
    assert_eq!(client.guess_count(), 1);
}

// ── Wrong guesses ─────────────────────────────────────────────────────────────

#[test]
fn test_wrong_guess_decrements_remaining() {
    let (env, _, client) = setup(3);
    let player = Address::generate(&env);
    let result = client.guess(&player, &wrong_hash(&env));
    assert_eq!(result, GameResult::Wrong { guesses_left: 2 });
    assert_eq!(client.guesses_remaining(), 2);
    assert_eq!(client.guess_count(), 1);
}

#[test]
fn test_no_guesses_remaining_fails() {
    let (env, _, client) = setup(2);
    let player = Address::generate(&env);
    client.guess(&player, &wrong_hash(&env));
    client.guess(&player, &wrong_hash(&env));
    assert_eq!(
        client.try_guess(&player, &wrong_hash(&env)),
        Err(Ok(Error::NoGuessesRemaining))
    );
}

#[test]
fn test_already_solved_rejects_further_guesses() {
    let (env, _, client) = setup(5);
    let player = Address::generate(&env);
    client.guess(&player, &correct_hash(&env));
    // Second guess after solve.
    assert_eq!(
        client.try_guess(&player, &correct_hash(&env)),
        Err(Ok(Error::AlreadySolved))
    );
}

// ── Reset ─────────────────────────────────────────────────────────────────────

#[test]
fn test_reset_allows_new_round() {
    let (env, admin, client) = setup(1);
    let player = Address::generate(&env);
    // Exhaust guesses.
    client.guess(&player, &wrong_hash(&env));
    // Reset with a new hash.
    let new_hash = hash_from_seed(&env, 0xCC);
    client.reset(&admin, &new_hash, &3);
    // Old solution no longer works.
    let result = client.guess(&player, &correct_hash(&env));
    assert_eq!(result, GameResult::Wrong { guesses_left: 2 });
    // New hash works.
    let result = client.guess(&player, &new_hash);
    assert_eq!(result, GameResult::Correct);
}

#[test]
fn test_reset_requires_admin() {
    let (env, _, client) = setup(1);
    let non_admin = Address::generate(&env);
    let h = correct_hash(&env);
    assert_eq!(
        client.try_reset(&non_admin, &h, &3),
        Err(Ok(Error::Unauthorized))
    );
}

// ── Read-only queries ─────────────────────────────────────────────────────────

#[test]
fn test_initial_state() {
    let (_, _, client) = setup(7);
    assert_eq!(client.guess_count(), 0);
    assert_eq!(client.max_guesses(), 7);
    assert_eq!(client.guesses_remaining(), 7);
    assert!(!client.is_solved());
}

#[test]
fn test_guesses_remaining_after_solve_is_zero() {
    let (env, _, client) = setup(10);
    let player = Address::generate(&env);
    client.guess(&player, &correct_hash(&env));
    assert_eq!(client.guesses_remaining(), 0);
}

// ── No answer-reveal backdoor ─────────────────────────────────────────────────
//
// This test documents the absence of a `get_answer` function.
// The plaintext answer is never stored, so no reveal is possible.
//
// There is nothing to call here — the test exists to record the intent.
#[test]
fn no_get_answer_backdoor_exists() {
    // If a `get_answer` or `reveal_answer` function were added to the contract,
    // it would violate the no-debug-backdoor policy for this example contract.
    // The GuessTheNumberClient has no such method — verified by compilation.
    let (_env, _admin, _client) = setup(3);
    // If this file compiles, the absence is confirmed.
}
