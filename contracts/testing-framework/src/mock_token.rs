// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Env, String, Symbol,
};

const ZERO_ADDRESS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Errors returned by the mock token contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TokenError {
    NegativeMint = 1,
    NegativeBurn = 2,
    InsufficientBalance = 3,
    MintToZeroAddress = 4,
    BurnFromZeroAddress = 5,
    NegativeTransfer = 6,
    TransferFromZeroAddress = 7,
    TransferToZeroAddress = 8,
    InsufficientTransferBalance = 9,
}

/// A deployable SEP-41 compatible mock token contract for testing.
///
/// Provides mint, burn, balance, and transfer operations that validate
/// pre-conditions and panic with descriptive messages when invariants
/// are violated.
///
/// # Quick Start
///
/// ```ignore
/// use soroban_sdk::{testutils::Address as _, Address, Env};
/// use testing_framework::mock_token::{MockToken, MockTokenClient};
///
/// let env = Env::default();
/// env.mock_all_auths();
/// let contract_id = env.register_contract(None, MockToken);
/// let token = MockTokenClient::new(&env, &contract_id);
///
/// let alice = Address::generate(&env);
/// token.mint(&alice, &1000);
/// assert_eq!(token.balance(&alice), 1000);
/// ```
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    /// Returns the name of the token (for SEP-41 compatibility).
    pub fn name(env: Env) -> String {
        String::from_str(&env, "MockToken")
    }

    /// Returns the symbol of the token (for SEP-41 compatibility).
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "MCK")
    }

    /// Returns the number of decimals (fixed at 7 for SEP-41 compatibility).
    pub fn decimals(env: Env) -> u32 {
        7
    }

    /// Returns the balance of `addr`.
    ///
    /// Returns 0 for addresses that have never received tokens.
    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage().instance().get(&addr).unwrap_or(0)
    }

    /// Mints `amount` tokens to `to`.
    ///
    /// # Validation
    ///
    /// - Panics with `"MockToken: negative mint amount: {amount}"` if
    ///   `amount < 0`.
    /// - Panics with `"MockToken: mint to zero address"` if `to` is the
    ///   zero address.
    ///
    /// Emits a `mint` event on success.
    pub fn mint(env: Env, to: Address, amount: i128) {
        if amount < 0 {
            panic!("MockToken: negative mint amount: {}", amount);
        }
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS));
        if to == zero {
            panic!("MockToken: mint to zero address");
        }
        let current = env.storage().instance().get::<_, i128>(&to).unwrap_or(0);
        env.storage().instance().set(&to, &current.saturating_add(amount));
        env.events()
            .publish((symbol_short!("mint"), to), amount);
    }

    /// Burns `amount` tokens from `from`.
    ///
    /// # Validation
    ///
    /// - Panics with `"MockToken: negative burn amount: {amount}"` if
    ///   `amount < 0`.
    /// - Panics with `"MockToken: insufficient balance: {from} has {balance},
    ///   needs {amount}"` if `from` does not have enough tokens.
    ///
    /// Emits a `burn` event on success.
    pub fn burn(env: Env, from: Address, amount: i128) {
        if amount < 0 {
            panic!("MockToken: negative burn amount: {}", amount);
        }
        let current = env.storage().instance().get::<_, i128>(&from).unwrap_or(0);
        if current < amount {
            panic!(
                "MockToken: insufficient balance: {} has {}, needs {}",
                from, current, amount
            );
        }
        env.storage().instance().set(&from, &(current - amount));
        env.events()
            .publish((symbol_short!("burn"), from), amount);
    }

    /// Transfers `amount` tokens from `from` to `to`.
    ///
    /// # Authorisation
    ///
    /// Calls `from.require_auth()` so the sender must authorise the
    /// transfer.
    ///
    /// # Validation
    ///
    /// - Panics with `"MockToken: negative transfer amount: {amount}"`
    ///   if `amount < 0`.
    /// - Panics with `"MockToken: transfer from zero address"` if `from`
    ///   is the zero address.
    /// - Panics with `"MockToken: transfer to zero address"` if `to` is
    ///   the zero address.
    /// - Panics with `"MockToken: insufficient balance: {from} has
    ///   {balance}, needs {amount}"` if `from` has insufficient funds.
    ///
    /// Emits a `transfer` event on success.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        if amount < 0 {
            panic!("MockToken: negative transfer amount: {}", amount);
        }
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS));
        if from == zero {
            panic!("MockToken: transfer from zero address");
        }
        if to == zero {
            panic!("MockToken: transfer to zero address");
        }
        from.require_auth();
        let from_balance = env.storage().instance().get::<_, i128>(&from).unwrap_or(0);
        if from_balance < amount {
            panic!(
                "MockToken: insufficient balance: {} has {}, needs {}",
                from, from_balance, amount
            );
        }
        let to_balance = env.storage().instance().get::<_, i128>(&to).unwrap_or(0);
        env.storage().instance().set(&from, &(from_balance.saturating_sub(amount)));
        env.storage().instance().set(&to, &to_balance.saturating_add(amount));
        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
    }
}
