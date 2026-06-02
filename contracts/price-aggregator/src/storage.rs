use crate::types::{AggregatorConfig, PriceData, SourceConfig};
use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Config,
    Sources,
    SourceConfig(Address),
    SourcePrice(Symbol, Address),
    LastAggregated(Symbol),
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_config(env: &Env, config: &AggregatorConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<AggregatorConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_sources(env: &Env, sources: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Sources, sources);
}

pub fn get_sources(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Sources)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn has_source(env: &Env, source: &Address) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::SourceConfig(source.clone()))
}

pub fn set_source_config(env: &Env, source: &Address, config: &SourceConfig) {
    env.storage()
        .instance()
        .set(&DataKey::SourceConfig(source.clone()), config);
}

pub fn get_source_config(env: &Env, source: &Address) -> Option<SourceConfig> {
    env.storage()
        .instance()
        .get(&DataKey::SourceConfig(source.clone()))
}

pub fn remove_source_config(env: &Env, source: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::SourceConfig(source.clone()));
}

pub fn clear_source_price(env: &Env, symbol: &Symbol, source: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::SourcePrice(symbol.clone(), source.clone()));
}

pub fn set_source_price(env: &Env, symbol: &Symbol, source: &Address, price_data: &PriceData) {
    env.storage()
        .instance()
        .set(&DataKey::SourcePrice(symbol.clone(), source.clone()), price_data);
}

pub fn get_source_price(env: &Env, symbol: &Symbol, source: &Address) -> Option<PriceData> {
    env.storage()
        .instance()
        .get(&DataKey::SourcePrice(symbol.clone(), source.clone()))
}

pub fn set_last_aggregated(env: &Env, symbol: &Symbol, price_data: &PriceData) {
    env.storage()
        .instance()
        .set(&DataKey::LastAggregated(symbol.clone()), price_data);
}

pub fn get_last_aggregated(env: &Env, symbol: &Symbol) -> Option<PriceData> {
    env.storage()
        .instance()
        .get(&DataKey::LastAggregated(symbol.clone()))
}

pub fn remove_last_aggregated(env: &Env, symbol: &Symbol) {
    env.storage()
        .instance()
        .remove(&DataKey::LastAggregated(symbol.clone()));
}
