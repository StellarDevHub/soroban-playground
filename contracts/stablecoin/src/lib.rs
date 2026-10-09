#![cfg_attr(not(test), no_std)]

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// # Algorithmic Stablecoin — Collateral Peg Stability Module (PSM)
//
// Extends the base algorithmic stablecoin with a 1:1 Peg Stability Module that
// allows users to swap USDC/USDT reserve assets for the stablecoin and vice
// versa at near-parity.
//
// ## PSM mechanics
//
// * `psm_mint`  — deposit `amount` units of reserve; receive `amount - mint_fee`
//               stablecoins.  Reserves are locked in the PSM vault.
// * `psm_redeem`— burn `amount` stablecoins; receive `amount - redeem_fee`
//               reserve units from the vault.
// * Fees are expressed in basis points (1 bps = 0.01 %).
// * The PSM has a configurable debt ceiling; minting is rejected once reached.
// * The PSM can be individually paused without pausing the broader contract.
// * Fee revenue accumulates in `PsmFeeVault` and can be collected by admin.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, Env, Symbol,
};

mod flash_mint;
pub use flash_mint::{FlashMintConfig, FlashMintDataKey};

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    ContractPaused = 2,
    AlreadyInState = 3,
    NotInitialized = 4,
    InvalidAmount = 5,
    InsufficientBalance = 6,
    PriceStale = 7,
    RebaseTooFrequent = 8,
    // PSM-specific errors (9+)
    PsmPaused = 9,
    PsmDebtCeilingExceeded = 10,
    PsmInsufficientReserve = 11,
    InvalidFeeBps = 12,
    InvalidDebtCeiling = 13,
    // Flash Mint errors (14+)
    FlashMintPaused = 14,
    FlashMintGlobalDebtCeilingExceeded = 15,
    FlashMintTxDebtCeilingExceeded = 16,
    FlashMintReentrancyDetected = 17,
    FlashMintRepaymentFailed = 18,
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Base stablecoin keys
    Admin,
    TargetPrice,
    CurrentPrice,
    TotalSupply,
    ShareSupply,
    UserTokens(Address),
    Paused,
    LastRebaseTime,
    ReserveBalance,
    OracleAddress,
    RebaseCooldown,
    // PSM keys
    PsmPaused,
    PsmMintFeeBps,
    PsmRedeemFeeBps,
    PsmDebtCeiling,
    PsmMintedDebt,
    PsmVaultBalance,
    PsmFeeVault,
}

// ─── Structs ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RebaseInfo {
    pub old_supply: i128,
    pub new_supply: i128,
    pub price: i128,
    pub timestamp: u64,
}

/// Returned by `psm_mint` and `psm_redeem`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PsmSwapResult {
    /// Gross amount provided by the caller.
    pub amount_in: i128,
    /// Net amount credited to the caller after fee deduction.
    pub amount_out: i128,
    /// Fee charged (in units of the output asset).
    pub fee_collected: i128,
    /// Updated PSM vault balance after the swap.
    pub vault_balance: i128,
    /// Updated outstanding PSM debt (total stablecoins minted through PSM).
    pub minted_debt: i128,
}

/// PSM configuration snapshot — returned by `psm_config`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PsmConfig {
    pub paused: bool,
    pub mint_fee_bps: u32,
    pub redeem_fee_bps: u32,
    pub debt_ceiling: i128,
    pub minted_debt: i128,
    pub vault_balance: i128,
    pub fee_vault: i128,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AlgorithmicStablecoin;

