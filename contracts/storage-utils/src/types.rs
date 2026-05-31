// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    KeyNotFound = 1,
    IndexOutOfBounds = 2,
    QueueEmpty = 3,
    StackEmpty = 4,
    Overflow = 5,
}
