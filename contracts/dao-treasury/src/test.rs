#[cfg(test)]
mod tests {
    use crate::{DaoTreasuryContract, DaoTreasuryContractClient};
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DaoTreasuryContract);
        let client = DaoTreasuryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);

        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        signers.push_back(signer1);
        signers.push_back(signer2);
        signers.push_back(signer3);

        client.initialize(&admin, &signers, &2);

        assert_eq!(client.get_threshold(), 2);
        assert_eq!(client.get_signers().len(), 3);
    }

    #[test]
    fn test_create_proposal() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DaoTreasuryContract);
        let client = DaoTreasuryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let recipient = Address::generate(&env);

        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2);

        client.initialize(&admin, &signers, &2);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        let description = String::from_str(&env, "Test proposal");

        let proposal_id = client.create_proposal(
            &signer1,
            &recipient,
            &1000,
            &token.address(),
            &description,
            &86400,
        );

        assert_eq!(proposal_id, 1);

        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.amount, 1000);
        assert_eq!(proposal.executed, false);
        assert_eq!(proposal.signatures.len(), 1);
    }

    #[test]
    fn test_sign_and_execute_proposal() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DaoTreasuryContract);
        let client = DaoTreasuryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let recipient = Address::generate(&env);

        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        client.initialize(&admin, &signers, &2);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        let description = String::from_str(&env, "Test proposal");

        let proposal_id = client.create_proposal(
            &signer1,
            &recipient,
            &1000,
            &token.address(),
            &description,
            &86400,
        );

        client.sign_proposal(&signer2, &proposal_id);

        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.signatures.len(), 2);
    }

    #[test]
    fn test_add_remove_signer() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DaoTreasuryContract);
        let client = DaoTreasuryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let new_signer = Address::generate(&env);

        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        client.initialize(&admin, &signers, &2);

        client.add_signer(&admin, &new_signer);
        assert_eq!(client.get_signers().len(), 3);

        client.remove_signer(&admin, &new_signer);
        assert_eq!(client.get_signers().len(), 2);
    }

    #[test]
    fn test_update_threshold() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DaoTreasuryContract);
        let client = DaoTreasuryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);

        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        signers.push_back(signer1);
        signers.push_back(signer2);
        signers.push_back(signer3);

        client.initialize(&admin, &signers, &2);

        client.update_threshold(&admin, &3);
        assert_eq!(client.get_threshold(), 3);
    }
}
