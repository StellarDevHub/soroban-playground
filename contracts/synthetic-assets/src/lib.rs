#![no_std]

mod collateral;
mod oracle;
mod storage;
#[cfg(test)]
mod test;
mod trading;
mod types;

use soroban_sdk::{
    contract, contractimpl, token, Address, Env, String, Symbol, Vec,
};

use crate::types::{
    AssetConfig, CollateralPosition, Error, PriceData, SyntheticAsset, TradeDirection,
    TradingPosition,
};
use crate::storage::{
    add_registered_asset_symbol, get_admin, get_collateral_position, get_collateral_token,
    get_fee_percentage, get_liquidation_bonus, get_liquidation_threshold, get_min_collateral_ratio,
    get_oracle_address, get_position_counter, get_price, get_registered_asset_symbols,
    get_synthetic_asset, get_trading_position, has_synthetic_asset, increment_position_counter,
    is_initialized, remove_collateral_position, remove_trading_position, set_admin,
    set_collateral_position, set_collateral_token, set_fee_percentage, set_initialized,
    set_liquidation_bonus, set_liquidation_threshold, set_min_collateral_ratio,
    set_oracle_address, set_position_counter, set_price, set_synthetic_asset,
    set_trading_position,
};

use crate::oracle::{
    calculate_price_deviation, get_price_internal, is_price_valid_deviation, update_price_internal,
};
use crate::collateral::{
    calculate_collateral_ratio, calculate_health_factor, calculate_liquidation_reward,
    calculate_max_mint_amount, calculate_required_collateral, is_above_liquidation_threshold,
    is_adding_collateral_safe,
};
use crate::trading::{
    calculate_effective_notional, calculate_liquidation_price, calculate_margin_requirement,
    calculate_pnl, calculate_pnl_percentage, calculate_safe_leverage, calculate_trading_fee,
    is_trade_safe, should_liquidate_trading_position,
};

/// Synthetic Assets Contract
/// 
/// This contract enables:
/// - Minting synthetic assets backed by collateral
/// - Price oracle integration for real-time asset pricing
/// - Collateralization ratio management
/// - Liquidation mechanism for undercollateralized positions
/// - Derivatives trading (long/short positions)
#[contract]
pub struct SyntheticAssetsContract;

#[contractimpl]
impl SyntheticAssetsContract {
    /// Initialize the contract with admin, oracle, and collateral token addresses
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        collateral_token: Address,
        min_collateral_ratio: u32,  // Basis points (e.g., 15000 = 150%)
        liquidation_threshold: u32, // Basis points (e.g., 12000 = 120%)
        liquidation_bonus: u32,     // Basis points (e.g., 500 = 5%)
        fee_percentage: u32,          // Basis points (e.g., 100 = 1%)
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        // Validate parameters
        if min_collateral_ratio < 10000 || min_collateral_ratio > 50000 {
            return Err(Error::InvalidCollateralRatio);
        }
        if liquidation_threshold >= min_collateral_ratio || liquidation_threshold < 10000 {
            return Err(Error::InvalidLiquidationThreshold);
        }
        if liquidation_bonus > 2000 {
            return Err(Error::InvalidLiquidationBonus);
        }
        if fee_percentage > 1000 {
            return Err(Error::InvalidFeePercentage);
        }

        set_admin(&env, &admin);
        set_oracle_address(&env, &oracle);
        set_collateral_token(&env, &collateral_token);
        set_min_collateral_ratio(&env, min_collateral_ratio);
        set_liquidation_threshold(&env, liquidation_threshold);
        set_liquidation_bonus(&env, liquidation_bonus);
        set_fee_percentage(&env, fee_percentage);
        set_initialized(&env, true);
        set_position_counter(&env, 1);

