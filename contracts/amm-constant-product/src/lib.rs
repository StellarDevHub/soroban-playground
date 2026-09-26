#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

const DEAD_SHARES: i128 = 1000;

#[contract]
pub struct AMMConstantProduct;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    InsufficientLiquidity = 3,
    SlippageExceeded = 4,
    InvalidAmount = 5,
    DeadSharesProtection = 6,
}

#[contractimpl]
impl AMMConstantProduct {
    /// Initialize the AMM pool with initial liquidity
    pub fn initialize(
        env: Env,
        admin: Address,
        token_a_amount: i128,
        token_b_amount: i128,
        fee_bps: u32,
    ) -> Result<i128, Error> {
        admin.require_auth();

        if token_a_amount <= 0 || token_b_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        if fee_bps > 10000 {
            return Err(Error::InvalidAmount);
        }

        // Store pool state
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &admin);

        env.storage()
            .instance()
            .set(&symbol_short!("tokenA"), &token_a_amount);

        env.storage()
            .instance()
            .set(&symbol_short!("tokenB"), &token_b_amount);

        env.storage()
            .instance()
            .set(&symbol_short!("feeBps"), &fee_bps);

        // Calculate initial LP shares: sqrt(x * y) - DEAD_SHARES
        let product = token_a_amount.checked_mul(token_b_amount)
            .ok_or(Error::InvalidAmount)?;

        let initial_shares = sqrt_u128(product as u128) as i128;
        if initial_shares <= DEAD_SHARES {
            return Err(Error::DeadSharesProtection);
        }

        let lp_shares = initial_shares - DEAD_SHARES;

        env.storage()
            .instance()
            .set(&symbol_short!("totalShares"), &lp_shares);

        // Mint dead shares to burn address
        env.storage()
            .instance()
            .set(&symbol_short!("deadShares"), &DEAD_SHARES);

        env.events().publish(
            (symbol_short!("init"),),
            (admin, token_a_amount, token_b_amount, lp_shares),
        );

        Ok(lp_shares)
    }

    /// Swap token_a for token_b with slippage protection
    pub fn swap_a_for_b(
        env: Env,
        user: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> Result<i128, Error> {
        user.require_auth();

        if amount_in <= 0 || min_amount_out < 0 {
            return Err(Error::InvalidAmount);
        }

        let token_a: i128 = env.storage()
            .instance()
            .get(&symbol_short!("tokenA"))
            .unwrap_or(0);

        let token_b: i128 = env.storage()
            .instance()
            .get(&symbol_short!("tokenB"))
            .unwrap_or(0);

        let fee_bps: u32 = env.storage()
            .instance()
            .get(&symbol_short!("feeBps"))
            .unwrap_or(0);

        if token_a == 0 || token_b == 0 {
            return Err(Error::InsufficientLiquidity);
        }

        // Calculate fee: amount_in * fee_bps / 10000
        let fee = (amount_in * fee_bps as i128) / 10000;
        let amount_in_after_fee = amount_in - fee;

        // Constant product formula: (x + amount_in) * (y - amount_out) = x * y
        // amount_out = y - (x*y) / (x + amount_in)
        let invariant = token_a * token_b;
        let new_token_a = token_a + amount_in_after_fee;

        let amount_out = token_b - (invariant / new_token_a);

        if amount_out < min_amount_out {
            return Err(Error::SlippageExceeded);
        }

        if amount_out <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Update pool state
        env.storage()
            .instance()
            .set(&symbol_short!("tokenA"), &new_token_a);

        env.storage()
            .instance()
            .set(&symbol_short!("tokenB"), &(token_b - amount_out));

        env.events().publish(
            (symbol_short!("swap"),),
            (user, amount_in, amount_out, fee),
        );

        Ok(amount_out)
    }

    /// Swap token_b for token_a with slippage protection
    pub fn swap_b_for_a(
        env: Env,
        user: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> Result<i128, Error> {
        user.require_auth();

        if amount_in <= 0 || min_amount_out < 0 {
            return Err(Error::InvalidAmount);
        }

        let token_a: i128 = env.storage()
            .instance()
            .get(&symbol_short!("tokenA"))
            .unwrap_or(0);

        let token_b: i128 = env.storage()
            .instance()
            .get(&symbol_short!("tokenB"))
            .unwrap_or(0);

        let fee_bps: u32 = env.storage()
            .instance()
            .get(&symbol_short!("feeBps"))
            .unwrap_or(0);

        if token_a == 0 || token_b == 0 {
            return Err(Error::InsufficientLiquidity);
        }

        // Calculate fee
        let fee = (amount_in * fee_bps as i128) / 10000;
        let amount_in_after_fee = amount_in - fee;

        // Constant product: (x - amount_out) * (y + amount_in) = x * y
        let invariant = token_a * token_b;
        let new_token_b = token_b + amount_in_after_fee;

        let amount_out = token_a - (invariant / new_token_b);

        if amount_out < min_amount_out {
            return Err(Error::SlippageExceeded);
        }

        if amount_out <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Update pool state
        env.storage()
            .instance()
            .set(&symbol_short!("tokenA"), &(token_a - amount_out));

        env.storage()
            .instance()
            .set(&symbol_short!("tokenB"), &new_token_b);

        env.events().publish(
            (symbol_short!("swap"),),
            (user, amount_in, amount_out, fee),
        );

        Ok(amount_out)
    }

    /// Get current pool balances
    pub fn get_reserves(env: Env) -> Result<(i128, i128), Error> {
        let token_a: i128 = env.storage()
            .instance()
            .get(&symbol_short!("tokenA"))
            .unwrap_or(0);

        let token_b: i128 = env.storage()
            .instance()
            .get(&symbol_short!("tokenB"))
            .unwrap_or(0);

        Ok((token_a, token_b))
    }

    /// Get total LP shares
    pub fn get_total_shares(env: Env) -> Result<i128, Error> {
        Ok(env.storage()
            .instance()
            .get(&symbol_short!("totalShares"))
            .unwrap_or(0))
    }

    /// Get current fee (basis points)
    pub fn get_fee(env: Env) -> Result<u32, Error> {
        Ok(env.storage()
            .instance()
            .get(&symbol_short!("feeBps"))
            .unwrap_or(0))
    }
}

/// Calculate integer square root using Newton's method
fn sqrt_u128(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }

    let mut x = n;
    let mut y = (x + 1) / 2;

    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }

    x
}
