#![no_std]

mod storage;
mod types;
#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol, Vec};

use crate::storage::{self, get_admin, get_config, get_last_aggregated, get_source_config};
use crate::types::{AggregatorConfig, AggregationStrategy, AggregatorError, PriceData, SourceAddedEvent, SourceConfig, SourceRemovedEvent, PriceUpdatedEvent, WeightUpdatedEvent};

#[contract]
pub struct PriceAggregatorContract;

#[contractimpl]
impl PriceAggregatorContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        strategy: AggregationStrategy,
        min_valid_sources: u32,
        outlier_threshold_bps: u32,
        circuit_breaker_threshold_bps: u32,
    ) -> Result<(), AggregatorError> {
        if env.storage().instance().has(&storage::DataKey::Admin) {
            return Err(AggregatorError::AlreadyInitialized);
        }

        if min_valid_sources == 0 || min_valid_sources > 50 {
            return Err(AggregatorError::InvalidConfiguration);
        }
        if outlier_threshold_bps == 0 || outlier_threshold_bps > 10_000 {
            return Err(AggregatorError::InvalidConfiguration);
        }
        if circuit_breaker_threshold_bps == 0 || circuit_breaker_threshold_bps > 10_000 {
            return Err(AggregatorError::InvalidConfiguration);
        }

        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_config(
            &env,
            &AggregatorConfig {
                strategy,
                min_valid_sources,
                outlier_threshold_bps,
                circuit_breaker_threshold_bps,
            },
        );
        storage::set_sources(&env, &Vec::new(&env));
        Ok(())
    }

    pub fn add_source(env: Env, caller: Address, source: Address, weight: u32) -> Result<(), AggregatorError> {
        let config = ensure_initialized(&env)?;
        assert_admin(&env, &caller)?;
        if weight == 0 {
            return Err(AggregatorError::InvalidWeight);
        }
        if storage::has_source(&env, &source) {
            return Err(AggregatorError::SourceAlreadyRegistered);
        }

        let mut sources = storage::get_sources(&env);
        sources.push_back(source.clone());
        storage::set_sources(&env, &sources);
        storage::set_source_config(&env, &source, &SourceConfig { weight, enabled: true });
        env.events().publish((symbol_short!("SourceAdded"),), SourceAddedEvent { source, weight });
        Ok(())
    }

    pub fn remove_source(env: Env, caller: Address, source: Address) -> Result<(), AggregatorError> {
        ensure_initialized(&env)?;
        assert_admin(&env, &caller)?;
        if !storage::has_source(&env, &source) {
            return Err(AggregatorError::SourceNotFound);
        }

        let sources = storage::get_sources(&env);
        let mut filtered = Vec::new(&env);
        let mut i = 0u32;
        while i < sources.len() {
            let item = sources.get(i).unwrap();
            if item != source {
                filtered.push_back(item);
            }
            i += 1;
        }
        storage::set_sources(&env, &filtered);
        storage::remove_source_config(&env, &source);
        env.events().publish((symbol_short!("SourceRemoved"),), SourceRemovedEvent { source });
        Ok(())
    }

    pub fn set_weight(env: Env, caller: Address, source: Address, weight: u32) -> Result<(), AggregatorError> {
        ensure_initialized(&env)?;
        assert_admin(&env, &caller)?;
        if weight == 0 {
            return Err(AggregatorError::InvalidWeight);
        }
        let mut config = storage::get_source_config(&env, &source).ok_or(AggregatorError::SourceNotFound)?;
        config.weight = weight;
        storage::set_source_config(&env, &source, &config);
        env.events().publish((symbol_short!("WeightUpdated"),), WeightUpdatedEvent { source, weight });
        Ok(())
    }

    pub fn update_price(env: Env, source: Address, symbol: Symbol, price: i128) -> Result<(), AggregatorError> {
        ensure_initialized(&env)?;
        source.require_auth();
        let source_config = storage::get_source_config(&env, &source).ok_or(AggregatorError::SourceNotFound)?;
        if !source_config.enabled {
            return Err(AggregatorError::SourceNotFound);
        }
        if price <= 0 {
            return Err(AggregatorError::InvalidPrice);
        }

        let config = storage::get_config(&env).unwrap();
        match aggregate_price_with_candidate(&env, &symbol, config.strategy.clone(), Some((&source, price))) {
            Ok(aggregated) => {
                if let Some(last) = get_last_aggregated(&env, &symbol) {
                    if deviation_bps(last.price, aggregated) > config.circuit_breaker_threshold_bps {
                        return Err(AggregatorError::CircuitBreakerTriggered);
                    }
                }
                storage::set_last_aggregated(&env, &symbol, &PriceData { price: aggregated, timestamp: env.ledger().timestamp() });
            }
            Err(AggregatorError::NotEnoughSources) => {
                // Accept the price report, but do not update the aggregated result until enough sources have reported.
            }
            Err(err) => return Err(err),
        }

        storage::set_source_price(&env, &symbol, &source, &PriceData { price, timestamp: env.ledger().timestamp() });
        env.events().publish((symbol_short!("PriceUpdated"),), PriceUpdatedEvent { source, symbol, price, timestamp: env.ledger().timestamp() });
        Ok(())
    }

    pub fn get_price(env: Env, symbol: Symbol) -> Result<i128, AggregatorError> {
        let config = ensure_initialized(&env)?;
        aggregate_price(&env, &symbol, config.strategy)
    }

    pub fn get_aggregated_price(env: Env, symbol: Symbol, strategy: AggregationStrategy) -> Result<i128, AggregatorError> {
        ensure_initialized(&env)?;
        aggregate_price(&env, &symbol, strategy)
    }

    pub fn get_source_price(env: Env, source: Address, symbol: Symbol) -> Result<PriceData, AggregatorError> {
        ensure_initialized(&env)?;
        storage::get_source_price(&env, &symbol, &source).ok_or(AggregatorError::NoPriceData)
    }
}

