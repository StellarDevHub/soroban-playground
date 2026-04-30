#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, SocialMediaContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SocialMediaContract);
    let client = SocialMediaContractClient::new(&env, &id);
    (env, client)
}

// ── Profile ────────────────────────────────────────────────────────────────

#[test]
fn test_create_profile() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    client.create_profile(&user, &String::from_str(&env, "Alice"), &String::from_str(&env, "Web3 dev"));
    let p = client.get_profile(&user).unwrap();
    assert_eq!(p.nickname, String::from_str(&env, "Alice"));
    assert_eq!(p.followers, 0);
    assert_eq!(p.post_count, 0);
}

#[test]
fn test_update_profile_preserves_counts() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    let follower = Address::generate(&env);
    client.create_profile(&user, &String::from_str(&env, "Alice"), &String::from_str(&env, "Bio"));
    client.create_profile(&follower, &String::from_str(&env, "Bob"), &String::from_str(&env, "Bio"));
    client.follow_creator(&follower, &user);

    // Re-create profile should preserve followers
    client.create_profile(&user, &String::from_str(&env, "Alice2"), &String::from_str(&env, "New bio"));
    let p = client.get_profile(&user).unwrap();
    assert_eq!(p.followers, 1);
    assert_eq!(p.nickname, String::from_str(&env, "Alice2"));
}

// ── Social graph ───────────────────────────────────────────────────────────

#[test]
fn test_follow_unfollow() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    client.create_profile(&bob, &String::from_str(&env, "Bob"), &String::from_str(&env, ""));

    assert!(!client.is_following(&bob, &alice));
    client.follow_creator(&bob, &alice);
    assert!(client.is_following(&bob, &alice));
    assert_eq!(client.get_profile(&alice).unwrap().followers, 1);
    assert_eq!(client.get_profile(&bob).unwrap().following, 1);

    client.unfollow_creator(&bob, &alice);
    assert!(!client.is_following(&bob, &alice));
    assert_eq!(client.get_profile(&alice).unwrap().followers, 0);
    assert_eq!(client.get_profile(&bob).unwrap().following, 0);
}

#[test]
fn test_follow_idempotent() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    client.create_profile(&bob, &String::from_str(&env, "Bob"), &String::from_str(&env, ""));

    client.follow_creator(&bob, &alice);
    client.follow_creator(&bob, &alice); // second call is no-op
    assert_eq!(client.get_profile(&alice).unwrap().followers, 1);
}

// ── Subscriptions ──────────────────────────────────────────────────────────

#[test]
fn test_subscribe_and_unsubscribe() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));

    assert!(!client.is_subscribed(&bob, &alice));
    client.subscribe_to_creator(&bob, &alice, &1000);
    assert!(client.is_subscribed(&bob, &alice));

    let analytics = client.get_creator_analytics(&alice);
    assert_eq!(analytics.subscriber_count, 1);
    assert_eq!(analytics.withdrawable_earnings, 1000);

    client.unsubscribe_from_creator(&bob, &alice);
    assert!(!client.is_subscribed(&bob, &alice));
    assert_eq!(client.get_creator_analytics(&alice).subscriber_count, 0);
}

#[test]
fn test_subscribe_renew_adds_revenue() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));

    client.subscribe_to_creator(&bob, &alice, &500);
    client.subscribe_to_creator(&bob, &alice, &500); // renewal
    let a = client.get_creator_analytics(&alice);
    assert_eq!(a.withdrawable_earnings, 1000);
    assert_eq!(a.subscriber_count, 1); // still 1, not 2
}

#[test]
#[should_panic(expected = "Subscription amount must be positive")]
fn test_subscribe_zero_amount_fails() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.subscribe_to_creator(&bob, &alice, &0);
}

// ── Posts ──────────────────────────────────────────────────────────────────

#[test]
fn test_create_post_increments_count() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    client.create_profile(&user, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(
        &user,
        &String::from_str(&env, "ipfs://abc"),
        &false,
        &0,
    );
    assert_eq!(id, 1);
    assert_eq!(client.get_profile(&user).unwrap().post_count, 1);
}

