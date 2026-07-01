use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Plan, Subscription};

// ── Initialisation ──────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&InstanceKey::Initialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&InstanceKey::Initialized, &true);
}

// ── Admin ────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

// ── Counters ─────────────────────────────────────────────────────────────────

pub fn next_plan_id(env: &Env) -> Result<u64, Error> {
    let id: u64 = env
        .storage()
        .instance()
        .get(&InstanceKey::PlanCounter)
        .unwrap_or(1u64);
    let next = id.checked_add(1).ok_or(Error::Overflow)?;
    env.storage()
        .instance()
        .set(&InstanceKey::PlanCounter, &next);
    Ok(id)
}

pub fn next_sub_id(env: &Env) -> Result<u64, Error> {
    let id: u64 = env
        .storage()
        .instance()
        .get(&InstanceKey::SubCounter)
        .unwrap_or(1u64);
    let next = id.checked_add(1).ok_or(Error::Overflow)?;
    env.storage()
        .instance()
        .set(&InstanceKey::SubCounter, &next);
    Ok(id)
}

// ── Plans ────────────────────────────────────────────────────────────────────

pub fn get_plan(env: &Env, plan_id: u64) -> Result<Plan, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Plan(plan_id))
        .ok_or(Error::PlanNotFound)
}

pub fn set_plan(env: &Env, plan: &Plan) {
    env.storage()
        .persistent()
        .set(&DataKey::Plan(plan.plan_id), plan);
}

#[allow(dead_code)]
pub fn has_plan(env: &Env, plan_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Plan(plan_id))
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

pub fn get_subscription(env: &Env, sub_id: u64) -> Result<Subscription, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Subscription(sub_id))
        .ok_or(Error::SubscriptionNotFound)
}

pub fn set_subscription(env: &Env, sub: &Subscription) {
    env.storage()
        .persistent()
        .set(&DataKey::Subscription(sub.subscription_id), sub);
}

/// Returns the subscription id for a (subscriber, plan) pair if one exists
pub fn get_subscriber_plan_sub_id(
    env: &Env,
    subscriber: &Address,
    plan_id: u64,
) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriberPlan(subscriber.clone(), plan_id))
}

pub fn set_subscriber_plan_sub_id(env: &Env, subscriber: &Address, plan_id: u64, sub_id: u64) {
    env.storage().persistent().set(
        &DataKey::SubscriberPlan(subscriber.clone(), plan_id),
        &sub_id,
    );
}

pub fn remove_subscriber_plan_sub_id(env: &Env, subscriber: &Address, plan_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::SubscriberPlan(subscriber.clone(), plan_id));
}
