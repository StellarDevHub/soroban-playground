//! # Multi-Asset Portfolio Rebalancer with Automated Index Tracking
//!
//! ## Overview
//! Holds a weighted basket of tokens (e.g. 50 % XLM, 30 % BTC, 20 % ETH) and
//! issues **sINDEX** share tokens that represent a proportional claim on the
//! underlying basket.
//!
//! - **Mint** – deposit underlying assets in proportion to the current weights;
//!   receive sINDEX shares.
//! - **Redeem** – burn sINDEX shares; receive pro-rata underlying basket assets.
//! - **Rebalance** – when any asset's current weight drifts more than
//!   `drift_tolerance_bps` from its target, the admin triggers rebalancing by
//!   submitting the corrective trade amounts with slippage limits.
//!
//! Sandwich-attack protection: a per-block rebalance delay ensures that no two
//! rebalance calls land in the same ledger.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Basis points denominator (100 % = 10 000 bps)
const BPS: u64 = 10_000;
/// Minimum ledgers between consecutive rebalance operations (sandwich protection)
const REBALANCE_COOLDOWN: u32 = 3;
/// Maximum number of assets in the portfolio
const MAX_ASSETS: u32 = 10;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidWeights = 4,    // weights do not sum to BPS
    AssetNotFound = 5,
    AssetAlreadyExists = 6,
    InsufficientShares = 7,
    ZeroAmount = 8,
    DriftBelowTolerance = 9,
    SlippageExceeded = 10,
    RebalanceCooldown = 11,
    PriceMissing = 12,
    TooManyAssets = 13,
    Paused = 14,
    InvalidAssetCount = 15,
}

// ─── Types ────────────────────────────────────────────────────────────────────

/// Configuration for one basket asset.
#[contracttype]
#[derive(Clone)]
pub struct AssetConfig {
    /// SAC / token contract address
    pub token: Address,
    /// Target weight in basis-points (must collectively sum to BPS)
    pub target_weight_bps: u64,
    /// Total amount of this token held by the contract
    pub reserve: i128,
}

/// Global state
#[contracttype]
#[derive(Clone)]
pub struct State {
    pub admin: Address,
    /// Total sINDEX shares outstanding
    pub total_shares: i128,
    /// Drift tolerance: rebalance triggered when weight deviation > this (bps)
    pub drift_tolerance_bps: u64,
    /// Ledger of the last rebalance (sandwich protection)
    pub last_rebalance_ledger: u32,
    pub paused: bool,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    State,
    /// Vec<Address> of registered token addresses (ordered)
    AssetList,
    /// AssetConfig keyed by token address
    Asset(Address),
    /// Oracle USD price (7 dp) for a token
    Price(Address),
    /// sINDEX share balance per holder
    Shares(Address),
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct PortfolioIndex;

#[contractimpl]
impl PortfolioIndex {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialize the portfolio contract.
    ///
    /// `drift_tolerance_bps` – maximum allowed weight deviation before
    /// rebalancing is required (e.g. 300 = 3 %).
    pub fn initialize(
        env: Env,
        admin: Address,
        drift_tolerance_bps: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let state = State {
            admin,
            total_shares: 0,
            drift_tolerance_bps,
            last_rebalance_ledger: 0,
            paused: false,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.storage()
            .instance()
            .set(&DataKey::AssetList, &Vec::<Address>::new(&env));

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

    // ── Asset Registration ────────────────────────────────────────────────────

    /// Register a new basket asset with its target weight.
    ///
    /// After adding/updating assets, total weights across all registered assets
    /// must sum to exactly BPS (10 000).  Call `verify_weights` to check.
    pub fn add_asset(
        env: Env,
        admin: Address,
        token: Address,
        target_weight_bps: u64,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();

        let key = DataKey::Asset(token.clone());
        if env.storage().instance().has(&key) {
            return Err(Error::AssetAlreadyExists);
        }

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AssetList)
            .unwrap_or_else(|| Vec::new(&env));

        if list.len() >= MAX_ASSETS {
            return Err(Error::TooManyAssets);
        }

        list.push_back(token.clone());
        env.storage().instance().set(&DataKey::AssetList, &list);

        let config = AssetConfig {
            token: token.clone(),
            target_weight_bps,
            reserve: 0,
        };
        env.storage().instance().set(&key, &config);

        env.events()
            .publish((symbol_short!("asset_add"),), (token, target_weight_bps));
        Ok(())
    }

    /// Update the target weight of an existing asset.
    pub fn set_weight(
        env: Env,
        admin: Address,
        token: Address,
        target_weight_bps: u64,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();

        let key = DataKey::Asset(token.clone());
        let mut cfg: AssetConfig = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::AssetNotFound)?;

        cfg.target_weight_bps = target_weight_bps;
        env.storage().instance().set(&key, &cfg);
        Ok(())
    }