#[test]
#[should_panic(expected = "Profile not found")]
fn test_post_without_profile_fails() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    client.create_post(&user, &String::from_str(&env, "Hello"), &false, &0);
}

#[test]
fn test_get_latest_posts() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    client.create_profile(&user, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    client.create_post(&user, &String::from_str(&env, "Post 1"), &false, &0);
    client.create_post(&user, &String::from_str(&env, "Post 2"), &false, &0);
    let feed = client.get_latest_posts();
    assert_eq!(feed.len(), 2);
    // Most recent is first
    assert_eq!(feed.get(0).unwrap().id, 2);
}

#[test]
fn test_get_user_posts() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    client.create_profile(&user, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    client.create_post(&user, &String::from_str(&env, "P1"), &false, &0);
    client.create_post(&user, &String::from_str(&env, "P2"), &false, &0);
    let ids = client.get_user_posts(&user);
    assert_eq!(ids.len(), 2);
}

// ── Engagement ─────────────────────────────────────────────────────────────

#[test]
fn test_like_post() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &false, &0);
    client.like_post(&bob, &id);
    assert_eq!(client.get_post(&id).unwrap().likes, 1);
    assert_eq!(client.get_creator_analytics(&alice).total_likes, 1);
}

#[test]
fn test_tip_post() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &false, &0);
    client.tip_post(&bob, &id, &500);
    assert_eq!(client.get_post(&id).unwrap().tips_collected, 500);
    assert_eq!(client.get_creator_analytics(&alice).withdrawable_earnings, 500);
}

#[test]
#[should_panic(expected = "Tip amount must be positive")]
fn test_tip_zero_fails() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &false, &0);
    client.tip_post(&bob, &id, &0);
}

#[test]
#[should_panic(expected = "Tip below minimum")]
fn test_tip_below_minimum_fails() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &false, &1000);
    client.tip_post(&bob, &id, &100); // below min_tip of 1000
}

#[test]
#[should_panic(expected = "Must be subscribed to tip premium content")]
fn test_tip_premium_without_sub_fails() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &true, &0);
    client.tip_post(&bob, &id, &100); // not subscribed
}

#[test]
fn test_tip_premium_with_sub_succeeds() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &true, &0);
    client.subscribe_to_creator(&bob, &alice, &500);
    client.tip_post(&bob, &id, &100);
    assert_eq!(client.get_post(&id).unwrap().tips_collected, 100);
}

// ── Earnings ───────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_earnings() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    let id = client.create_post(&alice, &String::from_str(&env, "P1"), &false, &0);
    client.tip_post(&bob, &id, &1000);
    client.subscribe_to_creator(&bob, &alice, &500);

    let withdrawn = client.withdraw_earnings(&alice);
    assert_eq!(withdrawn, 1500);
    assert_eq!(client.get_creator_analytics(&alice).withdrawable_earnings, 0);
}

#[test]
#[should_panic(expected = "No earnings to withdraw")]
fn test_withdraw_empty_earnings_fails() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    client.withdraw_earnings(&alice);
}

// ── Analytics ─────────────────────────────────────────────────────────────

#[test]
fn test_creator_analytics_full() {
    let (env, client) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    client.create_profile(&alice, &String::from_str(&env, "Alice"), &String::from_str(&env, ""));
    client.create_profile(&bob, &String::from_str(&env, "Bob"), &String::from_str(&env, ""));
    client.create_profile(&carol, &String::from_str(&env, "Carol"), &String::from_str(&env, ""));

    client.follow_creator(&bob, &alice);
    client.follow_creator(&carol, &alice);
    client.subscribe_to_creator(&bob, &alice, &300);
    let id = client.create_post(&alice, &String::from_str(&env, "Post"), &false, &0);
    client.like_post(&bob, &id);
    client.like_post(&carol, &id);
    client.tip_post(&bob, &id, &200);

    let a = client.get_creator_analytics(&alice);
    assert_eq!(a.follower_count, 2);
    assert_eq!(a.subscriber_count, 1);
    assert_eq!(a.post_count, 1);
    assert_eq!(a.total_likes, 2);
    assert_eq!(a.withdrawable_earnings, 500); // 300 sub + 200 tip
}
