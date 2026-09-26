#[cfg(test)]
mod tests {
    use crate::{SubscriptionManager, SubscriptionManagerClient, PlanId, SubscriptionId};
    use soroban_sdk::{Env, Address};

    fn create_env() -> Env {
        Env::default()
    }

    #[test]
    fn test_initialization() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        let result = client.initialize(&admin);
        assert!(result.is_ok());

        // Second initialization should fail
        let result = client.initialize(&admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_plan() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        let result = client.add_plan(
            &admin,
            &1u32,
            &name,
            &99i128,
            &30u32,
            &7u32,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_plan_invalid_price() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Free Plan");
        let result = client.add_plan(
            &admin,
            &1u32,
            &name,
            &0i128,  // Invalid: zero price
            &30u32,
            &7u32,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_add_plan_unauthorized() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let unauthorized = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        let result = client.add_plan(
            &unauthorized,
            &1u32,
            &name,
            &99i128,
            &30u32,
            &7u32,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_subscribe() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let subscriber = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        client.add_plan(&admin, &1u32, &name, &99i128, &30u32, &7u32).ok();

        let result = client.subscribe(&subscriber, &1u32);
        assert!(result.is_ok());

        let sub_id = result.unwrap();
        assert_eq!(sub_id, 0u32);
    }

    #[test]
    fn test_renew_subscription() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let subscriber = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        client.add_plan(&admin, &1u32, &name, &99i128, &30u32, &7u32).ok();

        let sub_id = client.subscribe(&subscriber, &1u32).unwrap();
        let result = client.renew(&subscriber, &sub_id);
        assert!(result.is_ok());
    }

    #[test]
    fn test_renew_unauthorized() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let subscriber = Address::random(&env);
        let unauthorized = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        client.add_plan(&admin, &1u32, &name, &99i128, &30u32, &7u32).ok();

        let sub_id = client.subscribe(&subscriber, &1u32).unwrap();
        let result = client.renew(&unauthorized, &sub_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_subscription() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let subscriber = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        client.add_plan(&admin, &1u32, &name, &99i128, &30u32, &7u32).ok();

        let sub_id = client.subscribe(&subscriber, &1u32).unwrap();
        let result = client.cancel(&subscriber, &sub_id);
        assert!(result.is_ok());
    }

    #[test]
    fn test_claim_grace_period() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let subscriber = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        client.add_plan(&admin, &1u32, &name, &99i128, &30u32, &7u32).ok();

        let sub_id = client.subscribe(&subscriber, &1u32).unwrap();
        let result = client.claim_grace_period(&subscriber, &sub_id);
        assert!(result.is_ok());

        let grace_days = result.unwrap();
        assert!(grace_days > 0);
    }

    #[test]
    fn test_get_subscription() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);
        let subscriber = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Basic Plan");
        client.add_plan(&admin, &1u32, &name, &99i128, &30u32, &7u32).ok();

        let sub_id = client.subscribe(&subscriber, &1u32).unwrap();
        let result = client.get_subscription(&sub_id);
        assert!(result.is_ok());

        let subscription = result.unwrap();
        assert_eq!(subscription.id, sub_id);
        assert_eq!(subscription.plan_id, 1u32);
    }

    #[test]
    fn test_get_plan() {
        let env = create_env();
        let client = SubscriptionManagerClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        client.initialize(&admin).ok();

        let name = soroban_sdk::String::from_str(&env, "Pro Plan");
        client.add_plan(&admin, &2u32, &name, &199i128, &30u32, &14u32).ok();

        let result = client.get_plan(&2u32);
        assert!(result.is_ok());

        let plan = result.unwrap();
        assert_eq!(plan.id, 2u32);
        assert_eq!(plan.price, 199i128);
        assert_eq!(plan.grace_period_days, 14u32);
    }
}
