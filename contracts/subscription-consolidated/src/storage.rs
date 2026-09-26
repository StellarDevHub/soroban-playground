use soroban_sdk::{Address, Env, Symbol};
use crate::types::{Error, Plan, Subscription, PlanId, SubscriptionId};

pub enum StorageKey {
    Admin,
    Initialized,
    SubscriptionCount,
    Plan(PlanId),
    Subscription(SubscriptionId),
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .persistent()
        .has(&StorageKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .persistent()
        .set(&StorageKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .persistent()
        .get(&StorageKey::Admin)
        .ok_or(Error::NotInitialized)
        .map(|a: Address| a)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .persistent()
        .set(&StorageKey::Admin, admin);
}

pub fn get_plan(env: &Env, plan_id: PlanId) -> Result<Plan, Error> {
    env.storage()
        .persistent()
        .get(&StorageKey::Plan(plan_id))
        .ok_or(Error::PlanNotFound)
        .map(|p: Plan| p)
}

pub fn set_plan(env: &Env, plan_id: PlanId, plan: Plan) {
    env.storage()
        .persistent()
        .set(&StorageKey::Plan(plan_id), &plan);
}

pub fn get_subscription(env: &Env, subscription_id: SubscriptionId) -> Result<Subscription, Error> {
    env.storage()
        .persistent()
        .get(&StorageKey::Subscription(subscription_id))
        .ok_or(Error::SubscriptionNotFound)
        .map(|s: Subscription| s)
}

pub fn set_subscription(env: &Env, subscription_id: SubscriptionId, subscription: Subscription) {
    env.storage()
        .persistent()
        .set(&StorageKey::Subscription(subscription_id), &subscription);
}

pub fn has_subscription(env: &Env, subscription_id: SubscriptionId) -> bool {
    env.storage()
        .persistent()
        .has(&StorageKey::Subscription(subscription_id))
}

pub fn get_subscription_count(env: &Env) -> SubscriptionId {
    env.storage()
        .persistent()
        .get(&StorageKey::SubscriptionCount)
        .unwrap_or(0u32)
}

pub fn set_subscription_count(env: &Env, count: SubscriptionId) {
    env.storage()
        .persistent()
        .set(&StorageKey::SubscriptionCount, &count);
}
