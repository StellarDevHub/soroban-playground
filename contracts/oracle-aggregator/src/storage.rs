use soroban_sdk::{Address, Env, String, Vec};
use crate::types::{DataKey, Error, Reporter};

const KEY_INITIALIZED: &str = "initialized";
const DEFAULT_MAX_PRICE_AGE: u64 = 3600;
const DEFAULT_MIN_QUORUM: u32 = 3;

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
        .map(|a: Address| a)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Admin, admin);
}

pub fn get_max_price_age(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::MaxPriceAge)
        .unwrap_or(DEFAULT_MAX_PRICE_AGE)
}

pub fn set_max_price_age(env: &Env, max_age: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::MaxPriceAge, &max_age);
}

pub fn get_min_quorum(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::MinReporterQuorum)
        .unwrap_or(DEFAULT_MIN_QUORUM)
}

pub fn set_min_quorum(env: &Env, quorum: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::MinReporterQuorum, &quorum);
}

pub fn add_reporter(env: &Env, address: &Address, assets: Vec<String>) {
    let reporter = Reporter {
        address: address.clone(),
        active: true,
        submissions: 0,
    };

    let mut reporters: Vec<Address> = env.storage()
        .persistent()
        .get(&DataKey::Reporters)
        .unwrap_or_default();

    if !reporters.iter().any(|r| r == address) {
        reporters.push_back(address.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Reporters, &reporters);
    }

    env.storage()
        .persistent()
        .set(&DataKey::ReporterAssets(address.clone()), &assets);
}

pub fn get_reporters(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Reporters)
        .unwrap_or_default()
}

pub fn store_price(env: &Env, asset_id: &String, prices: Vec<i128>, timestamp: u64) {
    let sorted = sort_prices(prices.clone());
    let median = sorted.get(sorted.len() / 2).unwrap_or(i128::MIN);
    let mut deviation = i128::MIN;

    if sorted.len() > 1 {
        for price in sorted.iter() {
            let diff = (price.unwrap_or(i128::MIN) - median).abs();
            if diff > deviation {
                deviation = diff;
            }
        }
    }

    let age = env.ledger().timestamp().saturating_sub(timestamp);
    let price_data = (median, deviation, age, sorted.len() as u32);

    env.storage()
        .persistent()
        .set(&DataKey::Price(asset_id.clone()), &price_data);
}

pub fn get_price(env: &Env, asset_id: &String) -> Result<(i128, i128, u64, u32), Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Price(asset_id.clone()))
        .ok_or(Error::AssetNotSupported)
        .map(|(m, d, a, c): (i128, i128, u64, u32)| (m, d, a, c))
}

pub fn increment_reporter_submissions(env: &Env, reporter: &Address) {
    let current: u32 = env.storage()
        .persistent()
        .get(&DataKey::ReporterAssets(reporter.clone()))
        .map(|_| 1)
        .unwrap_or(0);

    // Update reporter submission count via events
}

fn sort_prices(mut prices: Vec<i128>) -> Vec<i128> {
    for i in 0..prices.len() {
        for j in i + 1..prices.len() {
            if prices.get(i).unwrap_or(&i128::MIN) > prices.get(j).unwrap_or(&i128::MIN) {
                let tmp = prices.get(i).unwrap_or(&i128::MIN);
                prices.set(i, prices.get(j).unwrap_or(&i128::MIN));
                prices.set(j, *tmp);
            }
        }
    }
    prices
}
