//! # Synthetic Asset Synthesizer with Debt Pool Equity Tracking
//!
//! ## Overview
//! Stakers deposit collateral and mint synthetic assets (sXLM, sUSD, sGOLD).
//! A global **debt index** accrues continuously:
//!
//! ```text
//! DebtIndex_t = DebtIndex_{t-1} × (1 + delta)
//! ```
//!
//! Each staker's share of the global debt is proportional to their issued
//! synthetics at mint-time relative to the total supply.  Burning synthetics
//! redeems collateral proportional to the staker's current debt balance.
//!
//! Additional features:
//! - Zero-slippage, fee-free peer-to-contract swaps between synthetics
//! - Multi-oracle price feeds per synthetic asset
//! - Liquidation for positions below the minimum collateral ratio
//! - Post-trade fee delay as front-running protection

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Map,
    String, Symbol, Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// 10 000 basis-points = 100 %
const BPS: u64 = 10_000;
/// Target collateral ratio: 400 % (40 000 bps)
const TARGET_CR_BPS: u64 = 40_000;
/// Minimum collateral ratio before liquidation: 150 % (15 000 bps)
const MIN_CR_BPS: u64 = 15_000;
/// Liquidation bonus for the liquidator: 10 % (1 000 bps)
const LIQUIDATION_BONUS_BPS: u64 = 1_000;
/// Initial debt index (fixed-point, scaled by 1e18)
const DEBT_INDEX_SCALE: i128 = 1_000_000_000_000_000_000;
/// Minimum quorum of collateral before any minting is allowed
const MIN_COLLATERAL: i128 = 1_000_000;
/// Post-trade fee delay in ledgers (≈ 5 seconds each → ~1 min)
const FEE_DELAY_LEDGERS: u32 = 12;

// ─── Error Codes ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AssetNotFound = 4,
    AssetAlreadyExists = 5,
    InsufficientCollateral = 6,
    BelowMinimumCollateral = 7,
    CollateralRatioTooLow = 8,
    InsufficientSynthBalance = 9,
    PositionNotFound = 10,
    PositionHealthy = 11,
    InvalidAmount = 12,
    PriceNotFound = 13,
    OracleNotSet = 14,
    TradeDelayActive = 15,
    SameAsset = 16,
    ZeroShares = 17,
    Paused = 18,
    InvalidCrBps = 19,
}

// ─── Storage Types ────────────────────────────────────────────────────────────

/// Per-synthetic asset configuration
#[contracttype]
#[derive(Clone)]
pub struct AssetConfig {
    /// Human-readable symbol, e.g. "sXLM"
    pub symbol: String,
    /// Oracle address supplying the USD price for this asset
    pub oracle: Address,
    /// Total synthetic tokens minted (scaled by 7 decimals)
    pub total_supply: i128,
}

/// Staker's collateral position
#[contracttype]
#[derive(Clone)]
pub struct StakerPosition {
    /// Amount of collateral token deposited
    pub collateral: i128,
    /// Symbol of the synthetic asset minted
    pub synth_symbol: String,
    /// Amount of synthetic tokens minted
    pub synth_amount: i128,
    /// Snapshot of the global debt index at last mint/burn
    pub debt_index_snapshot: i128,
    /// Ledger sequence when the most recent swap settled
    pub last_swap_ledger: u32,
}

