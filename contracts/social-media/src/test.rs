#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

#[test]
fn test_social_media_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SocialMediaContract);
    let client = SocialMediaContractClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // Create Profile
    client.create_profile(&user1, &String::from_str(&env, "Alice"), &String::from_str(&env, "Web3 dev"));
    
    let profile = client.get_profile(&user1).unwrap();
    assert_eq!(profile.nickname, String::from_str(&env, "Alice"));

    // Create Post
    let content = String::from_str(&env, "ipfs://hash123");
    let post_id = client.create_post(&user1, &content);
    assert_eq!(post_id, 1);

    // Like Post
    client.like_post(&user2, &1);
    let post = client.get_post(&1).unwrap();
    assert_eq!(post.likes, 1);

    // Tip Post
    client.tip_post(&user2, &1, &500);
    let post = client.get_post(&1).unwrap();
    assert_eq!(post.tips_collected, 500);

    // Get Latest Feed
    let feed = client.get_latest_posts();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed.get(0).unwrap().id, 1);
}

#[test]
#[should_panic(expected = "Profile not found")]
fn test_post_without_profile() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SocialMediaContract);
    let client = SocialMediaContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    client.create_post(&user, &String::from_str(&env, "Hello world"));
}
