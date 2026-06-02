use soroban_sdk::{contracterror, contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum AggregationStrategy {
    Median,
    WeightedAverage,
    TrimmedMean,
}

#[contracttype]
#[derive(Clone)]
pub struct AggregatorConfig {
    pub strategy: AggregationStrategy,
    pub min_valid_sources: u32,
    pub outlier_threshold_bps: u32,
    pub circuit_breaker_threshold_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct SourceConfig {
    pub weight: u32,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct SourceAddedEvent {
    pub source: Address,
    pub weight: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct SourceRemovedEvent {
    pub source: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct WeightUpdatedEvent {
    pub source: Address,
    pub weight: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PriceUpdatedEvent {
    pub source: Address,
    pub symbol: Symbol,
    pub price: i128,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AggregatorError {
    Unauthorized,
    AlreadyInitialized,
    NotInitialized,
    InvalidConfiguration,
    SourceAlreadyRegistered,
    SourceNotFound,
    InvalidWeight,
    InvalidPrice,
    NoPriceData,
    NotEnoughSources,
    OutlierDetected,
    CircuitBreakerTriggered,
}
