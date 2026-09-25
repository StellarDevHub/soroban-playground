// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype};

#[contracttype]
pub enum DataKey {
    Admin,
    AnswerHash,
    MaxGuesses,
    GuessCount,
    Solved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameResult {
    Correct,
    Wrong { guesses_left: u32 },
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AlreadySolved = 4,
    NoGuessesRemaining = 5,
    InvalidMaxGuesses = 6,
}