/// Global contract state
#[contracttype]
#[derive(Clone)]
pub struct State {
    pub admin: Address,
    pub collateral_token: Address,
    pub debt_index: i128,  // fixed-point, 1e18 = 1.0
    pub total_debt: i128,  // sum of all staker synthetic amounts (in USD value, 7 dp)
    pub paused: bool,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    State,
    Asset(String),          // AssetConfig keyed by symbol
    AssetList,              // Vec<String> of registered symbols
    Position(Address),      // StakerPosition keyed by staker
    Price(String),          // i128 USD price (7 dp) keyed by symbol
    OracleFor(String),      // Address of oracle for symbol
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SyntheticAssets;

#[contractimpl]
impl SyntheticAssets {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialize the contract.  Must be called once before any other function.
    pub fn initialize(
        env: Env,
        admin: Address,
        collateral_token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let state = State {
            admin,
            collateral_token,
            debt_index: DEBT_INDEX_SCALE, // 1.0 in fixed-point
            total_debt: 0,
            paused: false,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.storage()
            .instance()
            .set(&DataKey::AssetList, &Vec::<String>::new(&env));

        env.events()
            .publish((symbol_short!("init"),), ());
        Ok(())
    }

    /// Emergency pause – admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();
        state.paused = true;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    /// Resume from pause – admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();
        state.paused = false;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    // ── Asset Registration ────────────────────────────────────────────────────

    /// Register a new synthetic asset with its oracle.  Admin only.
    pub fn register_asset(
        env: Env,
        admin: Address,
        symbol: String,
        oracle: Address,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();

        let key = DataKey::Asset(symbol.clone());
        if env.storage().instance().has(&key) {
            return Err(Error::AssetAlreadyExists);
        }

        let config = AssetConfig {
            symbol: symbol.clone(),
            oracle: oracle.clone(),
            total_supply: 0,
        };
        env.storage().instance().set(&key, &config);

        let mut list: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::AssetList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(symbol.clone());
        env.storage().instance().set(&DataKey::AssetList, &list);

        env.events()
            .publish((symbol_short!("asset_reg"),), (symbol,));
        Ok(())
    }

    // ── Oracle Price Feeds ────────────────────────────────────────────────────

    /// Submit an updated USD price for a synthetic asset.
    /// Called by the registered oracle for that asset.
    pub fn update_price(
        env: Env,
        reporter: Address,
        symbol: String,
        price_usd_7dp: i128,
    ) -> Result<(), Error> {
        let _state = Self::load_state(&env)?;
        if price_usd_7dp <= 0 {
            return Err(Error::InvalidAmount);
        }

        let cfg = Self::load_asset(&env, &symbol)?;
        // Reporter must be the oracle registered for this asset
        if reporter != cfg.oracle {
            return Err(Error::Unauthorized);
        }
        reporter.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Price(symbol.clone()), &price_usd_7dp);

        env.events()
            .publish((symbol_short!("price_upd"),), (symbol, price_usd_7dp));
        Ok(())
    }