    /// Verify that target weights sum to exactly BPS.  Returns total sum.
    pub fn verify_weights(env: Env) -> Result<u64, Error> {
        let list = Self::asset_list(&env);
        let sum = Self::sum_weights(&env, &list);
        if sum != BPS {
            return Err(Error::InvalidWeights);
        }
        Ok(sum)
    }

    // ── Oracle ────────────────────────────────────────────────────────────────

    /// Submit a USD price (7 decimal places) for a basket asset.
    /// In production this would be gated to a registered oracle address.
    pub fn update_price(
        env: Env,
        admin: Address,
        token: Address,
        price_usd_7dp: i128,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();

        if price_usd_7dp <= 0 {
            return Err(Error::ZeroAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::Price(token.clone()), &price_usd_7dp);
        env.events()
            .publish((symbol_short!("price"),), (token, price_usd_7dp));
        Ok(())
    }

    // ── Index Token Minting ───────────────────────────────────────────────────

    /// Mint sINDEX shares by depositing underlying basket tokens.
    ///
    /// The caller must transfer `amounts[i]` of each asset proportional to the
    /// current reserves (or target weights for the first mint).
    /// Returns the number of sINDEX shares minted.
    pub fn mint(
        env: Env,
        depositor: Address,
        amounts: Vec<i128>,
    ) -> Result<i128, Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        depositor.require_auth();

        let list = Self::asset_list(&env);
        if amounts.len() != list.len() {
            return Err(Error::InvalidAssetCount);
        }
        if list.len() == 0 {
            return Err(Error::AssetNotFound);
        }

        // Determine shares to issue.
        // If this is the first mint, use the USD value of deposits as the share base.
        // Otherwise, shares are proportional to the smallest ratio deposit/reserve.
        let shares = if state.total_shares == 0 {
            // First mint: shares = total USD value deposited (7dp scaled)
            let mut usd_total: i128 = 0;
            for i in 0..list.len() {
                let token = list.get(i).unwrap();
                let amt = amounts.get(i).unwrap();
                if amt <= 0 {
                    return Err(Error::ZeroAmount);
                }
                let price = Self::get_price(&env, &token)?;
                usd_total += amt.checked_mul(price).unwrap_or(i128::MAX) / 10_000_000;
            }
            usd_total
        } else {
            // Proportional mint: ratio = min(amount[i] / reserve[i]) for all i
            // shares = ratio * total_shares  (multiply by BPS to avoid fractions)
            let mut min_ratio_bps: u64 = u64::MAX;
            for i in 0..list.len() {
                let token = list.get(i).unwrap();
                let cfg: AssetConfig = env
                    .storage()
                    .instance()
                    .get(&DataKey::Asset(token))
                    .ok_or(Error::AssetNotFound)?;
                if cfg.reserve == 0 {
                    continue;
                }
                let amt = amounts.get(i).unwrap();
                if amt <= 0 {
                    return Err(Error::ZeroAmount);
                }
                let ratio_bps = ((amt as u128 * BPS as u128) / cfg.reserve as u128) as u64;
                if ratio_bps < min_ratio_bps {
                    min_ratio_bps = ratio_bps;
                }
            }
            if min_ratio_bps == u64::MAX {
                return Err(Error::ZeroAmount);
            }
            (state.total_shares as u128 * min_ratio_bps as u128 / BPS as u128) as i128
        };

        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }

        // Transfer assets from depositor and update reserves
        for i in 0..list.len() {
            let token = list.get(i).unwrap();
            let amt = amounts.get(i).unwrap();
            if amt <= 0 {
                return Err(Error::ZeroAmount);
            }
            let tok_client = token::Client::new(&env, &token);
            tok_client.transfer(&depositor, &env.current_contract_address(), &amt);

            let mut cfg: AssetConfig = env
                .storage()
                .instance()
                .get(&DataKey::Asset(token.clone()))
                .ok_or(Error::AssetNotFound)?;
            cfg.reserve = cfg.reserve.saturating_add(amt);
            env.storage()
                .instance()
                .set(&DataKey::Asset(token), &cfg);
        }

        // Mint sINDEX shares
        let share_key = DataKey::Shares(depositor.clone());
        let existing: i128 = env
            .storage()
            .instance()
            .get(&share_key)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&share_key, &(existing + shares));

