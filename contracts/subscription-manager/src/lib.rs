#![no_std]

mod storage;
#[cfg(test)]
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use crate::storage::{
    get_admin, get_plan, get_subscriber_plan_sub_id, get_subscription, next_plan_id,
    next_sub_id, remove_subscriber_plan_sub_id, set_admin, set_initialized, set_plan,
    set_subscriber_plan_sub_id, set_subscription, is_initialized,
};
use crate::types::{Error, Plan, SubStatus, Subscription};

/// Subscription Billing Manager
///
/// Allows a contract admin to create billing plans (price + interval + token)
/// and subscribers to opt in/out of recurring payments.
///
/// Billing flow:
///   1. Admin calls `create_plan`
///   2. Subscriber calls `subscribe` – first payment is collected immediately
///   3. Anyone (keeper / subscriber) calls `charge` when `next_payment_due` has passed
///   4. Subscriber can call `cancel` at any time to stop future charges
#[contract]
pub struct SubscriptionManagerContract;

#[contractimpl]
impl SubscriptionManagerContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract.  Must be called once before anything else.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    /// Transfer admin rights to a new address.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_admin(&env, &new_admin);
        Ok(())
    }

    // ── Plan management ───────────────────────────────────────────────────────

    /// Create a new billing plan.
    ///
    /// * `name`     – human-readable label stored on-chain
    /// * `price`    – amount in the token's smallest unit charged per cycle
    /// * `interval` – seconds between charges (must be > 0)
    /// * `token`    – SEP-41 token contract used for payment
    pub fn create_plan(
        env: Env,
        name: String,
        price: i128,
        interval: u64,
        token: Address,
    ) -> Result<u64, Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if price <= 0 {
            return Err(Error::InvalidAmount);
        }
        if interval == 0 {
            return Err(Error::InvalidInterval);
        }

        let plan_id = next_plan_id(&env)?;
        let plan = Plan {
            plan_id,
            name,
            price,
            interval,
            token,
            active: true,
        };
        set_plan(&env, &plan);
        Ok(plan_id)
    }

    /// Deactivate a plan so no new subscriptions can be created against it.
    /// Existing active subscriptions are unaffected.
    pub fn deactivate_plan(env: Env, plan_id: u64) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut plan = get_plan(&env, plan_id)?;
        plan.active = false;
        set_plan(&env, &plan);
        Ok(())
    }

    /// Re-activate a previously deactivated plan.
    pub fn activate_plan(env: Env, plan_id: u64) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut plan = get_plan(&env, plan_id)?;
        plan.active = true;
        set_plan(&env, &plan);
        Ok(())
    }

    // ── Subscriber actions ────────────────────────────────────────────────────

    /// Subscribe to a plan.
    ///
    /// Collects the first payment immediately from `subscriber`.
    /// Reverts if the subscriber already holds an active subscription to this plan.
    pub fn subscribe(env: Env, subscriber: Address, plan_id: u64) -> Result<u64, Error> {
        subscriber.require_auth();

        let plan = get_plan(&env, plan_id)?;
        if !plan.active {
            return Err(Error::PlanInactive);
        }

        // Prevent duplicate active subscriptions to the same plan
        if let Some(existing_id) = get_subscriber_plan_sub_id(&env, &subscriber, plan_id) {
            let existing = get_subscription(&env, existing_id)?;
            if existing.status == SubStatus::Active {
                return Err(Error::AlreadySubscribed);
            }
        }

        // Charge first cycle immediately
        let token_client = token::Client::new(&env, &plan.token);
        token_client.transfer(&subscriber, &env.current_contract_address(), &plan.price);

        let now = env.ledger().timestamp();
        let sub_id = next_sub_id(&env)?;
        let sub = Subscription {
            subscription_id: sub_id,
            plan_id,
            subscriber: subscriber.clone(),
            created_at: now,
            next_payment_due: now.checked_add(plan.interval).ok_or(Error::Overflow)?,
            cycles_paid: 1,
            status: SubStatus::Active,
        };

        set_subscription(&env, &sub);
        set_subscriber_plan_sub_id(&env, &subscriber, plan_id, sub_id);
        Ok(sub_id)
    }

    /// Cancel a subscription.  No further charges will be attempted.
    /// Can be called by the subscriber themselves OR by the admin.
    pub fn cancel(env: Env, caller: Address, subscription_id: u64) -> Result<(), Error> {
        caller.require_auth();

        let mut sub = get_subscription(&env, subscription_id)?;

        // Allow subscriber or admin to cancel
        let admin = get_admin(&env)?;
        if caller != sub.subscriber && caller != admin {
            return Err(Error::Unauthorized);
        }

        if sub.status == SubStatus::Cancelled {
            return Err(Error::SubscriptionCancelled);
        }

        sub.status = SubStatus::Cancelled;
        set_subscription(&env, &sub);
        remove_subscriber_plan_sub_id(&env, &sub.subscriber, sub.plan_id);
        Ok(())
    }

    /// Charge a subscriber for the next billing cycle.
    ///
    /// Anyone can call this (permissionless keeper model) once
    /// `next_payment_due` has been reached.  If the subscriber's token
    /// allowance / balance is insufficient the call reverts (charge should be
    /// retried later or the subscription cancelled by the keeper).
    pub fn charge(env: Env, subscription_id: u64) -> Result<(), Error> {
        let mut sub = get_subscription(&env, subscription_id)?;

        if sub.status == SubStatus::Cancelled {
            return Err(Error::SubscriptionCancelled);
        }

        let now = env.ledger().timestamp();
        if now < sub.next_payment_due {
            return Err(Error::SubscriptionNotDue);
        }

        let plan = get_plan(&env, sub.plan_id)?;

        // Pull payment from subscriber
        let token_client = token::Client::new(&env, &plan.token);
        token_client.transfer(&sub.subscriber, &env.current_contract_address(), &plan.price);

        // Advance the schedule (handles multiple missed cycles gracefully)
        let intervals_missed = (now - sub.next_payment_due) / plan.interval + 1;
        sub.next_payment_due = sub
            .next_payment_due
            .checked_add(intervals_missed.checked_mul(plan.interval).ok_or(Error::Overflow)?)
            .ok_or(Error::Overflow)?;
        sub.cycles_paid = sub
            .cycles_paid
            .checked_add(1)
            .ok_or(Error::Overflow)?;

        set_subscription(&env, &sub);
        Ok(())
    }

    /// Withdraw accumulated payments to the admin wallet.
    pub fn withdraw(env: Env, token: Address, amount: i128) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &admin, &amount);
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// Returns true if the contract has been initialised
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Get contract admin
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Get a billing plan by id
    pub fn get_plan(env: Env, plan_id: u64) -> Result<Plan, Error> {
        get_plan(&env, plan_id)
    }

    /// Get a subscription by id
    pub fn get_subscription(env: Env, subscription_id: u64) -> Result<Subscription, Error> {
        get_subscription(&env, subscription_id)
    }

    /// Look up the subscription id for a (subscriber, plan) pair
    pub fn get_subscription_id(
        env: Env,
        subscriber: Address,
        plan_id: u64,
    ) -> Option<u64> {
        get_subscriber_plan_sub_id(&env, &subscriber, plan_id)
    }

    /// Returns true when a subscription is active and its next charge is due
    pub fn is_charge_due(env: Env, subscription_id: u64) -> Result<bool, Error> {
        let sub = get_subscription(&env, subscription_id)?;
        if sub.status == SubStatus::Cancelled {
            return Ok(false);
        }
        Ok(env.ledger().timestamp() >= sub.next_payment_due)
    }
}