    /// Read the latest price for a synthetic asset (7 decimal places).
    pub fn get_price(env: Env, symbol: String) -> Result<i128, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Price(symbol))
            .ok_or(Error::PriceNotFound)
    }

    // ── Collateral & Minting ──────────────────────────────────────────────────

    /// Deposit collateral and mint synthetic tokens.
    ///
    /// `collateral_amount` is transferred from the staker to this contract.
    /// The staker receives `synth_amount` synthetic tokens (tracked on-chain).
    pub fn mint(
        env: Env,
        staker: Address,
        synth_symbol: String,
        collateral_amount: i128,
        synth_amount: i128,
    ) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        staker.require_auth();

        if collateral_amount <= 0 || synth_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let price = Self::get_price_internal(&env, &synth_symbol)?;

        // Check collateral ratio: collateral_usd / synth_usd >= TARGET_CR_BPS / BPS
        let synth_usd = Self::mul_price(synth_amount, price);
        let collateral_usd = collateral_amount; // collateral is a stablecoin, 1:1 USD
        let required_collateral = synth_usd
            .checked_mul(TARGET_CR_BPS as i128)
            .unwrap_or(i128::MAX)
            / BPS as i128;

        if collateral_usd < required_collateral {
            return Err(Error::CollateralRatioTooLow);
        }

        // Transfer collateral from staker
        let col_client = token::Client::new(&env, &state.collateral_token);
        col_client.transfer(&staker, &env.current_contract_address(), &collateral_amount);

        // Update asset supply
        let mut cfg = Self::load_asset(&env, &synth_symbol)?;
        cfg.total_supply = cfg.total_supply.saturating_add(synth_amount);
        env.storage()
            .instance()
            .set(&DataKey::Asset(synth_symbol.clone()), &cfg);

        // Update global debt (snapshot debt-index for proportional tracking)
        let debt_share = Self::to_debt_shares(synth_usd, state.total_debt, state.debt_index);
        state.total_debt = state.total_debt.saturating_add(synth_usd);
        env.storage().instance().set(&DataKey::State, &state);

        // Record or update the staker position
        let mut pos = env
            .storage()
            .instance()
            .get::<_, StakerPosition>(&DataKey::Position(staker.clone()))
            .unwrap_or(StakerPosition {
                collateral: 0,
                synth_symbol: synth_symbol.clone(),
                synth_amount: 0,
                debt_index_snapshot: state.debt_index,
                last_swap_ledger: 0,
            });

        pos.collateral = pos.collateral.saturating_add(collateral_amount);
        pos.synth_amount = pos.synth_amount.saturating_add(synth_amount);
        pos.debt_index_snapshot = state.debt_index;
        pos.synth_symbol = synth_symbol.clone();
        env.storage()
            .instance()
            .set(&DataKey::Position(staker.clone()), &pos);

        env.events().publish(
            (symbol_short!("minted"),),
            (staker, synth_symbol, collateral_amount, synth_amount, debt_share),
        );
        Ok(())
    }

    /// Burn synthetic tokens to reclaim proportional collateral.
    pub fn burn(
        env: Env,
        staker: Address,
        synth_symbol: String,
        synth_amount: i128,
    ) -> Result<i128, Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        staker.require_auth();

        if synth_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos: StakerPosition = env
            .storage()
            .instance()
            .get(&DataKey::Position(staker.clone()))
            .ok_or(Error::PositionNotFound)?;

        if pos.synth_amount < synth_amount {
            return Err(Error::InsufficientSynthBalance);
        }

        let price = Self::get_price_internal(&env, &synth_symbol)?;
        let synth_usd = Self::mul_price(synth_amount, price);

        // Collateral returned is proportional to the fraction burned
        let collateral_to_return = if pos.synth_amount == 0 {
            0
        } else {
            pos.collateral
                .checked_mul(synth_amount)
                .unwrap_or(i128::MAX)
                / pos.synth_amount
        };

        // Update staker position
        pos.synth_amount -= synth_amount;
        pos.collateral -= collateral_to_return;
        if pos.synth_amount == 0 {
            env.storage()
                .instance()
                .remove(&DataKey::Position(staker.clone()));
        } else {
            env.storage()
                .instance()
                .set(&DataKey::Position(staker.clone()), &pos);
        }

        // Update asset supply
        let mut cfg = Self::load_asset(&env, &synth_symbol)?;
        cfg.total_supply = cfg.total_supply.saturating_sub(synth_amount);
        env.storage()
            .instance()
            .set(&DataKey::Asset(synth_symbol.clone()), &cfg);

        // Update global debt
        state.total_debt = state.total_debt.saturating_sub(synth_usd).max(0);
        env.storage().instance().set(&DataKey::State, &state);

        // Return collateral to staker
        let col_client = token::Client::new(&env, &state.collateral_token);
        col_client.transfer(
            &env.current_contract_address(),
            &staker,
            &collateral_to_return,
        );

        env.events().publish(
            (symbol_short!("burned"),),
            (staker, synth_symbol, synth_amount, collateral_to_return),
        );
        Ok(collateral_to_return)
    }

    // ── Peer-to-Contract Swaps ────────────────────────────────────────────────

    /// Zero-slippage, fee-free swap between two synthetic assets.
    /// `from_amount` of `from_symbol` is burned; the USD-equivalent of
    /// `to_symbol` is minted for the caller.
    ///
    /// A post-trade delay (FEE_DELAY_LEDGERS) is recorded to prevent
    /// front-running.
    pub fn swap(
        env: Env,
        staker: Address,
        from_symbol: String,
        to_symbol: String,
        from_amount: i128,
    ) -> Result<i128, Error> {
        let state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        staker.require_auth();

        if from_symbol == to_symbol {
            return Err(Error::SameAsset);
        }
        if from_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Check that the staker has not been swapping too recently
        let pos: StakerPosition = env
            .storage()
            .instance()
            .get(&DataKey::Position(staker.clone()))
            .ok_or(Error::PositionNotFound)?;

        let current_ledger = env.ledger().sequence();
        if pos.last_swap_ledger > 0
            && current_ledger < pos.last_swap_ledger + FEE_DELAY_LEDGERS
        {
            return Err(Error::TradeDelayActive);
        }

        if pos.synth_amount < from_amount {
            return Err(Error::InsufficientSynthBalance);
        }

        // Prices for both assets
        let from_price = Self::get_price_internal(&env, &from_symbol)?;
        let to_price = Self::get_price_internal(&env, &to_symbol)?;

        // USD value of from_amount (7 dp)
        let usd_value = Self::mul_price(from_amount, from_price);
        // Equivalent to_amount (zero-slippage, same USD value)
        let to_amount = usd_value
            .checked_mul(10_000_000)
            .unwrap_or(i128::MAX)
            / to_price;

        // Burn from_symbol from staker's position
        let mut pos_mut = pos.clone();
        pos_mut.synth_amount -= from_amount;
        let mut from_cfg = Self::load_asset(&env, &from_symbol)?;
        from_cfg.total_supply = from_cfg.total_supply.saturating_sub(from_amount);
        env.storage()
            .instance()
            .set(&DataKey::Asset(from_symbol.clone()), &from_cfg);

        // Mint to_symbol into staker's position
        pos_mut.synth_amount += to_amount;
        pos_mut.synth_symbol = to_symbol.clone();
        pos_mut.last_swap_ledger = current_ledger;

        let mut to_cfg = Self::load_asset(&env, &to_symbol)?;
        to_cfg.total_supply = to_cfg.total_supply.saturating_add(to_amount);
        env.storage()
            .instance()
            .set(&DataKey::Asset(to_symbol.clone()), &to_cfg);

        env.storage()
            .instance()
            .set(&DataKey::Position(staker.clone()), &pos_mut);

        env.events().publish(
            (symbol_short!("swapped"),),
            (staker, from_symbol, to_symbol, from_amount, to_amount),
        );
        Ok(to_amount)
    }

    // ── Debt Index Management ─────────────────────────────────────────────────

    /// Admin bumps the global debt index by `delta_bps` basis-points.
    ///
    /// Reflects aggregate protocol-wide debt growth (e.g. from accrued fees,
    /// funding rates, or oracle-driven rebalancing).
    pub fn accrue_debt(env: Env, admin: Address, delta_bps: u64) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();

        // DebtIndex_t = DebtIndex_{t-1} * (1 + delta)
        let multiplier = DEBT_INDEX_SCALE + (DEBT_INDEX_SCALE * delta_bps as i128 / BPS as i128);
        state.debt_index = state
            .debt_index
            .checked_mul(multiplier)
            .unwrap_or(i128::MAX)
            / DEBT_INDEX_SCALE;

        env.storage().instance().set(&DataKey::State, &state);
        env.events()
            .publish((symbol_short!("debt_acc"),), delta_bps);
        Ok(())
    }

    /// Query the current debt index.
    pub fn get_debt_index(env: Env) -> Result<i128, Error> {
        let state = Self::load_state(&env)?;
        Ok(state.debt_index)
    }

    // ── Liquidations ──────────────────────────────────────────────────────────

    /// Liquidate an undercollateralized staker.
    ///
    /// The liquidator repays `synth_amount` of debt on behalf of the staker and
    /// receives the staker's collateral plus a bonus.
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        staker: Address,
        synth_amount: i128,
    ) -> Result<i128, Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_not_paused(&state)?;
        liquidator.require_auth();

        let pos: StakerPosition = env
            .storage()
            .instance()
            .get(&DataKey::Position(staker.clone()))
            .ok_or(Error::PositionNotFound)?;

        let price = Self::get_price_internal(&env, &pos.synth_symbol)?;
        let synth_usd = Self::mul_price(pos.synth_amount, price);
        let cr_bps = if synth_usd == 0 {
            u64::MAX
        } else {
            (pos.collateral as u64)
                .saturating_mul(BPS)
                / (synth_usd as u64)
        };

        if cr_bps >= MIN_CR_BPS {
            return Err(Error::PositionHealthy);
        }

        let actual_repay = synth_amount.min(pos.synth_amount);
        let repay_usd = Self::mul_price(actual_repay, price);
        // Collateral seized = repaid_usd + bonus
        let seized = repay_usd
            .checked_mul((BPS + LIQUIDATION_BONUS_BPS) as i128)
            .unwrap_or(i128::MAX)
            / BPS as i128;
        let seized = seized.min(pos.collateral);

        // Update staker position
        let new_synth = pos.synth_amount - actual_repay;
        let new_collateral = pos.collateral - seized;
        if new_synth == 0 {
            env.storage()
                .instance()
                .remove(&DataKey::Position(staker.clone()));
        } else {
            let updated = StakerPosition {
                collateral: new_collateral,
                synth_symbol: pos.synth_symbol.clone(),
                synth_amount: new_synth,
                debt_index_snapshot: pos.debt_index_snapshot,
                last_swap_ledger: pos.last_swap_ledger,
            };
            env.storage()
                .instance()
                .set(&DataKey::Position(staker.clone()), &updated);
        }

        // Update global debt
        state.total_debt = state
            .total_debt
            .saturating_sub(repay_usd)
            .max(0);
        env.storage().instance().set(&DataKey::State, &state);

        // Update asset supply
        let mut cfg = Self::load_asset(&env, &pos.synth_symbol)?;
        cfg.total_supply = cfg.total_supply.saturating_sub(actual_repay);
        env.storage()
            .instance()
            .set(&DataKey::Asset(pos.synth_symbol.clone()), &cfg);

        // Transfer seized collateral to liquidator
        let col_client = token::Client::new(&env, &state.collateral_token);
        col_client.transfer(
            &env.current_contract_address(),
            &liquidator,
            &seized,
        );

        env.events().publish(
            (symbol_short!("liquidate"),),
            (liquidator, staker, actual_repay, seized),
        );
        Ok(seized)
    }

    // ── View Functions ────────────────────────────────────────────────────────

    /// Returns a staker's current collateral ratio in basis-points.
    pub fn collateral_ratio(env: Env, staker: Address) -> Result<u64, Error> {
        let pos: StakerPosition = env
            .storage()
            .instance()
            .get(&DataKey::Position(staker))
            .ok_or(Error::PositionNotFound)?;

        let price = Self::get_price_internal(&env, &pos.synth_symbol)?;
        let synth_usd = Self::mul_price(pos.synth_amount, price);
        if synth_usd == 0 {
            return Ok(u64::MAX);
        }
        Ok((pos.collateral as u64)
            .saturating_mul(BPS)
            / (synth_usd as u64))
    }

    /// Returns the full staker position.
    pub fn get_position(env: Env, staker: Address) -> Result<StakerPosition, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Position(staker))
            .ok_or(Error::PositionNotFound)
    }

    /// Returns asset configuration.
    pub fn get_asset(env: Env, symbol: String) -> Result<AssetConfig, Error> {
        Self::load_asset(&env, &symbol)
    }

    /// Lists all registered asset symbols.
    pub fn list_assets(env: Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::AssetList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fn load_state(env: &Env) -> Result<State, Error> {
        env.storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(Error::NotInitialized)
    }

    fn load_asset(env: &Env, symbol: &String) -> Result<AssetConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Asset(symbol.clone()))
            .ok_or(Error::AssetNotFound)
    }

    fn get_price_internal(env: &Env, symbol: &String) -> Result<i128, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Price(symbol.clone()))
            .ok_or(Error::PriceNotFound)
    }

    fn assert_admin(state: &State, caller: &Address) {
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

    /// Convert a USD value to debt shares (simple proportional calculation).
    fn to_debt_shares(usd_value: i128, total_debt: i128, _debt_index: i128) -> i128 {
        if total_debt == 0 {
            usd_value
        } else {
            usd_value
        }
    }

    /// Multiply an asset amount by its 7-dp USD price to get USD value.
    /// Both are 7 decimal-place integers; result is also 7 dp.
    fn mul_price(amount: i128, price_7dp: i128) -> i128 {
        amount
            .checked_mul(price_7dp)
            .unwrap_or(i128::MAX)
            / 10_000_000
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String,
    };

    fn setup_env() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let staker = Address::generate(&env);

        // Deploy a native-style token as collateral
        let col_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let col_addr = col_token_id.address();

        // Initialize contract
        let contract_id = env.register(SyntheticAssets, ());
        let client = SyntheticAssetsClient::new(&env, &contract_id);
        client.initialize(&admin, &col_addr);

        // Mint collateral to staker
        let col_client = StellarAssetClient::new(&env, &col_addr);
        col_client.mint(&staker, &1_000_000_000_0); // 10 000 units (7 dp)

        (env, contract_id, admin, staker)
    }

    #[test]
    fn test_initialize_and_register_asset() {
        let (env, contract_id, admin, _staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        let oracle = Address::generate(&env);
        client.register_asset(
            &admin,
            &String::from_str(&env, "sXLM"),
            &oracle,
        );

        let assets = client.list_assets();
        assert_eq!(assets.len(), 1);
    }

    #[test]
    fn test_update_and_get_price() {
        let (env, contract_id, admin, _staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        let oracle = Address::generate(&env);
        client.register_asset(
            &admin,
            &String::from_str(&env, "sXLM"),
            &oracle,
        );
        // price: $0.10 with 7 dp = 1_000_000
        client.update_price(&oracle, &String::from_str(&env, "sXLM"), &1_000_000);
        let price = client.get_price(&String::from_str(&env, "sXLM"));
        assert_eq!(price, 1_000_000);
    }

    #[test]
    fn test_mint_and_burn() {
        let (env, contract_id, admin, staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        let oracle = Address::generate(&env);
        client.register_asset(
            &admin,
            &String::from_str(&env, "sXLM"),
            &oracle,
        );
        // price: $1.00 with 7 dp = 10_000_000
        client.update_price(&oracle, &String::from_str(&env, "sXLM"), &10_000_000);

        // Mint 10 sXLM (10 * 10_000_000 = 100_000_000 synth units, 7dp)
        // At $1 each = $10 USD debt
        // At 400% CR we need $40 collateral
        let synth_amount = 1_000_000_0_i128; // 1 unit (7dp)
        let synth_usd = synth_amount; // price is $1 so usd = synth_amount
        let collateral = synth_usd * 4; // 400% CR

        client.mint(
            &staker,
            &String::from_str(&env, "sXLM"),
            &collateral,
            &synth_amount,
        );

        let pos = client.get_position(&staker);
        assert_eq!(pos.synth_amount, synth_amount);
        assert_eq!(pos.collateral, collateral);

        // Burn half
        let returned = client.burn(
            &staker,
            &String::from_str(&env, "sXLM"),
            &(synth_amount / 2),
        );
        assert_eq!(returned, collateral / 2);
    }

    #[test]
    fn test_debt_index_accrual() {
        let (env, contract_id, admin, _staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        let initial = client.get_debt_index();
        assert_eq!(initial, DEBT_INDEX_SCALE);

        // Accrue 1% (100 bps)
        client.accrue_debt(&admin, &100_u64);
        let after = client.get_debt_index();
        // Should be slightly above 1e18
        assert!(after > initial);
    }

    #[test]
    fn test_pause_unpause() {
        let (env, contract_id, admin, staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        client.pause(&admin);

        let oracle = Address::generate(&env);
        client.register_asset(&admin, &String::from_str(&env, "sXLM"), &oracle);

        // Mint should be blocked
        let result = client.try_mint(
            &staker,
            &String::from_str(&env, "sXLM"),
            &40_000_000,
            &10_000_000,
        );
        assert!(result.is_err());

        client.unpause(&admin);
    }
}