fn ensure_initialized(env: &Env) -> Result<AggregatorConfig, AggregatorError> {
    get_admin(env)
        .ok_or(AggregatorError::NotInitialized)
        .and_then(|_| get_config(env).ok_or(AggregatorError::NotInitialized))
}

fn assert_admin(env: &Env, caller: &Address) -> Result<(), AggregatorError> {
    let admin = get_admin(env).ok_or(AggregatorError::NotInitialized)?;
    if caller != &admin {
        return Err(AggregatorError::Unauthorized);
    }
    Ok(())
}

fn aggregate_price(env: &Env, symbol: &Symbol, strategy: AggregationStrategy) -> Result<i128, AggregatorError> {
    let config = get_config(env).ok_or(AggregatorError::NotInitialized)?;
    let (prices, weights) = collect_prices(env, symbol)?;
    if prices.len() < config.min_valid_sources {
        return Err(AggregatorError::NotEnoughSources);
    }
    let mut sorted = prices.clone();
    sort_i128_vec(&mut sorted);
    let aggregated = match strategy {
        AggregationStrategy::Median => median(&sorted),
        AggregationStrategy::WeightedAverage => weighted_average(&prices, &weights),
        AggregationStrategy::TrimmedMean => trimmed_mean(&sorted),
    };
    Ok(aggregated)
}

fn aggregate_price_with_candidate(
    env: &Env,
    symbol: &Symbol,
    strategy: AggregationStrategy,
    candidate: Option<(&Address, i128)>,
) -> Result<i128, AggregatorError> {
    let config = get_config(env).ok_or(AggregatorError::NotInitialized)?;
    let (prices, weights) = collect_prices_with_candidate(env, symbol, candidate)?;
    if prices.len() < config.min_valid_sources {
        return Err(AggregatorError::NotEnoughSources);
    }
    let mut sorted = prices.clone();
    sort_i128_vec(&mut sorted);
    let candidate_price = candidate.map(|(_, price)| price);
    if let Some(new_price) = candidate_price {
        if is_outlier(&sorted, new_price, config.outlier_threshold_bps) {
            return Err(AggregatorError::OutlierDetected);
        }
    }
    let aggregated = match strategy {
        AggregationStrategy::Median => median(&sorted),
        AggregationStrategy::WeightedAverage => weighted_average(&prices, &weights),
        AggregationStrategy::TrimmedMean => trimmed_mean(&sorted),
    };
    Ok(aggregated)
}

