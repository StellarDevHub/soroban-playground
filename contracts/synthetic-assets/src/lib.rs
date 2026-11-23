//! Collateral-backed synthetic debt positions with fresh-price health checks,
//! stabilization fees, tier ceilings and delayed settlement.
//!
//! Each staker holds one synthetic symbol. Balances are internal debt records;
//! collateral transfers and reserve payments use the configured token contract.
//! The legacy debt index remains informational rather than redistributing debt.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Vec,
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
/// All token amounts and USD prices use seven decimals.
const PRICE_SCALE: i128 = 10_000_000;
const MAX_PRICE_AGE: u64 = 300;
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
    Overflow = 20,
    WrongAsset = 21,
    DebtCeiling = 22,
    StalePrice = 23,
    InvalidRiskConfig = 24,
    PartialSwap = 25,
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
    pub debt_index: i128, // fixed-point, 1e18 = 1.0
    pub total_debt: i128, // sum of all staker synthetic amounts (in USD value, 7 dp)
    pub paused: bool,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    State,
    Reserve,
    CollateralOracle,
    CollateralPrice,
    CollateralPriceTime,
    PriceTime(String),
    Tier(String),
    MintLedger(Address),
    Asset(String),     // AssetConfig keyed by symbol
    AssetList,         // Vec<String> of registered symbols
    Position(Address), // StakerPosition keyed by staker
    Price(String),     // i128 USD price (7 dp) keyed by symbol
    OracleFor(String), // Address of oracle for symbol
}

// ─── Contract ─────────────────────────────────────────────────────────────────

/// USD debt ceilings (7 dp) are enforced per asset, including swap issuance.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetTier {
    Stable,
    Standard,
    Experimental,
}

impl AssetTier {
    fn ceiling(self) -> i128 {
        match self {
            Self::Stable => 1_000_000 * PRICE_SCALE,
            Self::Standard => 100_000 * PRICE_SCALE,
            Self::Experimental => 10_000 * PRICE_SCALE,
        }
    }
}

#[contract]
pub struct SyntheticAssets;

