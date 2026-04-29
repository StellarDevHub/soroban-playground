#[cfg(test)]
mod tests {
    use crate::{SubscriptionContract, SubscriptionContractClient};
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SubscriptionContract);
        let client = SubscriptionContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.initialize(&admin);
    }

    #[test]
    fn test_create_plan() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SubscriptionContract);
        let client = SubscriptionContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(&admin);

        let name = String::from_str(&env, "Basic Plan");
        let features = Vec::from_array(&env, [String::from_str(&env, "Feature 1")]);
        let plan_id = client.create_plan(&admin, &name, &1000, &2592000, &features);

        assert_eq!(plan_id, 1);
    }

    #[test]
    fn test_subscribe() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SubscriptionContract);
        let client = SubscriptionContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(&admin);

        let name = String::from_str(&env, "Basic Plan");
        let features = Vec::from_array(&env, [String::from_str(&env, "Feature 1")]);
        let plan_id = client.create_plan(&admin, &name, &1000, &2592000, &features);

        let token = env.register_stellar_asset_contract(admin.clone());
        client.subscribe(&user, &plan_id, &token, &true);

        let subscription = client.get_subscription(&user);
        assert!(subscription.is_some());
        assert_eq!(subscription.unwrap().plan_id, plan_id);
    }

    #[test]
    fn test_record_usage() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SubscriptionContract);
        let client = SubscriptionContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(&admin);

        let name = String::from_str(&env, "Basic Plan");
        let features = Vec::from_array(&env, [String::from_str(&env, "Feature 1")]);
        let plan_id = client.create_plan(&admin, &name, &1000, &2592000, &features);

        let token = env.register_stellar_asset_contract(admin.clone());
        client.subscribe(&user, &plan_id, &token, &true);

        client.record_usage(&user, &100, &500, &1000);

        let usage = client.get_usage(&user);
        assert!(usage.is_some());
        assert_eq!(usage.unwrap().api_calls, 100);
    }
}
