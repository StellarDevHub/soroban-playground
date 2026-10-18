//! # Decentralized Subscription & Recurring Payment Stream Engine (Issue #1819 – SC-23)
//!
//! Supports two modes:
//!
//! 1. **Continuous streams** – token balance accrues per-second:
//!    `claimable = flow_rate * (now - last_claim_time)`
//!
//! 2. **Periodic subscriptions** – fixed amount debited every `interval` seconds,
//!    with a configurable grace period and auto-pause on insufficient balance.
//!
//! External **keepers** may trigger billing executions and earn a small fee.
//!
//! ## Note on token transfers
//! Soroban contracts cannot directly move tokens without a token contract
//! interface.  This implementation tracks balances entirely on-ledger and
//! emits events so that an off-chain indexer / token contract integration can
//! settle actual token transfers.  In production this contract would hold
//! a token allowance and call `token::transfer_from`.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
};

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/// Keeper reward in basis-points of the billed amount (50 bps = 0.5%).
const KEEPER_REWARD_BPS: i128 = 50;

/// Default grace period for a subscription with zero balance (in seconds).
const DEFAULT_GRACE_PERIOD_SECS: u64 = 86_400; // 24 h

// ────────────────────────────────────────────────────────────────────────────
// Data types
// ────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum StreamStatus {
    Active,
    Paused,
    Cancelled,
}

/// A continuous token stream.
#[contracttype]
#[derive(Clone)]
pub struct StreamData {
    pub sender: Address,
    pub recipient: Address,
    /// Tokens per second emitted by the stream.
    pub flow_rate: i128,
    /// Ledger timestamp at stream creation / last resumption.
    pub start_time: u64,
    /// Timestamp of the last time the recipient claimed.
    pub last_claim_time: u64,
    /// Total tokens deposited as stream collateral.
    pub deposit: i128,
    /// Total tokens already withdrawn by the recipient.
    pub claimed: i128,
    pub status: StreamStatus,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Paused,
    Cancelled,
}

/// A periodic subscription.
#[contracttype]
#[derive(Clone)]
pub struct SubscriptionData {
    pub subscriber: Address,
    pub recipient: Address,
    /// Amount debited per billing cycle.
    pub amount_per_period: i128,
    /// Billing interval in seconds.
    pub interval_secs: u64,
    /// Timestamp of the last successful billing.
    pub last_billed: u64,
    /// Subscriber's pre-authorised balance held in escrow.
    pub balance: i128,
    /// Grace period before auto-pause when balance is insufficient.
    pub grace_period_secs: u64,
    /// Timestamp when the subscriber first had an insufficient balance.
    pub grace_start: u64,
    pub status: SubscriptionStatus,
}

// ────────────────────────────────────────────────────────────────────────────
// Storage keys
// ────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    StreamCount,
    SubCount,
    Stream(u64),
    Sub(u64),
}

// ────────────────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────────────────

const EVT_STREAM_CREATE: Symbol = symbol_short!("str_crt");
const EVT_STREAM_CLAIM: Symbol = symbol_short!("str_clm");
const EVT_STREAM_CANCEL: Symbol = symbol_short!("str_can");
const EVT_STREAM_PAUSE: Symbol = symbol_short!("str_paus");
const EVT_SUB_CREATE: Symbol = symbol_short!("sub_crt");
const EVT_SUB_BILL: Symbol = symbol_short!("sub_bill");
const EVT_SUB_CANCEL: Symbol = symbol_short!("sub_can");
const EVT_SUB_PAUSE: Symbol = symbol_short!("sub_paus");
const EVT_KEEPER: Symbol = symbol_short!("keeper");

// ────────────────────────────────────────────────────────────────────────────
// Contract
// ────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionStream;

#[contractimpl]
impl SubscriptionStream {
    // ──────────────────────────────────────────────────────────────────────
    // Initialisation
    // ──────────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StreamCount, &0_u64);
        env.storage().instance().set(&DataKey::SubCount, &0_u64);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Continuous streams
    // ──────────────────────────────────────────────────────────────────────

