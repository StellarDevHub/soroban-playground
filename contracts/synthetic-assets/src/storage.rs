use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::types::{
    CollateralPosition, DataKey, Error, InstanceKey, PriceData, SyntheticAsset, TradingPosition,
};

/// ============ ADMIN & CONFIG STORAGE ============

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Initialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env, value: bool) {
    env.storage().instance().set(&InstanceKey::Initialized, &value);
}

pub fn get_oracle_address(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Oracle)
        .ok_or(Error::NotInitialized)
}

pub fn set_oracle_address(env: &Env, oracle: &Address) {
    env.storage().instance().set(&InstanceKey::Oracle, oracle);
}

pub fn get_collateral_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::CollateralToken)
        .ok_or(Error::NotInitialized)
}

pub fn set_collateral_token(env: &Env, token: &Address) {
    env.storage().instance().set(&InstanceKey::CollateralToken, token);
}

/// ============ PROTOCOL PARAMETERS ============

pub fn get_min_collateral_ratio(env: &Env) -> Result<u32, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::MinCollateralRatio)
        .ok_or(Error::NotInitialized)
}

pub fn set_min_collateral_ratio(env: &Env, ratio: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::MinCollateralRatio, &ratio);
}

pub fn get_liquidation_threshold(env: &Env) -> Result<u32, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::LiquidationThreshold)
        .ok_or(Error::NotInitialized)
}

pub fn set_liquidation_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::LiquidationThreshold, &threshold);
}

pub fn get_liquidation_bonus(env: &Env) -> Result<u32, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::LiquidationBonus)
        .ok_or(Error::NotInitialized)
}

pub fn set_liquidation_bonus(env: &Env, bonus: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::LiquidationBonus, &bonus);
}

pub fn get_fee_percentage(env: &Env) -> Result<u32, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::FeePercentage)
        .ok_or(Error::NotInitialized)
}

pub fn set_fee_percentage(env: &Env, fee: u32) {
    env.storage().instance().set(&InstanceKey::FeePercentage, &fee);
}

/// ============ POSITION COUNTER ============

pub fn get_position_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::PositionCounter)
        .unwrap_or(1)
}

pub fn increment_position_counter(env: &Env, amount: u64) {
    let current = get_position_counter(env);
    env.storage()
        .instance()
        .set(&InstanceKey::PositionCounter, &(current + amount));
}

pub fn set_position_counter(env: &Env, value: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::PositionCounter, &value);
}

/// ============ SYNTHETIC ASSETS ============

pub fn has_synthetic_asset(env: &Env, symbol: &Symbol) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::SyntheticAsset(symbol.clone()))
}

pub fn get_synthetic_asset(env: &Env, symbol: &Symbol) -> Result<SyntheticAsset, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::SyntheticAsset(symbol.clone()))
        .ok_or(Error::AssetNotRegistered)
}

pub fn set_synthetic_asset(env: &Env, symbol: &Symbol, asset: &SyntheticAsset) {
    env.storage()
        .persistent()
        .set(&DataKey::SyntheticAsset(symbol.clone()), asset);
}

pub fn get_registered_asset_symbols(env: &Env) -> Vec<Symbol> {
    env.storage()
        .instance()
        .get(&InstanceKey::AssetSymbols)
        .unwrap_or(Vec::new(env))
}

pub fn add_registered_asset_symbol(env: &Env, symbol: &Symbol) {
    let mut symbols = get_registered_asset_symbols(env);
    symbols.push_back(symbol.clone());
    env.storage()
        .instance()
        .set(&InstanceKey::AssetSymbols, &symbols);
}

/// ============ COLLATERAL POSITIONS ============

pub fn get_collateral_position(
    env: &Env,
    position_id: u64,
) -> Result<CollateralPosition, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::CollateralPosition(position_id))
        .ok_or(Error::PositionNotFound)
}

pub fn set_collateral_position(
    env: &Env,
    position_id: u64,
    position: &CollateralPosition,
) {
    env.storage()
        .persistent()
        .set(&DataKey::CollateralPosition(position_id), position);
}

pub fn remove_collateral_position(env: &Env, position_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::CollateralPosition(position_id));
}

/// ============ TRADING POSITIONS ============

pub fn get_trading_position(
    env: &Env,
    position_id: u64,
) -> Result<TradingPosition, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::TradingPosition(position_id))
        .ok_or(Error::PositionNotFound)
}

pub fn set_trading_position(env: &Env, position_id: u64, position: &TradingPosition) {
    env.storage()
        .persistent()
        .set(&DataKey::TradingPosition(position_id), position);
}

pub fn remove_trading_position(env: &Env, position_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::TradingPosition(position_id));
}

/// ============ PRICE ORACLE ============

pub fn get_price(env: &Env, symbol: &Symbol) -> Result<PriceData, Error> {
    env.storage()
        .temporary()
        .get(&DataKey::Price(symbol.clone()))
        .ok_or(Error::InvalidPrice)
}

pub fn set_price(env: &Env, symbol: &Symbol, price_data: &PriceData) {
    // Store with TTL to ensure prices are fresh
    env.storage()
        .temporary()
        .set(&DataKey::Price(symbol.clone()), price_data);
}