        state.total_shares = state.total_shares.saturating_add(shares);
        env.storage().instance().set(&DataKey::State, &state);

        env.events()
            .publish((symbol_short!("minted"),), (depositor, shares));
        Ok(shares)
    }

    // ── Index Token Redemption ────────────────────────────────────────────────

    /// Redeem `shares` sINDEX tokens for the proportional underlying basket.
    ///
    /// Returns a `Vec<i128>` of amounts received (one per asset in order).
    pub fn redeem(
        env: Env,
        redeemer: Address,
        shares: i128,
    ) -> Result<Vec<i128>, Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        redeemer.require_auth();

        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }
        if state.total_shares == 0 {
            return Err(Error::ZeroAmount);
        }

        let share_key = DataKey::Shares(redeemer.clone());
        let owned: i128 = env
            .storage()
            .instance()
            .get(&share_key)
            .unwrap_or(0);
        if owned < shares {
            return Err(Error::InsufficientShares);
        }

        let list = Self::asset_list(&env);
        let mut out_amounts = Vec::new(&env);

        for i in 0..list.len() {
            let token = list.get(i).unwrap();
            let mut cfg: AssetConfig = env
                .storage()
                .instance()
                .get(&DataKey::Asset(token.clone()))
                .ok_or(Error::AssetNotFound)?;

            // proportional redemption: amount = reserve * shares / total_shares
            let out = (cfg.reserve as u128 * shares as u128 / state.total_shares as u128) as i128;
            if out > 0 {
                let tok_client = token::Client::new(&env, &token);
                tok_client.transfer(&env.current_contract_address(), &redeemer, &out);
                cfg.reserve = cfg.reserve.saturating_sub(out);
                env.storage()
                    .instance()
                    .set(&DataKey::Asset(token), &cfg);
            }
            out_amounts.push_back(out);
        }

        // Burn shares
        env.storage()
            .instance()
            .set(&share_key, &(owned - shares));
        state.total_shares = state.total_shares.saturating_sub(shares);
        env.storage().instance().set(&DataKey::State, &state);

        env.events()
            .publish((symbol_short!("redeemed"),), (redeemer, shares));
        Ok(out_amounts)
    }

    // ── Drift Detection ───────────────────────────────────────────────────────

    /// Compute the current weight deviation (in bps) for each asset.
    ///
    /// Returns a `Vec<i128>` of signed deviations
    /// (positive = overweight, negative = underweight).
    pub fn compute_drift(env: Env) -> Result<Vec<i128>, Error> {
        let list = Self::asset_list(&env);
        let total_usd = Self::total_portfolio_usd(&env, &list)?;

        let mut drifts = Vec::new(&env);

        for i in 0..list.len() {
            let token = list.get(i).unwrap();
            let cfg: AssetConfig = env
                .storage()
                .instance()
                .get(&DataKey::Asset(token.clone()))
                .ok_or(Error::AssetNotFound)?;
            let price = Self::get_price(&env, &token)?;
            let asset_usd = cfg
                .reserve
                .checked_mul(price)
                .unwrap_or(i128::MAX)
                / 10_000_000;
            let current_weight_bps = if total_usd == 0 {
                0i128
            } else {
                (asset_usd as i128 * BPS as i128) / total_usd as i128
            };
            let deviation = current_weight_bps - cfg.target_weight_bps as i128;
            drifts.push_back(deviation);
        }
        Ok(drifts)
    }

    // ── Rebalancing ───────────────────────────────────────────────────────────

    /// Execute a rebalancing operation.
    ///
    /// `sell_amounts[i]` tokens to sell and `buy_amounts[i]` tokens to receive
    /// per asset.  The caller (admin/rebalancer) specifies slippage-protected
    /// minimum receive amounts in `min_buy_amounts`.
    ///
    /// Reverts if:
    /// - no asset's drift exceeds `drift_tolerance_bps`
    /// - a swap would produce fewer tokens than `min_buy_amounts[i]`
    /// - called too soon after the previous rebalance (sandwich protection)
    pub fn rebalance(
        env: Env,
        admin: Address,
        sell_token: Address,
        buy_token: Address,
        sell_amount: i128,
        min_buy_amount: i128,
    ) -> Result<i128, Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        Self::require_admin(&state, &admin);
        admin.require_auth();

        // Sandwich protection: must wait REBALANCE_COOLDOWN ledgers
        let current = env.ledger().sequence();
        if current < state.last_rebalance_ledger + REBALANCE_COOLDOWN {
            return Err(Error::RebalanceCooldown);
        }

        // Verify drift threshold is exceeded for the sell asset
        let list = Self::asset_list(&env);
        let total_usd = Self::total_portfolio_usd(&env, &list)?;

        let sell_cfg: AssetConfig = env
            .storage()
            .instance()
            .get(&DataKey::Asset(sell_token.clone()))
            .ok_or(Error::AssetNotFound)?;
        let sell_price = Self::get_price(&env, &sell_token)?;
        let sell_usd = sell_cfg
            .reserve
            .checked_mul(sell_price)
            .unwrap_or(i128::MAX)
            / 10_000_000;
        let sell_weight_bps = if total_usd == 0 {
            0u64
        } else {
            ((sell_usd as u128 * BPS as u128) / total_usd as u128) as u64
        };

        let sell_drift = if sell_weight_bps > sell_cfg.target_weight_bps {
            sell_weight_bps - sell_cfg.target_weight_bps
        } else {
            sell_cfg.target_weight_bps - sell_weight_bps
        };

        if sell_drift <= state.drift_tolerance_bps {
            return Err(Error::DriftBelowTolerance);
        }

        // Calculate buy_amount via oracle prices (zero-slippage internal swap)
        let buy_price = Self::get_price(&env, &buy_token)?;
        let sell_usd_value = sell_amount
            .checked_mul(sell_price)
            .unwrap_or(i128::MAX)
            / 10_000_000;
        let buy_amount = sell_usd_value
            .checked_mul(10_000_000)
            .unwrap_or(i128::MAX)
            / buy_price;

        // Slippage protection
        if buy_amount < min_buy_amount {
            return Err(Error::SlippageExceeded);
        }

        // Update reserves
        let mut sell_cfg_mut: AssetConfig = env
            .storage()
            .instance()
            .get(&DataKey::Asset(sell_token.clone()))
            .ok_or(Error::AssetNotFound)?;
        sell_cfg_mut.reserve = sell_cfg_mut.reserve.saturating_sub(sell_amount);
        env.storage()
            .instance()
            .set(&DataKey::Asset(sell_token.clone()), &sell_cfg_mut);

        let mut buy_cfg: AssetConfig = env
            .storage()
            .instance()
            .get(&DataKey::Asset(buy_token.clone()))
            .ok_or(Error::AssetNotFound)?;
        buy_cfg.reserve = buy_cfg.reserve.saturating_add(buy_amount);
        env.storage()
            .instance()
            .set(&DataKey::Asset(buy_token.clone()), &buy_cfg);

        // Update cooldown ledger
        state.last_rebalance_ledger = current;
        env.storage().instance().set(&DataKey::State, &state);

        env.events().publish(
            (symbol_short!("rebalance"),),
            (sell_token, buy_token, sell_amount, buy_amount),
        );
        Ok(buy_amount)
    }

    // ── View Functions ────────────────────────────────────────────────────────

    pub fn get_shares(env: Env, holder: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Shares(holder))
            .unwrap_or(0)
    }

    pub fn get_total_shares(env: Env) -> Result<i128, Error> {
        Ok(Self::load_state(&env)?.total_shares)
    }

    pub fn get_asset(env: Env, token: Address) -> Result<AssetConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Asset(token))
            .ok_or(Error::AssetNotFound)
    }

    pub fn list_assets(env: Env) -> Vec<Address> {
        Self::asset_list(&env)
    }

    pub fn get_price_view(env: Env, token: Address) -> Result<i128, Error> {
        Self::get_price(&env, &token)
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fn load_state(env: &Env) -> Result<State, Error> {
        env.storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(Error::NotInitialized)
    }

    fn asset_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AssetList)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn get_price(env: &Env, token: &Address) -> Result<i128, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Price(token.clone()))
            .ok_or(Error::PriceMissing)
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

    fn sum_weights(env: &Env, list: &Vec<Address>) -> u64 {
        let mut sum = 0u64;
        for i in 0..list.len() {
            let token = list.get(i).unwrap();
            if let Some(cfg) = env
                .storage()
                .instance()
                .get::<_, AssetConfig>(&DataKey::Asset(token))
            {
                sum = sum.saturating_add(cfg.target_weight_bps);
            }
        }
        sum
    }

    fn total_portfolio_usd(env: &Env, list: &Vec<Address>) -> Result<i128, Error> {
        let mut total: i128 = 0;
        for i in 0..list.len() {
            let token = list.get(i).unwrap();
            let cfg: AssetConfig = env
                .storage()
                .instance()
                .get(&DataKey::Asset(token.clone()))
                .ok_or(Error::AssetNotFound)?;
            let price = Self::get_price(env, &token)?;
            total += cfg
                .reserve
                .checked_mul(price)
                .unwrap_or(i128::MAX)
                / 10_000_000;
        }
        Ok(total)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::StellarAssetClient,
        Address, Env, Vec,
    };

    /// Set up a portfolio with two assets (50/50 split) and fund the depositor.
    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);

        // Token A
        let tok_a_id = env.register_stellar_asset_contract_v2(admin.clone());
        let tok_a = tok_a_id.address();
        // Token B
        let tok_b_id = env.register_stellar_asset_contract_v2(admin.clone());
        let tok_b = tok_b_id.address();

        // Fund depositor
        StellarAssetClient::new(&env, &tok_a).mint(&depositor, &1_000_000_000);
        StellarAssetClient::new(&env, &tok_b).mint(&depositor, &1_000_000_000);

        // Deploy and initialise portfolio
        let cid = env.register(PortfolioIndex, ());
        let client = PortfolioIndexClient::new(&env, &cid);
        client.initialize(&admin, &300_u64); // 3 % drift tolerance

        // Register assets with 50/50 weights
        client.add_asset(&admin, &tok_a, &5_000_u64);
        client.add_asset(&admin, &tok_b, &5_000_u64);

        // Oracle prices: both $1.00 (7dp = 10_000_000)
        client.update_price(&admin, &tok_a, &10_000_000_i128);
        client.update_price(&admin, &tok_b, &10_000_000_i128);

        (env, cid, admin, depositor, tok_a, tok_b)
    }

    #[test]
    fn test_initialize_and_verify_weights() {
        let (env, cid, _admin, _dep, _ta, _tb) = setup();
        let client = PortfolioIndexClient::new(&env, &cid);
        let sum = client.verify_weights();
        assert_eq!(sum, 10_000_u64);
    }

    #[test]
    fn test_mint_and_redeem() {
        let (env, cid, _admin, depositor, tok_a, tok_b) = setup();
        let client = PortfolioIndexClient::new(&env, &cid);

        let mut amounts = Vec::new(&env);
        amounts.push_back(100_000_000_i128);
        amounts.push_back(100_000_000_i128);

        let shares = client.mint(&depositor, &amounts);
        assert!(shares > 0);

        let owned = client.get_shares(&depositor);
        assert_eq!(owned, shares);

        let outs = client.redeem(&depositor, &shares);
        assert_eq!(outs.len(), 2);
        // Should receive back proportional amounts (may be slightly less due to integer division)
        assert!(outs.get(0).unwrap() > 0);
        assert!(outs.get(1).unwrap() > 0);

        let remaining = client.get_shares(&depositor);
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_drift_computation() {
        let (env, cid, admin, depositor, tok_a, tok_b) = setup();
        let client = PortfolioIndexClient::new(&env, &cid);

        let mut amounts = Vec::new(&env);
        amounts.push_back(100_000_000_i128);
        amounts.push_back(100_000_000_i128);
        client.mint(&depositor, &amounts);

        // Price A 2x higher → A now 66.7% weight vs 50% target → drift
        client.update_price(&admin, &tok_a, &20_000_000_i128);

        let drifts = client.compute_drift();
        // tok_a overweight → positive drift, tok_b underweight → negative drift
        assert!(drifts.get(0).unwrap() > 0);
        assert!(drifts.get(1).unwrap() < 0);
    }

    #[test]
    fn test_rebalance_slippage_protection() {
        let (env, cid, admin, depositor, tok_a, tok_b) = setup();
        let client = PortfolioIndexClient::new(&env, &cid);

        let mut amounts = Vec::new(&env);
        amounts.push_back(100_000_000_i128);
        amounts.push_back(100_000_000_i128);
        client.mint(&depositor, &amounts);

        // Make tok_a significantly overweight by doubling price
        client.update_price(&admin, &tok_a, &20_000_000_i128);

        // min_buy_amount set too high → slippage exceeded
        let result = client.try_rebalance(
            &admin,
            &tok_a,
            &tok_b,
            &10_000_000_i128,
            &99_999_999_999_i128, // impossibly high min
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_pause_blocks_mint() {
        let (env, cid, admin, depositor, _ta, _tb) = setup();
        let client = PortfolioIndexClient::new(&env, &cid);
        client.pause(&admin);

        let mut amounts = Vec::new(&env);
        amounts.push_back(100_i128);
        amounts.push_back(100_i128);
        let result = client.try_mint(&depositor, &amounts);
        assert!(result.is_err());
    }
}
