#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};
use storage::{
    get_admin, get_plan, get_subscription, get_subscription_count, has_subscription,
    is_initialized, set_admin, set_initialized, set_plan, set_subscription, set_subscription_count,
};
use types::{DataKey, Error, Plan, Subscription, SubscriptionStatus};

pub type PlanId = u32;
pub type SubscriptionId = u32;

#[contract]
pub struct SubscriptionManager;

#[contractimpl]
impl SubscriptionManager {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn add_plan(
        env: Env,
        admin: Address,
        plan_id: PlanId,
        name: String,
        price: i128,
        billing_cycle_days: u32,
        grace_period_days: u32,
    ) -> Result<PlanId, Error> {
        admin.require_auth();
        let current_admin = get_admin(&env)?;
        if current_admin != admin {
            return Err(Error::Unauthorized);
        }

        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        if billing_cycle_days == 0 || grace_period_days == 0 {
            return Err(Error::InvalidPlan);
        }
        if name.is_empty() {
            return Err(Error::InvalidPlan);
        }

        let plan = Plan {
            id: plan_id,
            name: name.clone(),
            price,
            billing_cycle_days,
            grace_period_days,
        };

        set_plan(&env, plan_id, plan);
        env.events().publish((symbol_short!("addPlan"),), plan_id);
        Ok(plan_id)
    }

    pub fn subscribe(
        env: Env,
        subscriber: Address,
        plan_id: PlanId,
    ) -> Result<SubscriptionId, Error> {
        subscriber.require_auth();

        let plan = get_plan(&env, plan_id)?;

        let subscription_id = get_subscription_count(&env);
        let now = env.ledger().timestamp();

        let subscription = Subscription {
            id: subscription_id,
            subscriber: subscriber.clone(),
            plan_id,
            status: SubscriptionStatus::Active,
            started_at: now,
            last_renewal: now,
            next_renewal: now + (plan.billing_cycle_days as u64 * 86400),
            grace_period_until: now + (plan.grace_period_days as u64 * 86400),
        };

        set_subscription(&env, subscription_id, subscription);
        set_subscription_count(&env, subscription_id + 1);

        env.events().publish(
            (symbol_short!("subscribed"),),
            (subscription_id, subscriber, plan_id),
        );

        Ok(subscription_id)
    }

    pub fn renew(env: Env, subscriber: Address, subscription_id: SubscriptionId) -> Result<(), Error> {
        subscriber.require_auth();

        let mut subscription = get_subscription(&env, subscription_id)?;

        if subscription.subscriber != subscriber {
            return Err(Error::Unauthorized);
        }

        if subscription.status == SubscriptionStatus::Cancelled {
            return Err(Error::SubscriptionInactive);
        }

        let plan = get_plan(&env, subscription.plan_id)?;
        let now = env.ledger().timestamp();

        subscription.last_renewal = now;
        subscription.next_renewal = now + (plan.billing_cycle_days as u64 * 86400);
        subscription.status = SubscriptionStatus::Active;

        set_subscription(&env, subscription_id, subscription);

        env.events().publish(
            (symbol_short!("renewed"),),
            (subscription_id, now),
        );

        Ok(())
    }

    pub fn cancel(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
    ) -> Result<(), Error> {
        subscriber.require_auth();

        let mut subscription = get_subscription(&env, subscription_id)?;

        if subscription.subscriber != subscriber {
            return Err(Error::Unauthorized);
        }

        if subscription.status == SubscriptionStatus::Cancelled {
            return Err(Error::SubscriptionInactive);
        }

        subscription.status = SubscriptionStatus::Cancelled;
        set_subscription(&env, subscription_id, subscription.clone());

        env.events().publish(
            (symbol_short!("cancelled"),),
            (subscription_id, subscription.subscriber),
        );

        Ok(())
    }

    pub fn claim_grace_period(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
    ) -> Result<u32, Error> {
        subscriber.require_auth();

        let subscription = get_subscription(&env, subscription_id)?;

        if subscription.subscriber != subscriber {
            return Err(Error::Unauthorized);
        }

        let now = env.ledger().timestamp();
        let grace_remaining = if now < subscription.grace_period_until {
            ((subscription.grace_period_until - now) / 86400) as u32
        } else {
            0
        };

        if grace_remaining == 0 {
            return Err(Error::GracePeriodExpired);
        }

        env.events().publish(
            (symbol_short!("graced"),),
            (subscription_id, grace_remaining),
        );

        Ok(grace_remaining)
    }

    pub fn get_subscription(
        env: Env,
        subscription_id: SubscriptionId,
    ) -> Result<Subscription, Error> {
        get_subscription(&env, subscription_id)
    }

    pub fn get_plan(env: Env, plan_id: PlanId) -> Result<Plan, Error> {
        get_plan(&env, plan_id)
    }

    pub fn get_subscription_count(env: Env) -> Result<SubscriptionId, Error> {
        Ok(get_subscription_count(&env))
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }
}