fn collect_prices(env: &Env, symbol: &Symbol) -> Result<(Vec<i128>, Vec<u32>), AggregatorError> {
    collect_prices_with_candidate(env, symbol, None)
}

fn collect_prices_with_candidate(
    env: &Env,
    symbol: &Symbol,
    candidate: Option<(&Address, i128)>,
) -> Result<(Vec<i128>, Vec<u32>), AggregatorError> {
    let sources = storage::get_sources(env);
    let mut prices = Vec::new(env);
    let mut weights = Vec::new(env);
    let mut i = 0u32;
    while i < sources.len() {
        let source = sources.get(i).unwrap();
        if let Some(source_config) = get_source_config(env, &source) {
            if source_config.enabled && source_config.weight > 0 {
                let price = if let Some((candidate_source, candidate_price)) = candidate {
                    if *candidate_source == source {
                        candidate_price
                    } else {
                        match storage::get_source_price(env, symbol, &source) {
                            Some(data) => data.price,
                            None => {
                                i += 1;
                                continue;
                            }
                        }
                    }
                } else {
                    match storage::get_source_price(env, symbol, &source) {
                        Some(data) => data.price,
                        None => {
                            i += 1;
                            continue;
                        }
                    }
                };
                prices.push_back(price);
                weights.push_back(source_config.weight);
            }
        }
        i += 1;
    }
    Ok((prices, weights))
}

fn sort_i128_vec(values: &mut Vec<i128>) {
    let len = values.len();
    let mut i = 0u32;
    while i < len {
        let mut j = i + 1;
        while j < len {
            let a = values.get(i).unwrap();
            let b = values.get(j).unwrap();
            if b < a {
                let temp = *a;
                values.set(i, *b);
                values.set(j, temp);
            }
            j += 1;
        }
        i += 1;
    }
}

fn median(values: &Vec<i128>) -> i128 {
    let len = values.len();
    if len == 0 {
        return 0;
    }
    let mid = len / 2;
    if len % 2 == 1 {
        values.get(mid).unwrap()
    } else {
        let a = values.get(mid - 1).unwrap();
        let b = values.get(mid).unwrap();
        (a + b) / 2
    }
}

fn weighted_average(values: &Vec<i128>, weights: &Vec<u32>) -> i128 {
    let mut sum = 0i128;
    let mut total = 0u32;
    let mut i = 0u32;
    while i < values.len() {
        sum += values.get(i).unwrap() * (weights.get(i).unwrap() as i128);
        total += weights.get(i).unwrap();
        i += 1;
    }
    if total == 0 {
        0
    } else {
        sum / (total as i128)
    }
}

fn trimmed_mean(values: &Vec<i128>) -> i128 {
    let len = values.len();
    if len == 0 {
        return 0;
    }
    if len <= 2 {
        let mut sum = 0i128;
        let mut i = 0u32;
        while i < len {
            sum += values.get(i).unwrap();
            i += 1;
        }
        return sum / (len as i128);
    }
    let mut sum = 0i128;
    let mut i = 1u32;
    while i < len - 1 {
        sum += values.get(i).unwrap();
        i += 1;
    }
    sum / ((len - 2) as i128)
}

fn is_outlier(sorted_prices: &Vec<i128>, candidate_price: i128, threshold_bps: u32) -> bool {
    if sorted_prices.len() < 3 {
        return false;
    }
    let reference = median(sorted_prices);
    deviation_bps(reference, candidate_price) > threshold_bps
}

fn deviation_bps(reference: i128, candidate: i128) -> u32 {
    let diff = if candidate > reference {
        candidate - reference
    } else {
        reference - candidate
    };
    if reference == 0 {
        return 10_000;
    }
    ((diff * 10_000) / reference.abs()) as u32
}
