#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

fn setup() -> (Env, Address, ContentPublishingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ContentPublishingContract);
    let client = ContentPublishingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn end_to_end_publish_tip_subscribe_analytics() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);

    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, "Writes about Soroban"),
        &500_i128,
        &(7 * 24 * 60 * 60u64),
    );

    // free article
    let free_id = client.publish(
        &author,
        &String::from_str(&env, "Hello World"),
        &hash(&env, 1),
        &false,
    );
    assert_eq!(free_id, 1);

    // premium article
    let premium_id = client.publish(
        &author,
        &String::from_str(&env, "Premium drop"),
        &hash(&env, 2),
        &true,
    );
    assert_eq!(premium_id, 2);

    // anyone can view free
    let viewed = client.record_view(&reader, &free_id);
    assert_eq!(viewed.views, 1);

    // premium without subscription is rejected
    assert_eq!(
        client.try_record_view(&reader, &premium_id).err().unwrap().unwrap(),
        Error::PremiumRequiresSubscription
    );

    // subscribe for 2 periods
    let sub = client.subscribe(&reader, &author, &2_u32);
    assert_eq!(sub.total_paid, 1000);
    assert!(sub.expires_at > env.ledger().timestamp());

    // premium view now succeeds
    let v = client.record_view(&reader, &premium_id);
    assert_eq!(v.views, 1);

    // tip the article
    client.tip(&reader, &free_id, &250_i128);

    // like the article (idempotent per reader)
    client.like(&reader, &free_id);
    assert_eq!(
        client.try_like(&reader, &free_id).err().unwrap().unwrap(),
        Error::AlreadyLiked
    );

    // analytics rolled up
    let stats = client.get_stats(&author).unwrap();
    assert_eq!(stats.article_count, 2);
    assert_eq!(stats.total_views, 2);
    assert_eq!(stats.total_likes, 1);
    assert_eq!(stats.total_tips, 250);
    assert_eq!(stats.active_subscribers, 1);
    assert_eq!(stats.lifetime_subscribers, 1);
    assert_eq!(stats.subscription_revenue, 1000);

    let subs = client.get_subscribers(&author);
    assert_eq!(subs.len(), 1);

    // latest feed includes both
    assert_eq!(client.get_latest_articles().len(), 2);
}

#[test]
fn cannot_self_tip_or_self_subscribe() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Solo"),
        &String::from_str(&env, ""),
        &100_i128,
        &86_400u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Mine"),
        &hash(&env, 9),
        &false,
    );

    assert_eq!(
        client.try_tip(&author, &id, &10).err().unwrap().unwrap(),
        Error::SelfTipForbidden
    );
    assert_eq!(
        client.try_subscribe(&author, &author, &1u32).err().unwrap().unwrap(),
        Error::SelfSubscribeForbidden
    );
}

#[test]
fn admin_can_pause_and_unpause() {
    let (env, admin, client) = setup();
    let author = Address::generate(&env);

    client.set_paused(&admin, &true);
    assert!(client.is_paused());

    assert_eq!(
        client
            .try_register_author(
                &author,
                &String::from_str(&env, "x"),
                &String::from_str(&env, ""),
                &0,
                &1,
            )
            .err()
            .unwrap()
            .unwrap(),
        Error::Paused
    );

    client.set_paused(&admin, &false);
    client.register_author(
        &author,
        &String::from_str(&env, "x"),
        &String::from_str(&env, ""),
        &0,
        &1,
    );
    assert!(client.get_author(&author).is_some());
}

#[test]
fn non_admin_cannot_pause() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(
        client.try_set_paused(&stranger, &true).err().unwrap().unwrap(),
        Error::Unauthorized
    );
}

#[test]
fn duplicate_initialize_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin).err().unwrap().unwrap(),
        Error::AlreadyInitialized
    );
}

#[test]
fn subscription_extends_when_renewing_active() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &10_i128,
        &100u64,
    );
    let first = client.subscribe(&reader, &author, &1u32);
    let second = client.subscribe(&reader, &author, &1u32);
    assert_eq!(second.expires_at, first.expires_at + 100);
    assert_eq!(second.total_paid, 20);

    let stats = client.get_stats(&author).unwrap();
    // active_subscribers should not double-count the same renewal
    assert_eq!(stats.active_subscribers, 1);
    assert_eq!(stats.lifetime_subscribers, 1);
}

#[test]
fn premium_view_after_expiry_fails() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &10_i128,
        &100u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "P"),
        &hash(&env, 7),
        &true,
    );
    client.subscribe(&reader, &author, &1u32);
    client.record_view(&reader, &id);

    env.ledger().with_mut(|li| li.timestamp += 1_000);
    assert_eq!(
        client.try_record_view(&reader, &id).err().unwrap().unwrap(),
        Error::PremiumRequiresSubscription
    );
}