    /// Create a continuous token stream.
    ///
    /// `deposit` is the total tokens locked; the stream runs until exhausted.
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        flow_rate: i128,
        deposit: i128,
    ) -> u64 {
        sender.require_auth();
        if flow_rate <= 0 {
            panic!("flow_rate must be positive");
        }
        if deposit <= 0 {
            panic!("deposit must be positive");
        }

        let now = env.ledger().timestamp();
        let id: u64 = env.storage().instance().get(&DataKey::StreamCount).unwrap_or(0);
        let stream = StreamData {
            sender: sender.clone(),
            recipient: recipient.clone(),
            flow_rate,
            start_time: now,
            last_claim_time: now,
            deposit,
            claimed: 0,
            status: StreamStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Stream(id), &stream);
        env.storage().instance().set(&DataKey::StreamCount, &(id + 1));

        env.events().publish((EVT_STREAM_CREATE,), (id, sender, recipient, flow_rate, deposit));
        id
    }

    /// Compute how many tokens are currently claimable from a stream.
    pub fn claimable_balance(env: Env, stream_id: u64) -> i128 {
        let stream: StreamData = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.status != StreamStatus::Active {
            return 0;
        }

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(stream.last_claim_time) as i128;
        let accrued = stream.flow_rate * elapsed;
        let remaining = stream.deposit - stream.claimed;
        accrued.min(remaining).max(0)
    }

    /// Recipient claims all currently accrued tokens.
    pub fn claim_stream(env: Env, stream_id: u64) -> i128 {
        let mut stream: StreamData = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.recipient.require_auth();

        if stream.status != StreamStatus::Active {
            panic!("stream is not active");
        }

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(stream.last_claim_time) as i128;
        let accrued = stream.flow_rate * elapsed;
        let remaining = stream.deposit - stream.claimed;
        let claimable = accrued.min(remaining).max(0);

        if claimable == 0 {
            panic!("nothing to claim");
        }

        stream.claimed += claimable;
        stream.last_claim_time = now;

        // Auto-cancel when deposit fully consumed
        if stream.claimed >= stream.deposit {
            stream.status = StreamStatus::Cancelled;
        }

        env.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        env.events().publish((EVT_STREAM_CLAIM,), (stream_id, claimable));
        claimable
    }

    /// Sender pauses a stream.
    pub fn pause_stream(env: Env, stream_id: u64) {
        let mut stream: StreamData = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.sender.require_auth();
        if stream.status != StreamStatus::Active {
            panic!("stream is not active");
        }

        // Settle accrued balance up to now before pausing
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(stream.last_claim_time) as i128;
        let accrued = (stream.flow_rate * elapsed).min(stream.deposit - stream.claimed);
        stream.claimed += accrued.max(0);
        stream.last_claim_time = now;
        stream.status = StreamStatus::Paused;
        env.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        env.events().publish((EVT_STREAM_PAUSE,), (stream_id,));
    }

    /// Sender resumes a paused stream.
    pub fn resume_stream(env: Env, stream_id: u64) {
        let mut stream: StreamData = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.sender.require_auth();
        if stream.status != StreamStatus::Paused {
            panic!("stream is not paused");
        }

        stream.last_claim_time = env.ledger().timestamp();
        stream.status = StreamStatus::Active;
        env.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
    }

    /// Sender cancels a stream.  Unclaimed tokens are returned to sender.
    pub fn cancel_stream(env: Env, stream_id: u64) -> i128 {
        let mut stream: StreamData = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.sender.require_auth();
        if stream.status == StreamStatus::Cancelled {
            panic!("stream already cancelled");
        }

        let refund = stream.deposit - stream.claimed;
        stream.status = StreamStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Stream(stream_id), &stream);
        env.events().publish((EVT_STREAM_CANCEL,), (stream_id, refund));
        refund
    }

    /// Fetch stream details.
    pub fn get_stream(env: Env, stream_id: u64) -> StreamData {
        env.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found")
    }

    // ──────────────────────────────────────────────────────────────────────
    // Periodic subscriptions
    // ──────────────────────────────────────────────────────────────────────

    /// Create a periodic subscription with a pre-funded balance.
    pub fn create_subscription(
        env: Env,
        subscriber: Address,
        recipient: Address,
        amount_per_period: i128,
        interval_secs: u64,
        initial_balance: i128,
    ) -> u64 {
        subscriber.require_auth();
        if amount_per_period <= 0 {
            panic!("amount_per_period must be positive");
        }
        if interval_secs == 0 {
            panic!("interval_secs must be positive");
        }
        if initial_balance < 0 {
            panic!("initial_balance must be non-negative");
        }

        let now = env.ledger().timestamp();
        let id: u64 = env.storage().instance().get(&DataKey::SubCount).unwrap_or(0);
        let sub = SubscriptionData {
            subscriber: subscriber.clone(),
            recipient: recipient.clone(),
            amount_per_period,
            interval_secs,
            last_billed: now,
            balance: initial_balance,
            grace_period_secs: DEFAULT_GRACE_PERIOD_SECS,
            grace_start: 0,
            status: SubscriptionStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Sub(id), &sub);
        env.storage().instance().set(&DataKey::SubCount, &(id + 1));

        env.events().publish(
            (EVT_SUB_CREATE,),
            (id, subscriber, recipient, amount_per_period, interval_secs),
        );
        id
    }

    /// Top up the subscriber's balance.
    pub fn top_up_subscription(env: Env, subscriber: Address, sub_id: u64, amount: i128) {
        subscriber.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let mut sub: SubscriptionData = env
            .storage()
            .persistent()
            .get(&DataKey::Sub(sub_id))
            .expect("subscription not found");
        if sub.subscriber != subscriber {
            panic!("not your subscription");
        }
        sub.balance += amount;
        // Re-activate if paused due to insufficient funds
        if sub.status == SubscriptionStatus::Paused {
            sub.status = SubscriptionStatus::Active;
            sub.grace_start = 0;
        }
        env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
    }

    /// Execute billing for a subscription.  May be called by any keeper.
    ///
    /// The keeper earns `KEEPER_REWARD_BPS` basis-points of the billed amount.
    pub fn execute_billing(env: Env, keeper: Address, sub_id: u64) -> i128 {
        keeper.require_auth();

        let mut sub: SubscriptionData = env
            .storage()
            .persistent()
            .get(&DataKey::Sub(sub_id))
            .expect("subscription not found");

        if sub.status != SubscriptionStatus::Active {
            panic!("subscription is not active");
        }

        let now = env.ledger().timestamp();
        if now < sub.last_billed + sub.interval_secs {
            panic!("billing interval not yet reached");
        }

        // Handle insufficient balance
        if sub.balance < sub.amount_per_period {
            if sub.grace_start == 0 {
                // Start grace period
                sub.grace_start = now;
                env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
                return 0;
            }
            // Grace period exceeded → auto-pause
            if now > sub.grace_start + sub.grace_period_secs {
                sub.status = SubscriptionStatus::Paused;
                env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
                env.events().publish((EVT_SUB_PAUSE,), (sub_id,));
                return 0;
            }
            return 0;
        }

        // Sufficient balance – execute billing
        sub.balance -= sub.amount_per_period;
        sub.last_billed = now;
        sub.grace_start = 0;

        // Keeper reward
        let reward = sub.amount_per_period * KEEPER_REWARD_BPS / 10_000;

        env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
        env.events().publish((EVT_SUB_BILL,), (sub_id, sub.amount_per_period));
        env.events().publish((EVT_KEEPER,), (keeper, reward));

        reward
    }

    /// Subscriber pauses their subscription.
    pub fn pause_subscription(env: Env, subscriber: Address, sub_id: u64) {
        let mut sub: SubscriptionData = env
            .storage()
            .persistent()
            .get(&DataKey::Sub(sub_id))
            .expect("subscription not found");
        sub.subscriber.require_auth();
        if sub.subscriber != subscriber {
            panic!("not your subscription");
        }
        if sub.status != SubscriptionStatus::Active {
            panic!("subscription is not active");
        }
        sub.status = SubscriptionStatus::Paused;
        env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
        env.events().publish((EVT_SUB_PAUSE,), (sub_id,));
    }

    /// Subscriber resumes a paused subscription.
    pub fn resume_subscription(env: Env, subscriber: Address, sub_id: u64) {
        let mut sub: SubscriptionData = env
            .storage()
            .persistent()
            .get(&DataKey::Sub(sub_id))
            .expect("subscription not found");
        sub.subscriber.require_auth();
        if sub.subscriber != subscriber {
            panic!("not your subscription");
        }
        if sub.status != SubscriptionStatus::Paused {
            panic!("subscription is not paused");
        }
        sub.status = SubscriptionStatus::Active;
        sub.grace_start = 0;
        env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
    }

    /// Subscriber cancels instantly, recovering remaining balance.
    pub fn cancel_subscription(env: Env, subscriber: Address, sub_id: u64) -> i128 {
        let mut sub: SubscriptionData = env
            .storage()
            .persistent()
            .get(&DataKey::Sub(sub_id))
            .expect("subscription not found");
        sub.subscriber.require_auth();
        if sub.subscriber != subscriber {
            panic!("not your subscription");
        }
        if sub.status == SubscriptionStatus::Cancelled {
            panic!("already cancelled");
        }
        let refund = sub.balance;
        sub.status = SubscriptionStatus::Cancelled;
        sub.balance = 0;
        env.storage().persistent().set(&DataKey::Sub(sub_id), &sub);
        env.events().publish((EVT_SUB_CANCEL,), (sub_id, refund));
        refund
    }

    /// Fetch subscription details.
    pub fn get_subscription(env: Env, sub_id: u64) -> SubscriptionData {
        env.storage()
            .persistent()
            .get(&DataKey::Sub(sub_id))
            .expect("subscription not found")
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup() -> (Env, SubscriptionStreamClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SubscriptionStream);
        let client = SubscriptionStreamClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client)
    }

    // ── Continuous streams ──

    #[test]
    fn test_create_stream() {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_stream(&sender, &recipient, &100, &10_000);
        assert_eq!(id, 0);
    }

    #[test]
    fn test_streaming_balance_accumulates() {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_stream(&sender, &recipient, &10, &10_000);

        // Advance 100 seconds
        env.ledger().with_mut(|l| l.timestamp += 100);

        let claimable = client.claimable_balance(&id);
        assert_eq!(claimable, 1_000); // 10 tokens/s * 100s
    }

    #[test]
    fn test_claim_stream_exact() {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_stream(&sender, &recipient, &10, &10_000);

        env.ledger().with_mut(|l| l.timestamp += 50);
        let claimed = client.claim_stream(&id);
        assert_eq!(claimed, 500); // 10 * 50

        // No additional time → nothing left to claim
        assert_eq!(client.claimable_balance(&id), 0);
    }

    #[test]
    fn test_stream_does_not_exceed_deposit() {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        // flow_rate = 100, deposit = 1000 → exhausted after 10s
        let id = client.create_stream(&sender, &recipient, &100, &1_000);

        // Advance far beyond exhaustion
        env.ledger().with_mut(|l| l.timestamp += 1_000);
        let claimable = client.claimable_balance(&id);
        assert_eq!(claimable, 1_000); // capped at deposit
    }

    #[test]
    fn test_cancel_stream_returns_refund() {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_stream(&sender, &recipient, &10, &10_000);

        env.ledger().with_mut(|l| l.timestamp += 100);
        client.claim_stream(&id); // claim 1 000

        let refund = client.cancel_stream(&id);
        assert_eq!(refund, 9_000); // 10 000 - 1 000
    }

    #[test]
    fn test_pause_resume_stream() {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_stream(&sender, &recipient, &10, &10_000);

        env.ledger().with_mut(|l| l.timestamp += 50); // 500 accrued
        client.pause_stream(&id);

        // Advance while paused – should not accrue
        env.ledger().with_mut(|l| l.timestamp += 100);
        // Claimable while paused → 0
        assert_eq!(client.claimable_balance(&id), 0);

        client.resume_stream(&id);

        // After resuming, only time after resume counts
        env.ledger().with_mut(|l| l.timestamp += 10);
        assert_eq!(client.claimable_balance(&id), 100);
    }

    // ── Periodic subscriptions ──

    #[test]
    fn test_create_subscription() {
        let (env, client) = setup();
        let subscriber = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_subscription(&subscriber, &recipient, &1_000, &86_400, &10_000);
        assert_eq!(id, 0);
        let sub = client.get_subscription(&id);
        assert_eq!(sub.balance, 10_000);
    }

    #[test]
    fn test_execute_billing_at_interval() {
        let (env, client) = setup();
        let subscriber = Address::generate(&env);
        let recipient = Address::generate(&env);
        let keeper = Address::generate(&env);
        let id = client.create_subscription(&subscriber, &recipient, &1_000, &86_400, &10_000);

        // Advance exactly one billing interval
        env.ledger().with_mut(|l| l.timestamp += 86_400);
        let reward = client.execute_billing(&keeper, &id);
        // Keeper earns 50 bps of 1000 = 5
        assert_eq!(reward, 5);

        let sub = client.get_subscription(&id);
        assert_eq!(sub.balance, 9_000);
    }

    #[test]
    #[should_panic(expected = "billing interval not yet reached")]
    fn test_execute_billing_too_early_fails() {
        let (env, client) = setup();
        let subscriber = Address::generate(&env);
        let recipient = Address::generate(&env);
        let keeper = Address::generate(&env);
        let id = client.create_subscription(&subscriber, &recipient, &1_000, &86_400, &10_000);
        env.ledger().with_mut(|l| l.timestamp += 1_000); // not enough
        client.execute_billing(&keeper, &id);
    }

    #[test]
    fn test_cancel_subscription_recovers_balance() {
        let (env, client) = setup();
        let subscriber = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_subscription(&subscriber, &recipient, &1_000, &86_400, &10_000);
        let refund = client.cancel_subscription(&subscriber, &id);
        assert_eq!(refund, 10_000);
        let sub = client.get_subscription(&id);
        assert!(matches!(sub.status, SubscriptionStatus::Cancelled));
    }

    #[test]
    fn test_insufficient_balance_autopause_after_grace() {
        let (env, client) = setup();
        let subscriber = Address::generate(&env);
        let recipient = Address::generate(&env);
        let keeper = Address::generate(&env);
        // Balance too low for billing
        let id = client.create_subscription(&subscriber, &recipient, &1_000, &86_400, &500);

        // Advance past billing interval – keeper triggers; grace period starts
        env.ledger().with_mut(|l| l.timestamp += 86_400);
        client.execute_billing(&keeper, &id);

        // Advance past grace period
        env.ledger().with_mut(|l| l.timestamp += 86_401 + DEFAULT_GRACE_PERIOD_SECS);
        // Next keeper call triggers another billing window check, then auto-pauses
        env.ledger().with_mut(|l| l.timestamp += 86_400);
        client.execute_billing(&keeper, &id);

        let sub = client.get_subscription(&id);
        assert!(matches!(sub.status, SubscriptionStatus::Paused));
    }

    #[test]
    fn test_subscriber_can_pause_and_resume() {
        let (env, client) = setup();
        let subscriber = Address::generate(&env);
        let recipient = Address::generate(&env);
        let id = client.create_subscription(&subscriber, &recipient, &1_000, &86_400, &10_000);
        client.pause_subscription(&subscriber, &id);
        let sub = client.get_subscription(&id);
        assert!(matches!(sub.status, SubscriptionStatus::Paused));
        client.resume_subscription(&subscriber, &id);
        let sub2 = client.get_subscription(&id);
        assert!(matches!(sub2.status, SubscriptionStatus::Active));
    }
}
