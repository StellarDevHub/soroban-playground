#![cfg(test)]

use super::{ContentPublishing, ContentPublishingClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, Address, ContentPublishingClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ContentPublishing);
    let client = ContentPublishingClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (env, admin, client) = setup();
    let result = client.try_initialize(&admin);
    assert!(result.is_ok());
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let result = client.try_initialize(&admin);
    assert!(result.is_err());
}

#[test]
fn test_publish_content() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let author = Address::generate(&env);
    let title = String::from_str(&env, "abc123");
    let body = String::from_str(&env, "def456");

    let id = client.publish_content(&author, &title, &body);
    assert_eq!(id, 1);

    let content = client.get_content(&1);
    assert_eq!(content.author, author);
    assert!(content.active);
    assert_eq!(content.total_tips, 0);
}

#[test]
fn test_content_count_increments() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let author = Address::generate(&env);
    let t = String::from_str(&env, "hash1");
    let b = String::from_str(&env, "hash2");

    client.publish_content(&author, &t, &b);
    client.publish_content(&author, &t, &b);
    assert_eq!(client.get_content_count(), 2);
}

#[test]
fn test_subscribe_and_unsubscribe() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let subscriber = Address::generate(&env);
    let author = Address::generate(&env);

    client.subscribe(&subscriber, &author);
    assert!(client.get_subscription(&subscriber, &author));
    assert_eq!(client.get_subscriber_count(&author), 1);

    client.unsubscribe(&subscriber, &author);
    assert!(!client.get_subscription(&subscriber, &author));
    assert_eq!(client.get_subscriber_count(&author), 0);
}

#[test]
fn test_double_subscribe_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let subscriber = Address::generate(&env);
    let author = Address::generate(&env);

    client.subscribe(&subscriber, &author);
    let result = client.try_subscribe(&subscriber, &author);
    assert!(result.is_err());
}

#[test]
fn test_platform_stats_initial() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let stats = client.get_platform_stats();
    assert_eq!(stats.total_content, 0);
    assert_eq!(stats.total_tips, 0);
    assert_eq!(stats.total_subscriptions, 0);
}

#[test]
fn test_platform_stats_after_publish_and_subscribe() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let author = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let t = String::from_str(&env, "hash1");
    let b = String::from_str(&env, "hash2");

    client.publish_content(&author, &t, &b);
    client.subscribe(&subscriber, &author);

    let stats = client.get_platform_stats();
    assert_eq!(stats.total_content, 1);
    assert_eq!(stats.total_subscriptions, 1);
}

#[test]
fn test_remove_content() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let author = Address::generate(&env);
    let t = String::from_str(&env, "hash1");
    let b = String::from_str(&env, "hash2");

    let id = client.publish_content(&author, &t, &b);
    client.remove_content(&author, &id);

    let content = client.get_content(&id);
    assert!(!content.active);
}

#[test]
fn test_pause_blocks_publish() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    client.set_paused(&admin, &true);

    let author = Address::generate(&env);
    let t = String::from_str(&env, "hash1");
    let b = String::from_str(&env, "hash2");

    let result = client.try_publish_content(&author, &t, &b);
    assert!(result.is_err());
}
