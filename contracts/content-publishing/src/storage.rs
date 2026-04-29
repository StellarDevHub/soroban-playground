use soroban_sdk::{Address, Env, Symbol};

use crate::types::{Content, Error, PlatformStats, Subscription};

const ADMIN_KEY: &str = "admin";
const PAUSED_KEY: &str = "paused";
const CONTENT_COUNT_KEY: &str = "c_count";
const STATS_KEY: &str = "stats";

fn content_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &soroban_sdk::format!(env, "c_{}", id))
}

fn subscription_key(env: &Env, subscriber: &Address, author: &Address) -> (Symbol, Address, Address) {
    (Symbol::new(env, "sub"), subscriber.clone(), author.clone())
}

fn author_sub_count_key(env: &Env, author: &Address) -> (Symbol, Address) {
    (Symbol::new(env, "sub_cnt"), author.clone())
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .has(&Symbol::new(env, ADMIN_KEY))
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, ADMIN_KEY), admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, ADMIN_KEY))
        .ok_or(Error::NotInitialized)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&Symbol::new(env, PAUSED_KEY))
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, PAUSED_KEY), &paused);
}

pub fn next_content_id(env: &Env) -> u32 {
    let count: u32 = env
        .storage()
        .instance()
        .get(&Symbol::new(env, CONTENT_COUNT_KEY))
        .unwrap_or(0u32)
        + 1;
    env.storage()
        .instance()
        .set(&Symbol::new(env, CONTENT_COUNT_KEY), &count);
    count
}

pub fn get_content_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, CONTENT_COUNT_KEY))
        .unwrap_or(0u32)
}

pub fn save_content(env: &Env, content: &Content) {
    env.storage()
        .persistent()
        .set(&content_key(env, content.id), content);
}

pub fn load_content(env: &Env, id: u32) -> Result<Content, Error> {
    env.storage()
        .persistent()
        .get(&content_key(env, id))
        .ok_or(Error::ContentNotFound)
}

pub fn save_subscription(env: &Env, sub: &Subscription) {
    let key = subscription_key(env, &sub.subscriber, &sub.author);
    env.storage().persistent().set(&key, sub);
}

pub fn load_subscription(
    env: &Env,
    subscriber: &Address,
    author: &Address,
) -> Option<Subscription> {
    let key = subscription_key(env, subscriber, author);
    env.storage().persistent().get(&key)
}

pub fn get_author_sub_count(env: &Env, author: &Address) -> u32 {
    let key = author_sub_count_key(env, author);
    env.storage().persistent().get(&key).unwrap_or(0u32)
}

pub fn set_author_sub_count(env: &Env, author: &Address, count: u32) {
    let key = author_sub_count_key(env, author);
    env.storage().persistent().set(&key, &count);
}

pub fn get_stats(env: &Env) -> PlatformStats {
    env.storage()
        .instance()
        .get(&Symbol::new(env, STATS_KEY))
        .unwrap_or(PlatformStats {
            total_content: 0,
            total_tips: 0,
            total_subscriptions: 0,
        })
}

pub fn set_stats(env: &Env, stats: &PlatformStats) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, STATS_KEY), stats);
}
