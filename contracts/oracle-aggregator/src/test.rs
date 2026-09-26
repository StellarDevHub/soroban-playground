#[cfg(test)]
mod tests {
    use crate::{OracleAggregator, OracleAggregatorClient};
    use soroban_sdk::{Env, String, Vec, Address};

    fn create_env() -> Env {
        Env::default()
    }

    fn create_admin_and_reporters(
        env: &Env,
    ) -> (
        Address,
        Address,
        Address,
        Address,
    ) {
        let admin = Address::random(env);
        let reporter1 = Address::random(env);
        let reporter2 = Address::random(env);
        let reporter3 = Address::random(env);
        (admin, reporter1, reporter2, reporter3)
    }

    #[test]
    fn test_initialization() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        let result = client.initialize(
            &admin,
            &Some(3600u64),
            &Some(3u32),
        );
        assert!(result.is_ok());

        // Second initialization should fail
        let result = client.initialize(
            &admin,
            &Some(3600u64),
            &Some(3u32),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_add_reporter() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, reporter1, _, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let mut assets = Vec::new(&env);
        assets.push_back(String::from_str(&env, "weather"));
        assets.push_back(String::from_str(&env, "supply-chain"));

        let result = client.add_reporter(&admin, &reporter1, &assets);
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_reporter_unauthorized() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, reporter1, unauthorized, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let mut assets = Vec::new(&env);
        assets.push_back(String::from_str(&env, "weather"));

        let result = client.add_reporter(&unauthorized, &reporter1, &assets);
        assert!(result.is_err());
    }

    #[test]
    fn test_submit_price_valid() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, reporter1, _, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let mut assets = Vec::new(&env);
        assets.push_back(String::from_str(&env, "ETH"));
        client.add_reporter(&admin, &reporter1, &assets).ok();

        let asset_id = String::from_str(&env, "ETH");
        let price = 2000i128;
        let timestamp = env.ledger().timestamp();

        let result = client.submit_price(
            &reporter1,
            &asset_id,
            &price,
            &timestamp,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_submit_price_invalid_price() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, reporter1, _, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let mut assets = Vec::new(&env);
        assets.push_back(String::from_str(&env, "ETH"));
        client.add_reporter(&admin, &reporter1, &assets).ok();

        let asset_id = String::from_str(&env, "ETH");
        let price = -100i128;  // Invalid: negative price
        let timestamp = env.ledger().timestamp();

        let result = client.submit_price(
            &reporter1,
            &asset_id,
            &price,
            &timestamp,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_submit_price_future_timestamp() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, reporter1, _, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let mut assets = Vec::new(&env);
        assets.push_back(String::from_str(&env, "ETH"));
        client.add_reporter(&admin, &reporter1, &assets).ok();

        let asset_id = String::from_str(&env, "ETH");
        let price = 2000i128;
        let future_timestamp = env.ledger().timestamp() + 1000;

        let result = client.submit_price(
            &reporter1,
            &asset_id,
            &price,
            &future_timestamp,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_set_max_price_age() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let result = client.set_max_price_age(&admin, &7200u64);
        assert!(result.is_ok());

        let new_age = client.get_max_price_age().unwrap();
        assert_eq!(new_age, 7200u64);
    }

    #[test]
    fn test_set_max_price_age_unauthorized() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, unauthorized, _, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let result = client.set_max_price_age(&unauthorized, &7200u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_set_min_quorum() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let result = client.set_min_quorum(&admin, &5u32);
        assert!(result.is_ok());

        let new_quorum = client.get_min_quorum().unwrap();
        assert_eq!(new_quorum, 5u32);
    }

    #[test]
    fn test_set_min_quorum_zero() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let admin = Address::random(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let result = client.set_min_quorum(&admin, &0u32);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_reporters() {
        let env = create_env();
        let client = OracleAggregatorClient::new(&env, &Address::random(&env));
        let (admin, reporter1, reporter2, _) = create_admin_and_reporters(&env);

        client.initialize(&admin, &Some(3600u64), &Some(3u32)).ok();

        let mut assets = Vec::new(&env);
        assets.push_back(String::from_str(&env, "weather"));

        client.add_reporter(&admin, &reporter1, &assets).ok();
        client.add_reporter(&admin, &reporter2, &assets).ok();

        let reporters = client.get_reporters().unwrap();
        assert_eq!(reporters.len(), 2);
    }
}
