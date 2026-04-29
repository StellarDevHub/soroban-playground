// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Address, Env, String,
    };

    use crate::{TokenizedReitContract, TokenizedReitContractClient};
    use crate::types::{DistributionType, Error, PropertyStatus};

    fn setup_env() -> (Env, TokenizedReitContractClient<'static>) {
        let env = Env::default();
        let contract_id = env.register_contract(None, TokenizedReitContract);
        let client = TokenizedReitContractClient::new(&env, &contract_id);
        (env, client)
    }

    fn create_addresses(env: &Env) -> (Address, Address, Address) {
        let admin = Address::generate(env);
        let investor1 = Address::generate(env);
        let investor2 = Address::generate(env);
        (admin, investor1, investor2)
    }

    fn init_contract(env: &Env, client: &TokenizedReitContractClient, admin: &Address) {
        let name = String::from_str(env, "Stellar REIT");
        let symbol = String::from_str(env, "SREIT");
        env.mock_all_auths();
        client.initialize(admin, &name, &symbol);
    }

    fn list_test_property(
        env: &Env,
        client: &TokenizedReitContractClient,
        admin: &Address,
    ) -> u32 {
        let name = String::from_str(env, "Test Property");
        let description = String::from_str(env, "A beautiful test property");
        let location = String::from_str(env, "New York, NY");
        let total_shares: u64 = 1000;
        let price_per_share: i128 = 10000000; // 1 XLM
        let total_valuation: i128 = 10000000000; // 1000 XLM
        let target_yield_bps: u32 = 500; // 5%
        let metadata_uri = String::from_str(env, "ipfs://test");

        env.mock_all_auths();
        client.list_property(
            admin,
            &name,
            &description,
            &location,
            &total_shares,
            &price_per_share,
            &total_valuation,
            &target_yield_bps,
            &metadata_uri,
        )
    }

    // ── Initialization Tests ─────────────────────────────────────────────────

    #[test]
    fn test_initialize_success() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        let name = String::from_str(&env, "Stellar REIT");
        let symbol = String::from_str(&env, "SREIT");

        env.mock_all_auths();
        client.initialize(&admin, &name, &symbol);

        assert!(client.is_initialized());
        assert_eq!(client.get_admin(), admin);
        
        let config = client.get_reit_config();
        assert_eq!(config.name, name);
        assert_eq!(config.symbol, symbol);
        assert_eq!(config.total_properties, 0);
        assert_eq!(config.platform_fee_bps, 100);
    }

    #[test]
    fn test_initialize_already_initialized() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);

        let name = String::from_str(&env, "Stellar REIT 2");
        let symbol = String::from_str(&env, "SREIT2");

        env.mock_all_auths();
        let result = client.try_initialize(&admin, &name, &symbol);
        assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
    }

    // ── Property Listing Tests ─────────────────────────────────────────────────

    #[test]
    fn test_list_property_success() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);

        let property_id = list_test_property(&env, &client, &admin);
        assert_eq!(property_id, 1);

        let property = client.get_property(&property_id);
        assert_eq!(property.name, String::from_str(&env, "Test Property"));
        assert_eq!(property.total_shares, 1000);
        assert_eq!(property.shares_sold, 0);
        assert_eq!(property.status, PropertyStatus::Listed);

        let config = client.get_reit_config();
        assert_eq!(config.total_properties, 1);
    }

    #[test]
    fn test_list_property_empty_name() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);

        let name = String::from_str(&env, "");
        let description = String::from_str(&env, "Description");
        let location = String::from_str(&env, "Location");

        env.mock_all_auths();
        let result = client.try_list_property(
            &admin,
            &name,
            &description,
            &location,
            &1000u64,
            &10000000i128,
            &10000000000i128,
            &500u32,
            &String::from_str(&env, "ipfs://test"),
        );
        assert_eq!(result, Err(Ok(Error::EmptyName)));
    }

    #[test]
    fn test_list_property_zero_shares() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);

        let name = String::from_str(&env, "Test");
        let description = String::from_str(&env, "Description");
        let location = String::from_str(&env, "Location");

        env.mock_all_auths();
        let result = client.try_list_property(
            &admin,
            &name,
            &description,
            &location,
            &0u64,
            &10000000i128,
            &10000000000i128,
            &500u32,
            &String::from_str(&env, "ipfs://test"),
        );
        assert_eq!(result, Err(Ok(Error::ZeroTotalShares)));
    }

    #[test]
    fn test_list_property_zero_price() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);

        let name = String::from_str(&env, "Test");
        let description = String::from_str(&env, "Description");
        let location = String::from_str(&env, "Location");

        env.mock_all_auths();
        let result = client.try_list_property(
            &admin,
            &name,
            &description,
            &location,
            &1000u64,
            &0i128,
            &10000000000i128,
            &500u32,
            &String::from_str(&env, "ipfs://test"),
        );
        assert_eq!(result, Err(Ok(Error::ZeroPrice)));
    }

    // ── Share Purchase Tests ─────────────────────────────────────────────────

    #[test]
    fn test_buy_shares_success() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        env.mock_all_auths();
        let cost = client.buy_shares(&investor, &property_id, &100u64);
        assert_eq!(cost, 1000000000); // 100 shares * 1 XLM

        let property = client.get_property(&property_id);
        assert_eq!(property.shares_sold, 100);

        let ownership = client.get_ownership(&investor, &property_id);
        assert_eq!(ownership.shares, 100);
    }

    #[test]
    fn test_buy_shares_zero_shares() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        env.mock_all_auths();
        let result = client.try_buy_shares(&investor, &property_id, &0u64);
        assert_eq!(result, Err(Ok(Error::ZeroShares)));
    }

    #[test]
    fn test_buy_shares_insufficient_available() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        env.mock_all_auths();
        let result = client.try_buy_shares(&investor, &property_id, &2000u64);
        assert_eq!(result, Err(Ok(Error::ExceedsTotalSupply)));
    }

    #[test]
    fn test_buy_shares_property_not_listed() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Delist property
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Delisted);

        env.mock_all_auths();
        let result = client.try_buy_shares(&investor, &property_id, &100u64);
        assert_eq!(result, Err(Ok(Error::NotForSale)));
    }

    #[test]
    fn test_buy_shares_blacklisted_investor() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Blacklist investor
        env.mock_all_auths();
        client.blacklist_investor(&admin, &investor);

        env.mock_all_auths();
        let result = client.try_buy_shares(&investor, &property_id, &100u64);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    // ── Share Transfer Tests ───────────────────────────────────────────────────

    #[test]
    fn test_transfer_shares_success() {
        let (env, client) = setup_env();
        let (admin, investor1, investor2) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Buy shares
        env.mock_all_auths();
        client.buy_shares(&investor1, &property_id, &100u64);

        // Transfer shares
        env.mock_all_auths();
        client.transfer_shares(&investor1, &investor2, &property_id, &50u64);

        let ownership1 = client.get_ownership(&investor1, &property_id);
        assert_eq!(ownership1.shares, 50);

        let ownership2 = client.get_ownership(&investor2, &property_id);
        assert_eq!(ownership2.shares, 50);
    }

    #[test]
    fn test_transfer_shares_insufficient() {
        let (env, client) = setup_env();
        let (admin, investor1, investor2) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Buy shares
        env.mock_all_auths();
        client.buy_shares(&investor1, &property_id, &100u64);

        // Try to transfer more than owned
        env.mock_all_auths();
        let result = client.try_transfer_shares(&investor1, &investor2, &property_id, &150u64);
        assert_eq!(result, Err(Ok(Error::InsufficientShares)));
    }

    // ── Dividend Tests ───────────────────────────────────────────────────────

    #[test]
    fn test_deposit_and_claim_dividends() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Buy shares
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id, &500u64); // 50% of shares

        // Activate property
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Funded);
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Active);

        // Deposit dividends
        let dividend_amount: i128 = 1000000000; // 100 XLM
        env.mock_all_auths();
        let distribution_id = client.deposit_dividends(
            &admin,
            &property_id,
            &dividend_amount,
            &DistributionType::Quarterly,
        );
        assert_eq!(distribution_id, 1);

        // Check claimable
        let claimable = client.claimable_dividends(&investor, &property_id);
        assert_eq!(claimable, 500000000); // 50% of 100 XLM = 50 XLM

        // Claim dividends
        env.mock_all_auths();
        let claimed = client.claim_dividends(&investor, &property_id);
        assert_eq!(claimed, 500000000);

        // Verify claimed
        let ownership = client.get_ownership(&investor, &property_id);
        assert_eq!(ownership.dividend_claimed, 500000000);

        // Try to claim again - should get nothing
        env.mock_all_auths();
        let result = client.try_claim_dividends(&investor, &property_id);
        assert_eq!(result, Err(Ok(Error::NothingToClaim)));
    }

    #[test]
    fn test_deposit_dividends_zero_amount() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        env.mock_all_auths();
        let result = client.try_deposit_dividends(
            &admin,
            &property_id,
            &0i128,
            &DistributionType::Quarterly,
        );
        assert_eq!(result, Err(Ok(Error::ZeroDividend)));
    }

    // ── Pause Tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_pause_and_unpause() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Pause contract
        env.mock_all_auths();
        client.pause(&admin);
        assert!(client.is_paused());

        // Try to buy shares while paused
        env.mock_all_auths();
        let result = client.try_buy_shares(&investor, &property_id, &100u64);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));

        // Unpause contract
        env.mock_all_auths();
        client.unpause(&admin);
        assert!(!client.is_paused());

        // Now buying should work
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id, &100u64);
        
        let ownership = client.get_ownership(&investor, &property_id);
        assert_eq!(ownership.shares, 100);
    }

    // ── Whitelist/Blacklist Tests ─────────────────────────────────────────────

    #[test]
    fn test_whitelist_investor() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        env.mock_all_auths();
        client.whitelist_investor(&admin, &property_id, &investor);

        assert!(client.is_whitelisted(&property_id, &investor));
    }

    #[test]
    fn test_blacklist_investor() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        
        env.mock_all_auths();
        client.blacklist_investor(&admin, &investor);

        assert!(client.is_blacklisted(&investor));
    }

    #[test]
    fn test_unblacklist_investor() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        
        env.mock_all_auths();
        client.blacklist_investor(&admin, &investor);
        assert!(client.is_blacklisted(&investor));

        env.mock_all_auths();
        client.unblacklist_investor(&admin, &investor);
        assert!(!client.is_blacklisted(&investor));
    }

    // ── Investor Stats Tests ──────────────────────────────────────────────────

    #[test]
    fn test_investor_stats() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Initial stats should be empty
        let stats = client.get_investor_stats(&investor);
        assert_eq!(stats.properties_count, 0);
        assert_eq!(stats.total_shares, 0);

        // Buy shares
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id, &100u64);

        // Check updated stats
        let stats = client.get_investor_stats(&investor);
        assert_eq!(stats.properties_count, 1);
        assert_eq!(stats.total_shares, 100);
        assert_eq!(stats.total_invested, 1000000000);
    }

    // ── Property Status Tests ──────────────────────────────────────────────────

    #[test]
    fn test_property_status_transitions() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        let property = client.get_property(&property_id);
        assert_eq!(property.status, PropertyStatus::Listed);

        // Listed -> Funded
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Funded);
        let property = client.get_property(&property_id);
        assert_eq!(property.status, PropertyStatus::Funded);

        // Funded -> Active
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Active);
        let property = client.get_property(&property_id);
        assert_eq!(property.status, PropertyStatus::Active);

        // Active -> Suspended
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Suspended);
        let property = client.get_property(&property_id);
        assert_eq!(property.status, PropertyStatus::Suspended);

        // Suspended -> Active
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id, &PropertyStatus::Active);
        let property = client.get_property(&property_id);
        assert_eq!(property.status, PropertyStatus::Active);
    }

    #[test]
    fn test_invalid_status_transition() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id = list_test_property(&env, &client, &admin);

        // Listed -> Active is invalid (must go through Funded)
        env.mock_all_auths();
        let result = client.try_update_property_status(&admin, &property_id, &PropertyStatus::Active);
        assert_eq!(result, Err(Ok(Error::InvalidStatusTransition)));
    }

    // ── Query Tests ───────────────────────────────────────────────────────────

    #[test]
    fn test_get_properties_pagination() {
        let (env, client) = setup_env();
        let (admin, _, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        
        // List multiple properties
        for _ in 0..5 {
            list_test_property(&env, &client, &admin);
        }

        let properties = client.get_properties(&0, &3);
        assert_eq!(properties.len(), 3);

        let properties = client.get_properties(&3, &3);
        assert_eq!(properties.len(), 2);
    }

    #[test]
    fn test_get_investor_properties() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id1 = list_test_property(&env, &client, &admin);
        let property_id2 = list_test_property(&env, &client, &admin);

        env.mock_all_auths();
        client.buy_shares(&investor, &property_id1, &100u64);
        
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id2, &200u64);

        let investor_props = client.get_investor_properties(&investor);
        assert_eq!(investor_props.len(), 2);
    }

    // ── Batch Operations Tests ────────────────────────────────────────────────

    #[test]
    fn test_batch_claim_dividends() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        let property_id1 = list_test_property(&env, &client, &admin);
        let property_id2 = list_test_property(&env, &client, &admin);

        // Buy shares in both properties
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id1, &500u64);
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id2, &500u64);

        // Activate properties
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id1, &PropertyStatus::Funded);
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id1, &PropertyStatus::Active);
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id2, &PropertyStatus::Funded);
        env.mock_all_auths();
        client.update_property_status(&admin, &property_id2, &PropertyStatus::Active);

        // Deposit dividends
        env.mock_all_auths();
        client.deposit_dividends(&admin, &property_id1, &1000000000i128, &DistributionType::Quarterly);
        env.mock_all_auths();
        client.deposit_dividends(&admin, &property_id2, &1000000000i128, &DistributionType::Quarterly);

        // Batch claim
        let mut property_ids = soroban_sdk::Vec::new(&env);
        property_ids.push_back(property_id1);
        property_ids.push_back(property_id2);

        env.mock_all_auths();
        let claims = client.batch_claim_dividends(&investor, &property_ids);
        
        assert_eq!(claims.len(), 2);
        // Each property: 500 shares / 1000 total = 50% of 100 XLM = 50 XLM
        assert_eq!(claims.get(0), Some(500000000i128));
        assert_eq!(claims.get(1), Some(500000000i128));
    }

    // ── Admin Transfer Tests ──────────────────────────────────────────────────

    #[test]
    fn test_transfer_admin() {
        let (env, client) = setup_env();
        let (admin, new_admin, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        assert_eq!(client.get_admin(), admin);

        env.mock_all_auths();
        client.transfer_admin(&admin, &new_admin);
        
        assert_eq!(client.get_admin(), new_admin);
    }

    // ── Property Auto-Funded Test ─────────────────────────────────────────────

    #[test]
    fn test_property_auto_funded() {
        let (env, client) = setup_env();
        let (admin, investor, _) = create_addresses(&env);

        init_contract(&env, &client, &admin);
        
        // Create property with only 100 shares
        let name = String::from_str(&env, "Small Property");
        let description = String::from_str(&env, "Description");
        let location = String::from_str(&env, "Location");
        let metadata_uri = String::from_str(&env, "ipfs://test");

        env.mock_all_auths();
        let property_id = client.list_property(
            &admin,
            &name,
            &description,
            &location,
            &100u64,
            &10000000i128,
            &1000000000i128,
            &500u32,
            &metadata_uri,
        );

        // Buy all shares
        env.mock_all_auths();
        client.buy_shares(&investor, &property_id, &100u64);

        // Property should be marked as funded
        let property = client.get_property(&property_id);
        assert_eq!(property.status, PropertyStatus::Funded);
    }
}