#[contractimpl]
impl SyntheticAssets {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialize the contract.  Must be called once before any other function.
    pub fn initialize(env: Env, admin: Address, collateral_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let state = State {
            admin: admin.clone(),
            collateral_token,
            debt_index: DEBT_INDEX_SCALE, // 1.0 in fixed-point
            total_debt: 0,
            paused: false,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.storage()
            .instance()
            .set(&DataKey::AssetList, &Vec::<String>::new(&env));

        env.storage().instance().set(&DataKey::Reserve, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CollateralOracle, &admin);
        // Prices must be explicitly reported before any collateral operation.
        env.events().publish((symbol_short!("init"),), ());
        Ok(())
    }

    /// Configure a separate fee recipient and collateral price reporter.
    pub fn configure_risk(
        env: Env,
        admin: Address,
        reserve: Address,
        oracle: Address,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();
        if reserve == env.current_contract_address() {
            return Err(Error::InvalidRiskConfig);
        }
        env.storage().instance().set(&DataKey::Reserve, &reserve);
        env.storage()
            .instance()
            .set(&DataKey::CollateralOracle, &oracle);
        env.storage().instance().remove(&DataKey::CollateralPrice);
        Ok(())
    }

    pub fn update_collateral_price(env: Env, reporter: Address, price: i128) -> Result<(), Error> {
        Self::load_state(&env)?;
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::CollateralOracle)
            .ok_or(Error::OracleNotSet)?;
        if reporter != oracle {
            return Err(Error::Unauthorized);
        }
        reporter.require_auth();
        if price <= 0 {
            return Err(Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::CollateralPrice, &price);
        env.storage()
            .instance()
            .set(&DataKey::CollateralPriceTime, &env.ledger().timestamp());
        Ok(())
    }

    /// New assets default to the smallest ceiling until explicitly classified.
    pub fn set_asset_tier(
        env: Env,
        admin: Address,
        symbol: String,
        tier: AssetTier,
    ) -> Result<(), Error> {
        let state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();
        let cfg = Self::load_asset(&env, &symbol)?;
        if cfg.total_supply > 0
            && Self::value_up(cfg.total_supply, Self::get_price_internal(&env, &symbol)?)?
                > tier.ceiling()
        {
            return Err(Error::DebtCeiling);
        }
        env.storage().instance().set(&DataKey::Tier(symbol), &tier);
        Ok(())
    }

    pub fn debt_ceiling(env: Env, symbol: String) -> Result<i128, Error> {
        Self::load_asset(&env, &symbol)?;
        Ok(Self::tier(&env, &symbol).ceiling())
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

        env.storage().instance().set(
            &DataKey::PriceTime(symbol.clone()),
            &env.ledger().timestamp(),
        );
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
        if pos.synth_symbol != synth_symbol {
            return Err(Error::WrongAsset);
        }
        pos.collateral = pos
            .collateral
            .checked_add(collateral_amount)
            .ok_or(Error::Overflow)?;
        pos.synth_amount = pos
            .synth_amount
            .checked_add(synth_amount)
            .ok_or(Error::Overflow)?;
        // Reprice the entire position, not just this deposit; fees are paid separately.
        Self::ensure_health(&env, &pos, TARGET_CR_BPS)?;
        let mut cfg = Self::load_asset(&env, &synth_symbol)?;
        cfg.total_supply = cfg
            .total_supply
            .checked_add(synth_amount)
            .ok_or(Error::Overflow)?;
        Self::check_ceiling(&env, &cfg, price)?;
        let fee = Self::fee(&env, &cfg, synth_amount, price)?;
        let col_client = token::Client::new(&env, &state.collateral_token);
        col_client.transfer(&staker, &env.current_contract_address(), &collateral_amount);
        Self::pay_fee(&env, &state, &staker, fee)?;
        let synth_usd = Self::value_up(synth_amount, price)?;
        let debt_share = synth_usd;
        state.total_debt = state
            .total_debt
            .checked_add(synth_usd)
            .ok_or(Error::Overflow)?;
        env.storage().instance().set(&DataKey::State, &state);
        env.storage()
            .instance()
            .set(&DataKey::Asset(synth_symbol.clone()), &cfg);
        env.storage()
            .instance()
            .set(&DataKey::Position(staker.clone()), &pos);
        env.storage().instance().set(
            &DataKey::MintLedger(staker.clone()),
            &env.ledger().sequence(),
        );

        env.events().publish(
            (symbol_short!("minted"),),
            (
                staker,
                synth_symbol,
                collateral_amount,
                synth_amount,
                debt_share,
            ),
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

        if pos.synth_symbol != synth_symbol {
            return Err(Error::WrongAsset);
        }
        Self::check_delay(&env, &staker)?;
        if pos.synth_amount < synth_amount {
            return Err(Error::InsufficientSynthBalance);
        }

        let price = Self::get_price_internal(&env, &synth_symbol)?;
        let synth_usd = Self::value_up(synth_amount, price)?;

        // Collateral returned is proportional to the fraction burned
        let collateral_to_return = if pos.synth_amount == 0 {
            0
        } else {
            pos.collateral
                .checked_mul(synth_amount)
                .ok_or(Error::Overflow)?
                / pos.synth_amount
        };

        let cfg_before = Self::load_asset(&env, &synth_symbol)?;
        let fee = Self::fee(&env, &cfg_before, synth_amount, price)?;
        Self::pay_fee(&env, &state, &staker, fee)?;
        // Update staker position
        pos.synth_amount -= synth_amount;
        pos.collateral -= collateral_to_return;
        if pos.synth_amount == 0 {
            env.storage()
                .instance()
                .remove(&DataKey::Position(staker.clone()));
        } else {
            Self::ensure_health(&env, &pos, MIN_CR_BPS)?;
            env.storage()
                .instance()
                .set(&DataKey::Position(staker.clone()), &pos);
        }

        // Update asset supply
        let mut cfg = Self::load_asset(&env, &synth_symbol)?;
        cfg.total_supply = cfg
            .total_supply
            .checked_sub(synth_amount)
            .filter(|v| *v >= 0)
            .ok_or(Error::Overflow)?;
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

    /// Zero-slippage, fee-charging swap between two synthetic assets.
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

        Self::check_delay(&env, &staker)?;
        if pos.synth_symbol != from_symbol {
            return Err(Error::WrongAsset);
        }
        // The storage model has one symbol per position: partial swaps cannot
        // represent two balances without mixing differently denominated units.
        if pos.synth_amount != from_amount {
            return Err(Error::PartialSwap);
        }
        Self::ensure_health(&env, &pos, MIN_CR_BPS)?;
        let from_price = Self::get_price_internal(&env, &from_symbol)?;
        let to_price = Self::get_price_internal(&env, &to_symbol)?;
        let usd_value = Self::mul_price(from_amount, from_price)?;
        let to_amount = usd_value.checked_mul(PRICE_SCALE).ok_or(Error::Overflow)? / to_price;
        if to_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut from_cfg = Self::load_asset(&env, &from_symbol)?;
        from_cfg.total_supply = from_cfg
            .total_supply
            .checked_sub(from_amount)
            .filter(|v| *v >= 0)
            .ok_or(Error::Overflow)?;
        let mut to_cfg = Self::load_asset(&env, &to_symbol)?;
        to_cfg.total_supply = to_cfg
            .total_supply
            .checked_add(to_amount)
            .ok_or(Error::Overflow)?;
        Self::check_ceiling(&env, &to_cfg, to_price)?;
        // Swaps burn and mint too, so neither stabilization fee can be bypassed.
        let from_before = Self::load_asset(&env, &from_symbol)?;
        let fee = Self::fee(&env, &from_before, from_amount, from_price)?
            .checked_add(Self::fee(&env, &to_cfg, to_amount, to_price)?)
            .ok_or(Error::Overflow)?;
        Self::pay_fee(&env, &state, &staker, fee)?;
        let mut pos_mut = pos;
        pos_mut.synth_amount = to_amount;
        pos_mut.synth_symbol = to_symbol.clone();
        pos_mut.last_swap_ledger = env.ledger().sequence();
        Self::ensure_health(&env, &pos_mut, MIN_CR_BPS)?;
        env.storage()
            .instance()
            .set(&DataKey::Asset(from_symbol.clone()), &from_cfg);
        env.storage()
            .instance()
            .set(&DataKey::Asset(to_symbol.clone()), &to_cfg);
        env.storage()
            .instance()
            .set(&DataKey::Position(staker.clone()), &pos_mut);
        env.storage().instance().set(
            &DataKey::MintLedger(staker.clone()),
            &env.ledger().sequence(),
        );

        env.events().publish(
            (symbol_short!("swapped"),),
            (staker, from_symbol, to_symbol, from_amount, to_amount),
        );
        Ok(to_amount)
    }

    // ── Debt Index Management ─────────────────────────────────────────────────

    /// Admin bumps the global debt index by `delta_bps` basis-points.
    ///
    /// Informational legacy counter; health checks use live position balances.
    pub fn accrue_debt(env: Env, admin: Address, delta_bps: u64) -> Result<(), Error> {
        let mut state = Self::load_state(&env)?;
        Self::assert_admin(&state, &admin);
        admin.require_auth();

        // DebtIndex_t = DebtIndex_{t-1} * (1 + delta)
        let multiplier = DEBT_INDEX_SCALE + (DEBT_INDEX_SCALE * delta_bps as i128 / BPS as i128);
        state.debt_index = state
            .debt_index
            .checked_mul(multiplier)
            .ok_or(Error::Overflow)?
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

        if synth_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if Self::ratio(&env, &pos)? >= MIN_CR_BPS {
            return Err(Error::PositionHealthy);
        }
        let price = Self::get_price_internal(&env, &pos.synth_symbol)?;
        let actual_repay = synth_amount.min(pos.synth_amount);
        let repay_usd = Self::value_up(actual_repay, price)?;
        let collateral_price = Self::collateral_price(&env)?;
        let payment = Self::div_up(
            repay_usd.checked_mul(PRICE_SCALE).ok_or(Error::Overflow)?,
            collateral_price,
        )?;
        let seized = payment
            .checked_mul((BPS + LIQUIDATION_BONUS_BPS) as i128)
            .ok_or(Error::Overflow)?
            / BPS as i128;
        let seized = seized.min(pos.collateral);
        // Synths are internal debt records, not transferable tokens. Repayment
        // is therefore real collateral paid to the reserve, never a free seizure.
        Self::pay_fee(&env, &state, &liquidator, payment)?;

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
        state.total_debt = state.total_debt.saturating_sub(repay_usd).max(0);
        env.storage().instance().set(&DataKey::State, &state);

        // Update asset supply
        let mut cfg = Self::load_asset(&env, &pos.synth_symbol)?;
        cfg.total_supply = cfg
            .total_supply
            .checked_sub(actual_repay)
            .filter(|v| *v >= 0)
            .ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::Asset(pos.synth_symbol.clone()), &cfg);

        // Transfer seized collateral to liquidator
        let col_client = token::Client::new(&env, &state.collateral_token);
        col_client.transfer(&env.current_contract_address(), &liquidator, &seized);
        if new_synth == 0 && new_collateral > 0 {
            col_client.transfer(&env.current_contract_address(), &staker, &new_collateral);
        }

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

        Self::ratio(&env, &pos)
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
        Self::fresh(env, &DataKey::PriceTime(symbol.clone()))?;
        env.storage()
            .instance()
            .get(&DataKey::Price(symbol.clone()))
            .ok_or(Error::PriceNotFound)
    }

    fn fresh(env: &Env, key: &DataKey) -> Result<(), Error> {
        let time: u64 = env
            .storage()
            .instance()
            .get(key)
            .ok_or(Error::PriceNotFound)?;
        if env
            .ledger()
            .timestamp()
            .checked_sub(time)
            .ok_or(Error::StalePrice)?
            > MAX_PRICE_AGE
        {
            return Err(Error::StalePrice);
        }
        Ok(())
    }

    fn collateral_price(env: &Env) -> Result<i128, Error> {
        Self::fresh(env, &DataKey::CollateralPriceTime)?;
        env.storage()
            .instance()
            .get(&DataKey::CollateralPrice)
            .ok_or(Error::PriceNotFound)
    }

    fn tier(env: &Env, symbol: &String) -> AssetTier {
        env.storage()
            .instance()
            .get(&DataKey::Tier(symbol.clone()))
            .unwrap_or(AssetTier::Experimental)
    }

    fn check_ceiling(env: &Env, cfg: &AssetConfig, price: i128) -> Result<(), Error> {
        if Self::value_up(cfg.total_supply, price)? > Self::tier(env, &cfg.symbol).ceiling() {
            return Err(Error::DebtCeiling);
        }
        Ok(())
    }

    fn div_up(n: i128, d: i128) -> Result<i128, Error> {
        if n < 0 || d <= 0 {
            return Err(Error::InvalidAmount);
        }
        (n / d)
            .checked_add(i128::from(n % d != 0))
            .ok_or(Error::Overflow)
    }

    fn value_up(amount: i128, price: i128) -> Result<i128, Error> {
        Self::div_up(
            amount.checked_mul(price).ok_or(Error::Overflow)?,
            PRICE_SCALE,
        )
    }

    fn ratio(env: &Env, pos: &StakerPosition) -> Result<u64, Error> {
        let debt = Self::value_up(
            pos.synth_amount,
            Self::get_price_internal(env, &pos.synth_symbol)?,
        )?;
        if debt == 0 {
            return Ok(u64::MAX);
        }
        let collateral = Self::mul_price(pos.collateral, Self::collateral_price(env)?)?;
        let ratio = collateral.checked_mul(BPS as i128).ok_or(Error::Overflow)? / debt;
        Ok(ratio.min(u64::MAX as i128) as u64)
    }

    fn ensure_health(env: &Env, pos: &StakerPosition, minimum: u64) -> Result<(), Error> {
        if Self::ratio(env, pos)? < minimum.max(MIN_CR_BPS) {
            return Err(Error::CollateralRatioTooLow);
        }
        Ok(())
    }

    // Nonzero base (25 bps) plus up to 75 bps as debt approaches its tier
    // ceiling. Rounding up prevents small transactions from avoiding fees.
    fn fee(env: &Env, cfg: &AssetConfig, amount: i128, price: i128) -> Result<i128, Error> {
        let ceiling = Self::tier(env, &cfg.symbol).ceiling();
        let used = Self::value_up(cfg.total_supply, price)?.min(ceiling);
        let bps = 25 + used.checked_mul(75).ok_or(Error::Overflow)? / ceiling;
        let usd = Self::value_up(amount, price)?;
        let fee_usd = Self::div_up(usd.checked_mul(bps).ok_or(Error::Overflow)?, BPS as i128)?;
        Self::div_up(
            fee_usd.checked_mul(PRICE_SCALE).ok_or(Error::Overflow)?,
            Self::collateral_price(env)?,
        )
    }

    fn pay_fee(env: &Env, state: &State, payer: &Address, fee: i128) -> Result<(), Error> {
        let reserve: Address = env
            .storage()
            .instance()
            .get(&DataKey::Reserve)
            .ok_or(Error::InvalidRiskConfig)?;
        // Prevent a self-transfer from silently waiving the stabilization fee.
        if &reserve == payer {
            return Err(Error::InvalidRiskConfig);
        }
        token::Client::new(env, &state.collateral_token).transfer(payer, &reserve, &fee);
        Ok(())
    }

    fn check_delay(env: &Env, staker: &Address) -> Result<(), Error> {
        if let Some(ledger) = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::MintLedger(staker.clone()))
        {
            if env
                .ledger()
                .sequence()
                .checked_sub(ledger)
                .ok_or(Error::TradeDelayActive)?
                < FEE_DELAY_LEDGERS
            {
                return Err(Error::TradeDelayActive);
            }
        }
        Ok(())
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

    /// Collateral is valued down; debt and fees are rounded up separately.
    fn mul_price(amount: i128, price_7dp: i128) -> Result<i128, Error> {
        Ok(amount.checked_mul(price_7dp).ok_or(Error::Overflow)? / PRICE_SCALE)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod proptest;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, String,
    };

    fn setup_env() -> (Env, Address, Address, Address) {
        let mut env = Env::default();
        env.set_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let staker = Address::generate(&env);

        // Deploy a native-style token as collateral
        let col_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let col_addr = col_token_id.address();

        // Initialize contract
        let contract_id = env.register_contract(None, SyntheticAssets);
        let client = SyntheticAssetsClient::new(&env, &contract_id);
        client.initialize(&admin, &col_addr);
        client.update_collateral_price(&admin, &PRICE_SCALE);

        // Mint collateral to staker
        let col_client = StellarAssetClient::new(&env, &col_addr);
        col_client.mint(&staker, &10_000_000_000); // 1,000 units (7 dp)

        (env, contract_id, admin, staker)
    }

    #[test]
    fn test_initialize_and_register_asset() {
        let (env, contract_id, admin, _staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        let oracle = Address::generate(&env);
        client.register_asset(&admin, &String::from_str(&env, "sXLM"), &oracle);

        let assets = client.list_assets();
        assert_eq!(assets.len(), 1);
    }

    #[test]
    fn test_update_and_get_price() {
        let (env, contract_id, admin, _staker) = setup_env();
        let client = SyntheticAssetsClient::new(&env, &contract_id);

        let oracle = Address::generate(&env);
        client.register_asset(&admin, &String::from_str(&env, "sXLM"), &oracle);
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
        client.register_asset(&admin, &String::from_str(&env, "sXLM"), &oracle);
        // price: $1.00 with 7 dp = 10_000_000
        client.update_price(&oracle, &String::from_str(&env, "sXLM"), &10_000_000);

        // Mint one sXLM at $1; the 400% target requires $4 collateral.
        let synth_amount = 10_000_000_i128; // 1 unit (7dp)
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

        // Burn half after the settlement delay.
        env.ledger()
            .with_mut(|l| l.sequence_number += FEE_DELAY_LEDGERS);
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

#[cfg(test)]
mod safety_tests;
