#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserProfile {
    pub name: String,
    pub bio: String,
}

#[contract]
pub struct ProfileRegistry;

#[contractimpl]
impl ProfileRegistry {
    /// Sets or updates a user profile
    pub fn set_profile(env: Env, user: Address, name: String, bio: String) {
        // Require user's authorization to set their own profile
        user.require_auth();
        
        // Save profile in persistent storage associated with the user address
        env.storage().persistent().set(&user, &UserProfile { name, bio });
    }

    /// Retrieves a user profile by address
    pub fn get_profile(env: Env, user: Address) -> Option<UserProfile> {
        env.storage().persistent().get(&user)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_profile_registry() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ProfileRegistry);
        let client = ProfileRegistryClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let name = String::from_str(&env, "Alice");
        let bio = String::from_str(&env, "Blockchain Developer");

        env.mock_all_auths();

        client.set_profile(&user, &name, &bio);

        let profile = client.get_profile(&user).unwrap();
        assert_eq!(profile.name, name);
        assert_eq!(profile.bio, bio);
    }
}