#[contractimpl]
impl AlgorithmicStablecoin {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the stablecoin contract with PSM defaults.
    ///
    /// `psm_mint_fee_bps`   — fee charged on PSM mint (default 10 = 0.10 %)
    /// `psm_redeem_fee_bps` — fee charged on PSM redeem (default 10 = 0.10 %)
    /// `psm_debt_ceiling`   — max stablecoins that may be minted through PSM
    pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInState);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &oracle);
        env.storage()
            .instance()
            .set(&DataKey::TargetPrice, &10_000_000i128);
        env.storage()
            .instance()
            .set(&DataKey::CurrentPrice, &10_000_000i128);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::ShareSupply, &1_000_000_000i128);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::LastRebaseTime, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::ReserveBalance, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::RebaseCooldown, &3600u64);

        // PSM defaults
        env.storage().instance().set(&DataKey::PsmPaused, &false);
        env.storage()
            .instance()
            .set(&DataKey::PsmMintFeeBps, &10u32); // 0.10 %
        env.storage()
            .instance()
            .set(&DataKey::PsmRedeemFeeBps, &10u32); // 0.10 %
        env.storage()
            .instance()
            .set(&DataKey::PsmDebtCeiling, &1_000_000_000_000i128); // 1 M tokens (7 decimals)
        env.storage()
            .instance()
            .set(&DataKey::PsmMintedDebt, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::PsmVaultBalance, &0i128);
        env.storage().instance().set(&DataKey::PsmFeeVault, &0i128);

        env.events()
            .publish((Symbol::new(&env, "initialized"),), (admin, oracle));

        Ok(())
    }

    // ── PSM: Peg Stability Module ─────────────────────────────────────────────

    /// Configure PSM parameters.  Admin-only.
    ///
    /// * `mint_fee_bps`    — basis points charged on PSM mints (0–500)
    /// * `redeem_fee_bps`  — basis points charged on PSM redeems (0–500)
    /// * `debt_ceiling`    — max outstanding PSM debt (> 0)
    pub fn psm_set_params(
        env: Env,
        admin: Address,
        mint_fee_bps: u32,
        redeem_fee_bps: u32,
        debt_ceiling: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if mint_fee_bps > 500 || redeem_fee_bps > 500 {
            return Err(Error::InvalidFeeBps);
        }
        if debt_ceiling <= 0 {
            return Err(Error::InvalidDebtCeiling);
        }

        env.storage()
            .instance()
            .set(&DataKey::PsmMintFeeBps, &mint_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::PsmRedeemFeeBps, &redeem_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::PsmDebtCeiling, &debt_ceiling);

        env.events().publish(
            (Symbol::new(&env, "psm_params"),),
            (mint_fee_bps, redeem_fee_bps, debt_ceiling),
        );

        Ok(())
    }

    /// Pause / unpause only the PSM (base contract unaffected).  Admin-only.
    pub fn psm_set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::PsmPaused, &paused);

        env.events()
            .publish((Symbol::new(&env, "psm_pause"),), paused);

        Ok(())
    }

    /// **PSM Mint** — deposit `amount` reserve units, receive stablecoins.
    ///
    /// The caller provides reserve asset (USDC / USDT) off-chain or via a
    /// separate token contract; this contract tracks the vault balance on-chain
    /// and credits the caller's stablecoin balance accordingly.
    ///
    /// Fee = `amount × mint_fee_bps / 10_000` (rounded down, minimum 0).
    /// Tokens received = `amount - fee`.
    pub fn psm_mint(env: Env, user: Address, amount: i128) -> Result<PsmSwapResult, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_psm_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let debt_ceiling: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmDebtCeiling)
            .unwrap_or(0);
        let minted_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmMintedDebt)
            .unwrap_or(0);
        let mint_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PsmMintFeeBps)
            .unwrap_or(10);

        let fee_collected = amount * i128::from(mint_fee_bps) / 10_000;
        let amount_out = amount - fee_collected;

        if minted_debt + amount_out > debt_ceiling {
            return Err(Error::PsmDebtCeilingExceeded);
        }

        // Update vault — reserve comes in
        let vault_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmVaultBalance)
            .unwrap_or(0);
        let new_vault = vault_balance + amount;
        env.storage()
            .instance()
            .set(&DataKey::PsmVaultBalance, &new_vault);

        // Update fee vault
        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::PsmFeeVault, &(fee_vault + fee_collected));

        // Mint stablecoins to user
        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(user.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::UserTokens(user.clone()),
            &(user_balance + amount_out),
        );

        // Update total supply and PSM debt
        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total_supply + amount_out));

        let new_minted_debt = minted_debt + amount_out;
        env.storage()
            .instance()
            .set(&DataKey::PsmMintedDebt, &new_minted_debt);

        let result = PsmSwapResult {
            amount_in: amount,
            amount_out,
            fee_collected,
            vault_balance: new_vault,
            minted_debt: new_minted_debt,
        };

        env.events()
            .publish((Symbol::new(&env, "psm_mint"),), (user, result.clone()));

        Ok(result)
    }

    /// **PSM Redeem** — burn `amount` stablecoins, receive reserve units.
    ///
    /// Fee = `amount × redeem_fee_bps / 10_000`.
    /// Reserve received = `amount - fee`.
    pub fn psm_redeem(env: Env, user: Address, amount: i128) -> Result<PsmSwapResult, Error> {
        user.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_psm_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let redeem_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PsmRedeemFeeBps)
            .unwrap_or(10);

        let fee_collected = amount * i128::from(redeem_fee_bps) / 10_000;
        let amount_out = amount - fee_collected;

        // Check vault solvency
        let vault_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmVaultBalance)
            .unwrap_or(0);
        if vault_balance < amount_out {
            return Err(Error::PsmInsufficientReserve);
        }

        // Burn stablecoins from user
        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(user.clone()))
            .unwrap_or(0);
        if user_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(user.clone()), &(user_balance - amount));

        // Update total supply and PSM debt
        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total_supply - amount));

        let minted_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmMintedDebt)
            .unwrap_or(0);
        let new_minted_debt = if minted_debt > amount {
            minted_debt - amount
        } else {
            0
        };
        env.storage()
            .instance()
            .set(&DataKey::PsmMintedDebt, &new_minted_debt);

        // Deduct reserve from vault; accrue fee
        let new_vault = vault_balance - amount_out;
        env.storage()
            .instance()
            .set(&DataKey::PsmVaultBalance, &new_vault);

        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::PsmFeeVault, &(fee_vault + fee_collected));

        let result = PsmSwapResult {
            amount_in: amount,
            amount_out,
            fee_collected,
            vault_balance: new_vault,
            minted_debt: new_minted_debt,
        };

        env.events()
            .publish((Symbol::new(&env, "psm_redeem"),), (user, result.clone()));

        Ok(result)
    }

    /// Collect accumulated PSM fee revenue.  Admin-only.
    ///
    /// Returns the amount collected and resets the fee vault to zero.
    pub fn psm_collect_fees(env: Env, admin: Address) -> Result<i128, Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        let fee_vault: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PsmFeeVault)
            .unwrap_or(0);

        env.storage().instance().set(&DataKey::PsmFeeVault, &0i128);

        env.events().publish(
            (Symbol::new(&env, "psm_fees_collected"),),
            (admin, fee_vault),
        );

        Ok(fee_vault)
    }

    /// Read the current PSM configuration and balances.
    pub fn psm_config(env: Env) -> PsmConfig {
        PsmConfig {
            paused: env
                .storage()
                .instance()
                .get(&DataKey::PsmPaused)
                .unwrap_or(false),
            mint_fee_bps: env
                .storage()
                .instance()
                .get(&DataKey::PsmMintFeeBps)
                .unwrap_or(10),
            redeem_fee_bps: env
                .storage()
                .instance()
                .get(&DataKey::PsmRedeemFeeBps)
                .unwrap_or(10),
            debt_ceiling: env
                .storage()
                .instance()
                .get(&DataKey::PsmDebtCeiling)
                .unwrap_or(0),
            minted_debt: env
                .storage()
                .instance()
                .get(&DataKey::PsmMintedDebt)
                .unwrap_or(0),
            vault_balance: env
                .storage()
                .instance()
                .get(&DataKey::PsmVaultBalance)
                .unwrap_or(0),
            fee_vault: env
                .storage()
                .instance()
                .get(&DataKey::PsmFeeVault)
                .unwrap_or(0),
        }
    }

    // ── Base stablecoin functions (unchanged from v1) ─────────────────────────

    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(to.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::UserTokens(to.clone()),
            &(current_balance + amount),
        );

        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total_supply + amount));

        env.events()
            .publish((Symbol::new(&env, "mint"),), (to, amount));

        Ok(())
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(from.clone()))
            .unwrap_or(0);
        if current_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage().persistent().set(
            &DataKey::UserTokens(from.clone()),
            &(current_balance - amount),
        );

        let total_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total_supply - amount));

        env.events()
            .publish((Symbol::new(&env, "burn"),), (from, amount));

        Ok(())
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let from_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let to_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserTokens(to.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(from.clone()), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&DataKey::UserTokens(to.clone()), &(to_balance + amount));

        env.events()
            .publish((Symbol::new(&env, "transfer"),), (from, to, amount));

        Ok(())
    }

    pub fn set_price(env: Env, oracle: Address, new_price: i128) -> Result<(), Error> {
        oracle.require_auth();
        Self::assert_oracle(&env, &oracle)?;

        if new_price <= 0 {
            return Err(Error::InvalidAmount);
        }

        env.storage()
            .instance()
            .set(&DataKey::CurrentPrice, &new_price);

        env.events().publish(
            (Symbol::new(&env, "price_updated"),),
            (oracle, new_price, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn rebase(env: Env, caller: Address) -> Result<RebaseInfo, Error> {
        caller.require_auth();
        Self::assert_not_paused(&env)?;

        let last_rebase: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LastRebaseTime)
            .unwrap_or(0);
        let cooldown: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RebaseCooldown)
            .unwrap_or(3600);
        let current_time = env.ledger().timestamp();

        if current_time < last_rebase + cooldown {
            return Err(Error::RebaseTooFrequent);
        }

        let current_price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPrice)
            .unwrap();
        let target_price: i128 = env.storage().instance().get(&DataKey::TargetPrice).unwrap();
        let old_supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        let new_supply = if current_price > target_price {
            let expansion_ratio = (current_price - target_price) * 1_000_000 / target_price;
            let expansion_amount = old_supply * expansion_ratio / 1_000_000;
            old_supply + expansion_amount
        } else if current_price < target_price {
            let contraction_ratio = (target_price - current_price) * 1_000_000 / target_price;
            let max_contraction = old_supply * contraction_ratio / 1_000_000;
            let reserve: i128 = env
                .storage()
                .instance()
                .get(&DataKey::ReserveBalance)
                .unwrap_or(0);
            let actual_contraction = if max_contraction > reserve {
                reserve
            } else {
                max_contraction
            };
            old_supply - actual_contraction
        } else {
            old_supply
        };

        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);
        env.storage()
            .instance()
            .set(&DataKey::LastRebaseTime, &current_time);

        let info = RebaseInfo {
            old_supply,
            new_supply,
            price: current_price,
            timestamp: current_time,
        };

        env.events()
            .publish((Symbol::new(&env, "rebase"),), info.clone());

        Ok(info)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if Self::is_paused(env.clone()) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((Symbol::new(&env, "paused"),), admin);

        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if !Self::is_paused(env.clone()) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((Symbol::new(&env, "unpaused"),), admin);

        Ok(())
    }

    pub fn add_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::ReserveBalance, &(current_reserve + amount));

        env.events()
            .publish((Symbol::new(&env, "reserve_added"),), (admin, amount));

        Ok(())
    }

    pub fn withdraw_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_reserve: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0);
        if current_reserve < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage()
            .instance()
            .set(&DataKey::ReserveBalance, &(current_reserve - amount));

        env.events()
            .publish((Symbol::new(&env, "reserve_withdrawn"),), (admin, amount));

        Ok(())
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UserTokens(user))
            .unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn get_price(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CurrentPrice)
            .unwrap_or(10_000_000)
    }

    pub fn get_target_price(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TargetPrice)
            .unwrap_or(10_000_000)
    }

    pub fn get_reserve(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ReserveBalance)
            .unwrap_or(0)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if &admin != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_oracle(env: &Env, caller: &Address) -> Result<(), Error> {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .ok_or(Error::NotInitialized)?;

        if &oracle != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if Self::is_paused(env.clone()) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_psm_not_paused(env: &Env) -> Result<(), Error> {
        let psm_paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::PsmPaused)
            .unwrap_or(false);
        if psm_paused {
            return Err(Error::PsmPaused);
        }
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env,
    };

    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        AlgorithmicStablecoinClient<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AlgorithmicStablecoin);
        let client = AlgorithmicStablecoinClient::new(&env, &id);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let user = Address::generate(&env);

        client.init(&admin, &oracle);

        let env = std::boxed::Box::leak(std::boxed::Box::new(env));
        let client = AlgorithmicStablecoinClient::new(env, &id);

        (env.clone(), admin, oracle, user, client)
    }

    // ── Existing tests ────────────────────────────────────────────────────────

    #[test]
    fn test_init() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AlgorithmicStablecoin);
        let client = AlgorithmicStablecoinClient::new(&env, &id);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);

        client.init(&admin, &oracle);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_price(), 10_000_000);
        assert_eq!(client.get_target_price(), 10_000_000);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_mint() {
        let (env, admin, _oracle, user, client) = setup();
        client.mint(&admin, &user, &1000);
        assert_eq!(client.balance(&user), 1000);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_burn() {
        let (env, admin, _oracle, user, client) = setup();
        client.mint(&admin, &user, &1000);
        client.burn(&user, &500);
        assert_eq!(client.balance(&user), 500);
        assert_eq!(client.total_supply(), 500);
    }

    #[test]
    fn test_transfer() {
        let (env, admin, _oracle, user, client) = setup();
        let recipient = Address::generate(&env);
        client.mint(&admin, &user, &1000);
        client.transfer(&user, &recipient, &300);
        assert_eq!(client.balance(&user), 700);
        assert_eq!(client.balance(&recipient), 300);
    }

    #[test]
    fn test_set_price() {
        let (_env, _admin, oracle, _user, client) = setup();
        client.set_price(&oracle, &12_000_000);
        assert_eq!(client.get_price(), 12_000_000);
    }

    #[test]
    fn test_rebase_expansion() {
        let (env, admin, oracle, _user, client) = setup();
        client.mint(&admin, &admin, &1_000_000);
        client.set_price(&oracle, &11_000_000);
        env.ledger().set_timestamp(4000);
        let info = client.rebase(&admin);
        assert!(info.new_supply > info.old_supply);
    }

    #[test]
    fn test_pause_and_unpause() {
        let (_env, admin, _oracle, user, client) = setup();
        client.pause(&admin);
        assert!(client.is_paused());

        let result = client.try_mint(&admin, &user, &100);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));

        client.unpause(&admin);
        assert!(!client.is_paused());
        client.mint(&admin, &user, &100);
        assert_eq!(client.balance(&user), 100);
    }

    #[test]
    fn test_reserve_operations() {
        let (_env, admin, _oracle, _user, client) = setup();
        client.add_reserve(&admin, &5000);
        assert_eq!(client.get_reserve(), 5000);
        client.withdraw_reserve(&admin, &2000);
        assert_eq!(client.get_reserve(), 3000);
    }

    // ── PSM tests ─────────────────────────────────────────────────────────────

    #[test]
    fn test_psm_defaults_after_init() {
        let (_env, _admin, _oracle, _user, client) = setup();
        let cfg = client.psm_config();
        assert!(!cfg.paused);
        assert_eq!(cfg.mint_fee_bps, 10);
        assert_eq!(cfg.redeem_fee_bps, 10);
        assert_eq!(cfg.minted_debt, 0);
        assert_eq!(cfg.vault_balance, 0);
        assert_eq!(cfg.fee_vault, 0);
    }

    #[test]
    fn test_psm_mint_basic() {
        let (_env, _admin, _oracle, user, client) = setup();

        // Deposit 10_000 reserve units; expect fee = 10_000 * 10 / 10_000 = 10
        let result = client.psm_mint(&user, &10_000);

        assert_eq!(result.amount_in, 10_000);
        assert_eq!(result.fee_collected, 10); // 0.10 %
        assert_eq!(result.amount_out, 9_990);
        assert_eq!(result.vault_balance, 10_000);
        assert_eq!(result.minted_debt, 9_990);

        // User received 9_990 stablecoins
        assert_eq!(client.balance(&user), 9_990);
        assert_eq!(client.total_supply(), 9_990);
    }

    #[test]
    fn test_psm_redeem_basic() {
        let (_env, _admin, _oracle, user, client) = setup();

        // First mint through PSM
        client.psm_mint(&user, &10_000);

        // Redeem all 9_990 stablecoins
        let result = client.psm_redeem(&user, &9_990);

        // fee = 9_990 * 10 / 10_000 = 9 (floor)
        assert_eq!(result.fee_collected, 9);
        assert_eq!(result.amount_out, 9_981); // 9_990 - 9
                                              // vault: was 10_000, released 9_981 → 19 remaining
        assert_eq!(result.vault_balance, 10_000 - 9_981);
        assert_eq!(client.balance(&user), 0);
    }

    #[test]
    fn test_psm_fee_vault_accumulates() {
        let (_env, admin, _oracle, user, client) = setup();

        client.psm_mint(&user, &10_000); // fee = 10
        client.psm_redeem(&user, &9_990); // fee = 9

        let cfg = client.psm_config();
        assert_eq!(cfg.fee_vault, 10 + 9);

        // Admin collects fees
        let collected = client.psm_collect_fees(&admin);
        assert_eq!(collected, 19);
        let cfg2 = client.psm_config();
        assert_eq!(cfg2.fee_vault, 0);
    }

    #[test]
    fn test_psm_debt_ceiling_enforced() {
        let (_env, admin, _oracle, user, client) = setup();

        // Set a tight ceiling of 1_000 tokens
        client.psm_set_params(&admin, &10, &10, &1_000);

        // First mint of 1_001 should fail (amount_out = 1_001 - 1 = 1_000 which still fits)
        let ok = client.try_psm_mint(&user, &1_001);
        // amount_out = 1_001 - (1_001*10/10_000) = 1_001 - 1 = 1_000 → exactly at ceiling → ok
        assert!(ok.is_ok());

        // Second mint of any amount should be rejected (debt == ceiling)
        let err = client.try_psm_mint(&user, &1);
        assert_eq!(err, Err(Ok(Error::PsmDebtCeilingExceeded)));
    }

    #[test]
    fn test_psm_paused_prevents_swaps() {
        let (_env, admin, _oracle, user, client) = setup();

        client.psm_set_paused(&admin, &true);

        let mint_err = client.try_psm_mint(&user, &100);
        assert_eq!(mint_err, Err(Ok(Error::PsmPaused)));

        // Give user some tokens via admin mint, then try PSM redeem
        client.mint(&admin, &user, &100);
        let redeem_err = client.try_psm_redeem(&user, &100);
        assert_eq!(redeem_err, Err(Ok(Error::PsmPaused)));
    }

    #[test]
    fn test_psm_insufficient_reserve_on_redeem() {
        let (_env, admin, _oracle, user, client) = setup();

        // Give user stablecoins via admin mint (no vault reserve)
        client.mint(&admin, &user, &500);

        // PSM vault is empty — redeem should fail
        let err = client.try_psm_redeem(&user, &500);
        assert_eq!(err, Err(Ok(Error::PsmInsufficientReserve)));
    }

    #[test]
    fn test_psm_set_params_invalid_fee() {
        let (_env, admin, _oracle, _user, client) = setup();

        // Fee > 500 bps should be rejected
        let err = client.try_psm_set_params(&admin, &501, &10, &1_000_000);
        assert_eq!(err, Err(Ok(Error::InvalidFeeBps)));
    }

    #[test]
    fn test_psm_set_params_invalid_ceiling() {
        let (_env, admin, _oracle, _user, client) = setup();

        let err = client.try_psm_set_params(&admin, &10, &10, &0);
        assert_eq!(err, Err(Ok(Error::InvalidDebtCeiling)));
    }
}
