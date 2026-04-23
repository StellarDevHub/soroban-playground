use soroban_sdk::{contracterror, contracttype, Address, String, Symbol};

/// Errors that can occur in the contract
#[contracterror]
#[derive(Clone, Copy, PartialEq)]
pub enum Error {
    // Initialization errors
    AlreadyInitialized = 1,
    NotInitialized = 2,
    
    // Authorization errors
    Unauthorized = 3,
    
    // Asset errors
    AssetAlreadyRegistered = 4,
    AssetNotRegistered = 5,
    InvalidPrice = 6,
    StalePrice = 7,
    
    // Amount errors
    InvalidAmount = 8,
    InsufficientBalance = 9,
    InsufficientCollateral = 10,
    
    // Position errors
    PositionNotFound = 11,
    PositionUndercollateralized = 12,
    PositionNotLiquidatable = 13,
    PositionAlreadyClosed = 14,
    ExcessiveRepayAmount = 15,
    
    // Liquidation errors
    NoLiquidatablePositions = 16,
    
    // Parameter errors
    InvalidCollateralRatio = 17,
    InvalidLiquidationThreshold = 18,
    InvalidLiquidationBonus = 19,
    InvalidFeePercentage = 20,
    InvalidLeverage = 21,
    
    // Trading errors
    InsufficientMargin = 22,
    PositionLiquidated = 23,
}

/// Synthetic asset structure
#[derive(Clone)]
#[contracttype]
pub struct SyntheticAsset {
    pub symbol: Symbol,
    pub name: String,
    pub decimals: u32,
    pub total_supply: i128,
}

/// Collateral position for minting synthetic assets
#[derive(Clone)]
#[contracttype]
pub struct CollateralPosition {
    pub user: Address,
    pub asset_symbol: Symbol,
    pub collateral_amount: i128,
    pub minted_amount: i128,
    pub position_id: u64,
    pub created_at: u64,
    pub last_updated: u64,
}

/// Trading position for derivatives
#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
#[repr(u32)]
pub enum TradeDirection {
    Long = 1,
    Short = 2,
}

#[derive(Clone)]
#[contracttype]
pub struct TradingPosition {
    pub user: Address,
    pub asset_symbol: Symbol,
    pub direction: TradeDirection,
    pub entry_price: i128,
    pub margin: i128,
    pub leverage: u32,
    pub notional: i128,
    pub position_id: u64,
    pub is_open: bool,
    pub created_at: u64,
}

/// Price data from oracle
#[derive(Clone)]
#[contracttype]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
    pub confidence: u32,  // 0-100 representing percentage
}

/// Protocol configuration
#[derive(Clone)]
#[contracttype]
pub struct AssetConfig {
    pub min_collateral_ratio: u32,    // Basis points (15000 = 150%)
    pub liquidation_threshold: u32,   // Basis points (12000 = 120%)
    pub liquidation_bonus: u32,       // Basis points (500 = 5%)
    pub fee_percentage: u32,          // Basis points (100 = 1%)
}

/// Instance storage keys (simple values)
#[contracttype]
pub enum InstanceKey {
    Admin,
    Oracle,
    CollateralToken,
    Initialized,
    PositionCounter,
    AssetSymbols,
    MinCollateralRatio,
    LiquidationThreshold,
    LiquidationBonus,
    FeePercentage,
}

/// Persistent storage keys (data with identifiers)
#[contracttype]
pub enum DataKey {
    SyntheticAsset(Symbol),
    CollateralPosition(u64),
    TradingPosition(u64),
    Price(Symbol),
}