        Ok(())
    }

    /// ============ ADMIN FUNCTIONS ============

    /// Register a new synthetic asset
    pub fn register_synthetic_asset(
        env: Env,
        asset_symbol: Symbol,
        asset_name: String,
        decimals: u32,
        initial_price: i128,
    ) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if has_synthetic_asset(&env, &asset_symbol) {
            return Err(Error::AssetAlreadyRegistered);
        }

        if initial_price <= 0 {
            return Err(Error::InvalidPrice);
        }

        let asset = SyntheticAsset {
            symbol: asset_symbol.clone(),
            name: asset_name,
            decimals,
            total_supply: 0,
        };

        set_synthetic_asset(&env, &asset_symbol, &asset);
        add_registered_asset_symbol(&env, &asset_symbol);

        // Set initial price
        let price_data = PriceData {
            price: initial_price,
            timestamp: env.ledger().timestamp(),
            confidence: 100, // 100% confidence for admin-set price
        };
        set_price(&env, &asset_symbol, &price_data);

        Ok(())
    }

    /// Update price oracle address
    pub fn update_oracle(env: Env, new_oracle: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_oracle_address(&env, &new_oracle);
        Ok(())
    }

    /// Update collateral token address
    pub fn update_collateral_token(env: Env, new_token: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_collateral_token(&env, &new_token);
        Ok(())
    }

    /// Update protocol parameters
    pub fn update_protocol_params(
        env: Env,
        min_collateral_ratio: u32,
        liquidation_threshold: u32,
        liquidation_bonus: u32,
        fee_percentage: u32,
    ) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if min_collateral_ratio < 10000 || min_collateral_ratio > 50000 {
            return Err(Error::InvalidCollateralRatio);
        }
        if liquidation_threshold >= min_collateral_ratio || liquidation_threshold < 10000 {
            return Err(Error::InvalidLiquidationThreshold);
        }
        if liquidation_bonus > 2000 {
            return Err(Error::InvalidLiquidationBonus);
        }
        if fee_percentage > 1000 {
            return Err(Error::InvalidFeePercentage);
        }

        set_min_collateral_ratio(&env, min_collateral_ratio);
        set_liquidation_threshold(&env, liquidation_threshold);
        set_liquidation_bonus(&env, liquidation_bonus);
        set_fee_percentage(&env, fee_percentage);

        Ok(())
    }

    /// Update asset price (oracle-signed)
    pub fn update_price(
        env: Env,
        asset_symbol: Symbol,
        new_price: i128,
        confidence: u32,
    ) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        let oracle = get_oracle_address(&env)?;

        if admin == oracle {
            admin.require_auth();
        } else {
            oracle.require_auth();
        }

        if !has_synthetic_asset(&env, &asset_symbol) {
            return Err(Error::AssetNotRegistered);
        }

        update_price_internal(&env, &asset_symbol, new_price, confidence)
    }

    /// ============ COLLATERAL & MINTING FUNCTIONS ============

    /// Deposit collateral and mint synthetic assets
    pub fn mint_synthetic(
        env: Env,
        user: Address,
        asset_symbol: Symbol,
        collateral_amount: i128,
        mint_amount: i128,
    ) -> Result<(), Error> {
        user.require_auth();

        if !has_synthetic_asset(&env, &asset_symbol) {
            return Err(Error::AssetNotRegistered);
        }

        if collateral_amount <= 0 || mint_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let price = get_price_internal(&env, &asset_symbol)?;

        // Calculate required collateral
        let min_ratio = get_min_collateral_ratio(&env)?;
        let required_collateral = calculate_required_collateral(mint_amount, price, min_ratio)?;

        if collateral_amount < required_collateral {
            return Err(Error::InsufficientCollateral);
        }

        // Transfer collateral from user to contract
        let collateral_token = get_collateral_token(&env)?;
        let token_client = token::Client::new(&env, &collateral_token);
        token_client.transfer(&user, &env.current_contract_address(), &collateral_amount);

        // Create or update position
        let position_id = get_position_counter(&env);
        let position = CollateralPosition {
            user: user.clone(),
            asset_symbol: asset_symbol.clone(),
            collateral_amount,
            minted_amount: mint_amount,
            position_id,
            created_at: env.ledger().timestamp(),
            last_updated: env.ledger().timestamp(),
        };

        set_collateral_position(&env, position_id, &position);
        increment_position_counter(&env, 1);

        // Update total supply
        let mut asset = get_synthetic_asset(&env, &asset_symbol)?;
        asset.total_supply += mint_amount;
        set_synthetic_asset(&env, &asset_symbol, &asset);

        // Mint synthetic tokens to user (in production, this would call a token contract)
        // For this example, we track the balance internally

        Ok(())
    }

    /// Add more collateral to an existing position
    pub fn add_collateral(
        env: Env,
        user: Address,
        position_id: u64,
        additional_collateral: i128,
    ) -> Result<(), Error> {
        user.require_auth();

        if additional_collateral <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut position = get_collateral_position(&env, position_id)?;
        
        if position.user != user {
            return Err(Error::Unauthorized);
        }

        // Transfer additional collateral
        let collateral_token = get_collateral_token(&env)?;
        let token_client = token::Client::new(&env, &collateral_token);
        token_client.transfer(&user, &env.current_contract_address(), &additional_collateral);

        position.collateral_amount += additional_collateral;
        position.last_updated = env.ledger().timestamp();
        set_collateral_position(&env, position_id, &position);

        Ok(())
    }

    /// Burn synthetic assets and withdraw collateral
    pub fn burn_synthetic(
        env: Env,
        user: Address,
        position_id: u64,
        burn_amount: i128,
    ) -> Result<(), Error> {
        user.require_auth();

        if burn_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut position = get_collateral_position(&env, position_id)?;
        
        if position.user != user {
            return Err(Error::Unauthorized);
        }

        if burn_amount > position.minted_amount {
            return Err(Error::InsufficientBalance);
        }

        let price = get_price_internal(&env, &position.asset_symbol)?;

        // Calculate collateral to return
        let collateral_to_return = (burn_amount * position.collateral_amount) / position.minted_amount;

        // Update position
        position.minted_amount -= burn_amount;
        position.collateral_amount -= collateral_to_return;
        position.last_updated = env.ledger().timestamp();

        if position.minted_amount == 0 {
            // Close position
            remove_collateral_position(&env, position_id);
        } else {
            // Verify position is still safe
            let ratio = calculate_collateral_ratio(
                position.collateral_amount,
                position.minted_amount,
                price,
            )?;
            let min_ratio = get_min_collateral_ratio(&env)?;
            if ratio < min_ratio as i128 {
                return Err(Error::PositionUndercollateralized);
            }
            set_collateral_position(&env, position_id, &position);
        }

        // Update total supply
        let mut asset = get_synthetic_asset(&env, &position.asset_symbol)?;
        asset.total_supply -= burn_amount;
        set_synthetic_asset(&env, &position.asset_symbol, &asset);

        // Return collateral to user
        let collateral_token = get_collateral_token(&env)?;
        let token_client = token::Client::new(&env, &collateral_token);
        token_client.transfer(&env.current_contract_address(), &user, &collateral_to_return);

        Ok(())
    }

    /// ============ LIQUIDATION FUNCTIONS ============

    /// Liquidate an undercollateralized position
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        position_id: u64,
        repay_amount: i128,
    ) -> Result<(), Error> {
        liquidator.require_auth();

        if repay_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let position = get_collateral_position(&env, position_id)?;
        let price = get_price_internal(&env, &position.asset_symbol)?;

        // Check if position is liquidatable
        if !is_above_liquidation_threshold(&env, &position, price)? {
            return Err(Error::PositionNotLiquidatable);
        }

        if repay_amount > position.minted_amount {
            return Err(Error::ExcessiveRepayAmount);
        }

        // Calculate liquidation reward
        let bonus = get_liquidation_bonus(&env)?;
        let collateral_reward = calculate_liquidation_reward(
            repay_amount,
            price,
            position.collateral_amount,
            position.minted_amount,
            bonus,
        )?;

        // Transfer synthetic assets from liquidator to burn
        // In production, this would involve token transfers

        // Transfer collateral reward to liquidator
        let collateral_token = get_collateral_token(&env)?;
        let token_client = token::Client::new(&env, &collateral_token);
        token_client.transfer(&env.current_contract_address(), &liquidator, &collateral_reward);

        // Update position
        let mut new_position = position.clone();
        new_position.minted_amount -= repay_amount;
        new_position.collateral_amount -= collateral_reward;
        new_position.last_updated = env.ledger().timestamp();

        if new_position.minted_amount == 0 {
            remove_collateral_position(&env, position_id);
        } else {
            set_collateral_position(&env, position_id, &new_position);
        }

        // Update total supply
        let mut asset = get_synthetic_asset(&env, &position.asset_symbol)?;
        asset.total_supply -= repay_amount;
        set_synthetic_asset(&env, &position.asset_symbol, &asset);

        Ok(())
    }

    /// ============ DERIVATIVES TRADING FUNCTIONS ============

    /// Open a leveraged trading position (long or short)
    pub fn open_trade(
        env: Env,
        user: Address,
        asset_symbol: Symbol,
        direction: TradeDirection,
        margin: i128,
        leverage: u32,  // Basis points (e.g., 20000 = 2x)
    ) -> Result<u64, Error> {
        user.require_auth();

        if !has_synthetic_asset(&env, &asset_symbol) {
            return Err(Error::AssetNotRegistered);
        }

        if margin <= 0 {
            return Err(Error::InvalidAmount);
        }

        if leverage < 10000 || leverage > 100000 { // 1x to 10x
            return Err(Error::InvalidLeverage);
        }

        let price = get_price_internal(&env, &asset_symbol)?;

        let notional = (margin * leverage as i128) / 10000;
        let margin_requirement = calculate_margin_requirement(&env, notional)?;

        if margin < margin_requirement {
            return Err(Error::InsufficientMargin);
        }

        // Transfer margin from user
        let collateral_token = get_collateral_token(&env)?;
        let token_client = token::Client::new(&env, &collateral_token);
        token_client.transfer(&user, &env.current_contract_address(), &margin);

        // Create trading position
        let position_id = get_position_counter(&env);
        let position = TradingPosition {
            user: user.clone(),
            asset_symbol: asset_symbol.clone(),
            direction,
            entry_price: price,
            margin,
            leverage,
            notional,
            position_id,
            is_open: true,
            created_at: env.ledger().timestamp(),
        };

        set_trading_position(&env, position_id, &position);
        increment_position_counter(&env, 1);

        Ok(position_id)
    }

    /// Close a trading position and settle PnL
    pub fn close_trade(
        env: Env,
        user: Address,
        position_id: u64,
    ) -> Result<i128, Error> {
        user.require_auth();

        let position = get_trading_position(&env, position_id)?;
        
        if position.user != user {
            return Err(Error::Unauthorized);
        }

        if !position.is_open {
            return Err(Error::PositionAlreadyClosed);
        }

        let current_price = get_price_internal(&env, &position.asset_symbol)?;

        if should_liquidate_trading_position(&position, current_price)? {
            remove_trading_position(&env, position_id);
            return Ok(0);
        }

        let pnl = calculate_pnl(&position, current_price)?;

        // Calculate final settlement
        let final_amount = position.margin + pnl;

        if final_amount < 0 {
            // Position was liquidated - margin lost
            remove_trading_position(&env, position_id);
            return Ok(0);
        }

        // Transfer final amount to user
        let collateral_token = get_collateral_token(&env)?;
        let token_client = token::Client::new(&env, &collateral_token);
        token_client.transfer(&env.current_contract_address(), &user, &final_amount);

        // Mark position as closed
        let mut closed_position = position.clone();
        closed_position.is_open = false;
        set_trading_position(&env, position_id, &closed_position);

        Ok(final_amount)
    }

    /// ============ VIEW FUNCTIONS ============

    /// Check if contract is initialized
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Get contract admin
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Get the configured oracle address
    pub fn get_oracle(env: Env) -> Result<Address, Error> {
        get_oracle_address(&env)
    }

    /// Get the collateral token contract address
    pub fn get_collateral_token_address(env: Env) -> Result<Address, Error> {
        get_collateral_token(&env)
    }

    /// Get synthetic asset details
    pub fn get_asset(env: Env, symbol: Symbol) -> Result<SyntheticAsset, Error> {
        get_synthetic_asset(&env, &symbol)
    }

    /// Check if asset is registered
    pub fn is_asset_registered(env: Env, symbol: Symbol) -> bool {
        has_synthetic_asset(&env, &symbol)
    }

    /// Get asset price
    pub fn get_asset_price(env: Env, symbol: Symbol) -> Result<PriceData, Error> {
        get_price(&env, &symbol)
    }

    /// Get the validated live price for an asset
    pub fn get_validated_asset_price(env: Env, symbol: Symbol) -> Result<i128, Error> {
        get_price_internal(&env, &symbol)
    }

    /// Get collateral position details
    pub fn get_position(env: Env, position_id: u64) -> Result<CollateralPosition, Error> {
        get_collateral_position(&env, position_id)
    }

    /// Get trading position details
    pub fn get_trading_position_info(env: Env, position_id: u64) -> Result<TradingPosition, Error> {
        get_trading_position(&env, position_id)
    }

    /// Calculate collateral ratio for a position
    pub fn get_collateral_ratio(
        env: Env,
        position_id: u64,
    ) -> Result<i128, Error> {
        let position = get_collateral_position(&env, position_id)?;
        let price = get_price_internal(&env, &position.asset_symbol)?;

        calculate_collateral_ratio(
            position.collateral_amount,
            position.minted_amount,
            price,
        )
    }

    /// Calculate health factor for a collateralized position
    pub fn get_health_factor(env: Env, position_id: u64) -> Result<i128, Error> {
        let position = get_collateral_position(&env, position_id)?;
        let price = get_price_internal(&env, &position.asset_symbol)?;
        let liquidation_threshold = get_liquidation_threshold(&env)?;

        calculate_health_factor(
            position.collateral_amount,
            position.minted_amount,
            price,
            liquidation_threshold,
        )
    }

    /// Check if a collateral top-up would restore a healthy ratio
    pub fn is_additional_collateral_safe(
        env: Env,
        position_id: u64,
        additional_collateral: i128,
    ) -> Result<bool, Error> {
        let position = get_collateral_position(&env, position_id)?;
        let price = get_price_internal(&env, &position.asset_symbol)?;
        let min_ratio = get_min_collateral_ratio(&env)?;

        is_adding_collateral_safe(
            position.collateral_amount,
            additional_collateral,
            position.minted_amount,
            price,
            min_ratio,
        )
    }

    /// Check if a position can be liquidated
    pub fn is_liquidatable(env: Env, position_id: u64) -> Result<bool, Error> {
        let position = get_collateral_position(&env, position_id)?;
        let price = get_price_internal(&env, &position.asset_symbol)?;

        is_above_liquidation_threshold(&env, &position, price)
    }

    /// Get protocol parameters
    pub fn get_protocol_params(env: Env) -> Result<AssetConfig, Error> {
        Ok(AssetConfig {
            min_collateral_ratio: get_min_collateral_ratio(&env)?,
            liquidation_threshold: get_liquidation_threshold(&env)?,
            liquidation_bonus: get_liquidation_bonus(&env)?,
            fee_percentage: get_fee_percentage(&env)?,
        })
    }

    /// Get maximum mintable amount given collateral
    pub fn get_max_mintable(
        env: Env,
        asset_symbol: Symbol,
        collateral_amount: i128,
    ) -> Result<i128, Error> {
        if !has_synthetic_asset(&env, &asset_symbol) {
            return Err(Error::AssetNotRegistered);
        }

        let price = get_price_internal(&env, &asset_symbol)?;

        calculate_max_mint_amount(&env, collateral_amount, price)
    }

    /// Calculate trading PnL for a position
    pub fn get_trading_pnl(env: Env, position_id: u64) -> Result<i128, Error> {
        let position = get_trading_position(&env, position_id)?;
        
        if !position.is_open {
            return Err(Error::PositionAlreadyClosed);
        }

        let current_price = get_price_internal(&env, &position.asset_symbol)?;

        calculate_pnl(&position, current_price)
    }

    /// Calculate the current liquidation price for a trade
    pub fn get_trading_liquidation_price(env: Env, position_id: u64) -> Result<i128, Error> {
        let position = get_trading_position(&env, position_id)?;
        calculate_liquidation_price(&position)
    }

    /// Check whether a trade remains safe at the current oracle price
    pub fn is_trade_position_safe(env: Env, position_id: u64) -> Result<bool, Error> {
        let position = get_trading_position(&env, position_id)?;
        let current_price = get_price_internal(&env, &position.asset_symbol)?;
        is_trade_safe(&env, &position, current_price)
    }

    /// Calculate current PnL as a percentage of margin, in basis points
    pub fn get_trading_pnl_percentage(env: Env, position_id: u64) -> Result<i128, Error> {
        let position = get_trading_position(&env, position_id)?;
        let current_price = get_price_internal(&env, &position.asset_symbol)?;
        calculate_pnl_percentage(&position, current_price)
    }

    /// Estimate trading fee for a given notional amount
    pub fn estimate_trading_fee(env: Env, notional: i128) -> Result<i128, Error> {
        calculate_trading_fee(&env, notional)
    }

    /// Estimate effective notional after fees for a given margin and leverage
    pub fn estimate_effective_notional(
        env: Env,
        margin: i128,
        leverage: u32,
    ) -> Result<i128, Error> {
        calculate_effective_notional(&env, margin, leverage)
    }

    /// Return a conservative leverage suggestion from annualized volatility
    pub fn get_safe_leverage(_env: Env, volatility: u32) -> u32 {
        calculate_safe_leverage(volatility)
    }

    /// Calculate price deviation against the current oracle price in basis points
    pub fn get_price_deviation_bps(
        env: Env,
        asset_symbol: Symbol,
        new_price: i128,
    ) -> Result<u32, Error> {
        let current_price = get_price_internal(&env, &asset_symbol)?;
        Ok(calculate_price_deviation(current_price, new_price))
    }

    /// Check if a proposed price update is within a maximum deviation bound
    pub fn is_price_deviation_valid(
        env: Env,
        asset_symbol: Symbol,
        new_price: i128,
        max_deviation_bps: u32,
    ) -> Result<bool, Error> {
        let current_price = get_price_internal(&env, &asset_symbol)?;
        Ok(is_price_valid_deviation(
            current_price,
            new_price,
            max_deviation_bps,
        ))
    }

    /// Get list of all registered synthetic assets
    pub fn get_registered_assets(env: Env) -> Result<Vec<Symbol>, Error> {
        Ok(get_registered_asset_symbols(&env))
    }
}
