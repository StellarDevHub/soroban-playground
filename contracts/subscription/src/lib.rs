#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, Vec,
};

mod test;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Subscription(Address),
    Plan(u32),
    PlanCount,
    Usage(Address),
}

#[derive(Clone)]
#[contracttype]
pub struct SubscriptionPlan {
    pub id: u32,
    pub name: String,
    pub price: i128,
    pub duration: u64,
    pub features: Vec<String>,
    pub active: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct Subscription {
    pub user: Address,
    pub plan_id: u32,
    pub start_time: u64,
    pub end_time: u64,
    pub auto_renew: bool,
    pub active: bool,
    pub payments_made: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct UsageMetrics {
    pub user: Address,
    pub api_calls: u64,
    pub storage_used: u64,
    pub bandwidth: u64,
    pub last_updated: u64,
}

#[contracttype]
pub enum SubscriptionEvent {
    Subscribed(Address, u32),
    Renewed(Address, u32),
    Cancelled(Address),
    PaymentProcessed(Address, i128),
    PlanCreated(u32),
    UsageRecorded(Address, u64),
}

#[contract]
pub struct SubscriptionContract;

#[contractimpl]
impl SubscriptionContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::PlanCount, &0u32);
    }

    pub fn create_plan(
        env: Env,
        admin: Address,
        name: String,
        price: i128,
        duration: u64,
        features: Vec<String>,
    ) -> u32 {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        Self::require_not_paused(&env);

        let plan_count: u32 = env.storage().instance().get(&DataKey::PlanCount).unwrap_or(0);
        let plan_id = plan_count + 1;

        let plan = SubscriptionPlan {
            id: plan_id,
            name,
            price,
            duration,
            features,
            active: true,
        };

        env.storage().instance().set(&DataKey::Plan(plan_id), &plan);
        env.storage().instance().set(&DataKey::PlanCount, &plan_id);

        env.events()
            .publish((String::from_str(&env, "plan_created"),), plan_id);

        plan_id
    }

    pub fn subscribe(
        env: Env,
        user: Address,
        plan_id: u32,
        token: Address,
        auto_renew: bool,
    ) {
        user.require_auth();
        Self::require_not_paused(&env);

        let plan: SubscriptionPlan = env
            .storage()
            .instance()
            .get(&DataKey::Plan(plan_id))
            .expect("Plan not found");

        if !plan.active {
            panic!("Plan is not active");
        }

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&user, &contract_address, &plan.price);

        let current_time = env.ledger().timestamp();
        let subscription = Subscription {
            user: user.clone(),
            plan_id,
            start_time: current_time,
            end_time: current_time + plan.duration,
            auto_renew,
            active: true,
            payments_made: 1,
        };

        env.storage()
            .instance()
            .set(&DataKey::Subscription(user.clone()), &subscription);

        let usage = UsageMetrics {
            user: user.clone(),
            api_calls: 0,
            storage_used: 0,
            bandwidth: 0,
            last_updated: current_time,
        };
        env.storage()
            .instance()
            .set(&DataKey::Usage(user.clone()), &usage);

        env.events().publish(
            (String::from_str(&env, "subscribed"),),
            (user.clone(), plan_id),
        );
    }

    pub fn renew_subscription(env: Env, user: Address, token: Address) {
        user.require_auth();
        Self::require_not_paused(&env);

        let mut subscription: Subscription = env
            .storage()
            .instance()
            .get(&DataKey::Subscription(user.clone()))
            .expect("Subscription not found");

        let plan: SubscriptionPlan = env
            .storage()
            .instance()
            .get(&DataKey::Plan(subscription.plan_id))
            .expect("Plan not found");

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&user, &contract_address, &plan.price);

        let current_time = env.ledger().timestamp();
        subscription.end_time = current_time + plan.duration;
        subscription.payments_made += 1;
        subscription.active = true;

        env.storage()
            .instance()
            .set(&DataKey::Subscription(user.clone()), &subscription);

        env.events().publish(
            (String::from_str(&env, "renewed"),),
            (user.clone(), subscription.plan_id),
        );
    }

    pub fn cancel_subscription(env: Env, user: Address) {
        user.require_auth();

        let mut subscription: Subscription = env
            .storage()
            .instance()
            .get(&DataKey::Subscription(user.clone()))
            .expect("Subscription not found");

        subscription.auto_renew = false;
        subscription.active = false;

        env.storage()
            .instance()
            .set(&DataKey::Subscription(user.clone()), &subscription);

        env.events()
            .publish((String::from_str(&env, "cancelled"),), user.clone());
    }

    pub fn record_usage(env: Env, user: Address, api_calls: u64, storage: u64, bandwidth: u64) {
        Self::require_not_paused(&env);

        let subscription: Subscription = env
            .storage()
            .instance()
            .get(&DataKey::Subscription(user.clone()))
            .expect("Subscription not found");

        if !subscription.active {
            panic!("Subscription is not active");
        }

        let current_time = env.ledger().timestamp();
        if current_time > subscription.end_time {
            panic!("Subscription has expired");
        }

        let mut usage: UsageMetrics = env
            .storage()
            .instance()
            .get(&DataKey::Usage(user.clone()))
            .unwrap_or(UsageMetrics {
                user: user.clone(),
                api_calls: 0,
                storage_used: 0,
                bandwidth: 0,
                last_updated: current_time,
            });

        usage.api_calls += api_calls;
        usage.storage_used += storage;
        usage.bandwidth += bandwidth;
        usage.last_updated = current_time;

        env.storage()
            .instance()
            .set(&DataKey::Usage(user.clone()), &usage);

        env.events().publish(
            (String::from_str(&env, "usage_recorded"),),
            (user.clone(), api_calls),
        );
    }

    pub fn get_subscription(env: Env, user: Address) -> Option<Subscription> {
        env.storage().instance().get(&DataKey::Subscription(user))
    }

    pub fn get_plan(env: Env, plan_id: u32) -> Option<SubscriptionPlan> {
        env.storage().instance().get(&DataKey::Plan(plan_id))
    }

    pub fn get_usage(env: Env, user: Address) -> Option<UsageMetrics> {
        env.storage().instance().get(&DataKey::Usage(user))
    }

    pub fn is_active(env: Env, user: Address) -> bool {
        if let Some(subscription) = Self::get_subscription(env.clone(), user) {
            let current_time = env.ledger().timestamp();
            subscription.active && current_time <= subscription.end_time
        } else {
            false
        }
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &true);
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    fn require_admin(env: &Env, address: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        if admin != *address {
            panic!("Unauthorized: admin only");
        }
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("Contract is paused");
        }
    }
}
