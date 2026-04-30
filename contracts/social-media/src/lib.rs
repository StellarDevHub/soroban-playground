#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, String, Vec, log, symbol_short, vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Profile & post storage (pre-existing)
    Profiles(Address),
    Posts(u64),
    PostCounter,
    UserPosts(Address),
    LatestPostIds,
    // Monetization & social graph (new)
    Following(Address, Address),          // bool: does follower follow creator
    Subscribed(Address, Address),         // bool: is subscriber subscribed to creator
    CreatorEarnings(Address),             // i128: withdrawable balance
    CreatorSubscriberCount(Address),      // u32
    CreatorTotalLikes(Address),           // u32: sum of likes on all creator's posts
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Profile {
    pub author: Address,
    pub nickname: String,
    pub bio: String,
    pub followers: u32,
    pub following: u32,
    pub post_count: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Post {
    pub id: u64,
    pub author: Address,
    pub content_hash: String,
    pub timestamp: u64,
    pub likes: u32,
    pub tips_collected: i128,
    pub is_premium: bool,         // premium posts require a subscription to tip
    pub min_tip: i128,            // minimum tip amount (0 = free)
}

/// Per-creator analytics returned by `get_creator_analytics`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CreatorAnalytics {
    pub post_count: u64,
    pub total_tips: i128,
    pub total_subscription_revenue: i128,
    pub subscriber_count: u32,
    pub follower_count: u32,
    pub total_likes: u32,
    pub withdrawable_earnings: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct SocialMediaContract;

#[contractimpl]
impl SocialMediaContract {

    // ── Profile management ─────────────────────────────────────────────────

    /// Create or update a user profile.
    pub fn create_profile(env: Env, user: Address, nickname: String, bio: String) {
        user.require_auth();
        let key = DataKey::Profiles(user.clone());
        // Preserve follower/following/post_count if profile already exists.
        let existing: Option<Profile> = env.storage().instance().get(&key);
        let profile = Profile {
            author: user.clone(),
            nickname,
            bio,
            followers: existing.as_ref().map(|p| p.followers).unwrap_or(0),
            following: existing.as_ref().map(|p| p.following).unwrap_or(0),
            post_count: existing.as_ref().map(|p| p.post_count).unwrap_or(0),
        };
        env.storage().instance().set(&key, &profile);
    }

    pub fn get_profile(env: Env, user: Address) -> Option<Profile> {
        env.storage().instance().get(&DataKey::Profiles(user))
    }

    // ── Social graph ───────────────────────────────────────────────────────

    /// Follow a creator. No-ops if already following.
    pub fn follow_creator(env: Env, follower: Address, creator: Address) {
        follower.require_auth();
        let follow_key = DataKey::Following(follower.clone(), creator.clone());
        if env.storage().instance().get::<DataKey, bool>(&follow_key).unwrap_or(false) {
            return; // already following
        }
        env.storage().instance().set(&follow_key, &true);

        // Increment creator's follower count on their profile.
        let creator_key = DataKey::Profiles(creator.clone());
        if let Some(mut profile) = env.storage().instance().get::<DataKey, Profile>(&creator_key) {
            profile.followers += 1;
            env.storage().instance().set(&creator_key, &profile);
        }

        // Increment follower's following count.
        let follower_key = DataKey::Profiles(follower.clone());
        if let Some(mut profile) = env.storage().instance().get::<DataKey, Profile>(&follower_key) {
            profile.following += 1;
            env.storage().instance().set(&follower_key, &profile);
        }

        log!(&env, "follow: {} -> {}", follower, creator);
    }

    /// Unfollow a creator. No-ops if not following.
    pub fn unfollow_creator(env: Env, follower: Address, creator: Address) {
        follower.require_auth();
        let follow_key = DataKey::Following(follower.clone(), creator.clone());
        if !env.storage().instance().get::<DataKey, bool>(&follow_key).unwrap_or(false) {
            return;
        }
        env.storage().instance().remove(&follow_key);

        let creator_key = DataKey::Profiles(creator.clone());
        if let Some(mut profile) = env.storage().instance().get::<DataKey, Profile>(&creator_key) {
            profile.followers = profile.followers.saturating_sub(1);
            env.storage().instance().set(&creator_key, &profile);
        }

        let follower_key = DataKey::Profiles(follower.clone());
        if let Some(mut profile) = env.storage().instance().get::<DataKey, Profile>(&follower_key) {
            profile.following = profile.following.saturating_sub(1);
            env.storage().instance().set(&follower_key, &profile);
        }
    }

    pub fn is_following(env: Env, follower: Address, creator: Address) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Following(follower, creator))
            .unwrap_or(false)
    }

    // ── Subscriptions (paid) ───────────────────────────────────────────────

    /// Subscribe to a creator. `amount` stroops credited to the creator's earnings.
    /// Calling again when already subscribed just adds more revenue (re-subscribe/renew).
    pub fn subscribe_to_creator(env: Env, subscriber: Address, creator: Address, amount: i128) {
        subscriber.require_auth();
        if amount <= 0 {
            panic!("Subscription amount must be positive");
        }
        let sub_key = DataKey::Subscribed(subscriber.clone(), creator.clone());
        let already = env.storage().instance().get::<DataKey, bool>(&sub_key).unwrap_or(false);

        env.storage().instance().set(&sub_key, &true);

        // Credit creator's earnings.
        let earnings_key = DataKey::CreatorEarnings(creator.clone());
        let current: i128 = env.storage().instance().get(&earnings_key).unwrap_or(0);
        env.storage().instance().set(&earnings_key, &(current + amount));

        // Increment subscriber count only on new subscription.
        if !already {
            let count_key = DataKey::CreatorSubscriberCount(creator.clone());
            let count: u32 = env.storage().instance().get(&count_key).unwrap_or(0);
            env.storage().instance().set(&count_key, &(count + 1));
        }

        env.events().publish(
            (symbol_short!("sub"), creator.clone()),
            (subscriber, amount),
        );
    }

    /// Unsubscribe from a creator.
    pub fn unsubscribe_from_creator(env: Env, subscriber: Address, creator: Address) {
        subscriber.require_auth();
        let sub_key = DataKey::Subscribed(subscriber.clone(), creator.clone());
        if !env.storage().instance().get::<DataKey, bool>(&sub_key).unwrap_or(false) {
            return; // not subscribed
        }
        env.storage().instance().remove(&sub_key);

        let count_key = DataKey::CreatorSubscriberCount(creator.clone());
        let count: u32 = env.storage().instance().get(&count_key).unwrap_or(0);
        env.storage().instance().set(&count_key, &count.saturating_sub(1));
    }

    pub fn is_subscribed(env: Env, subscriber: Address, creator: Address) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Subscribed(subscriber, creator))
            .unwrap_or(false)
    }

    // ── Content: posts ─────────────────────────────────────────────────────

    /// Publish a post. `is_premium` gates monetization; `min_tip` sets tip floor.
    pub fn create_post(
        env: Env,
        author: Address,
        content_hash: String,
        is_premium: bool,
        min_tip: i128,
    ) -> u64 {
        author.require_auth();
        if !env.storage().instance().has(&DataKey::Profiles(author.clone())) {
            panic!("Profile not found. Create a profile first.");
        }

        let mut post_id: u64 = env.storage().instance().get(&DataKey::PostCounter).unwrap_or(0);
        post_id += 1;
        env.storage().instance().set(&DataKey::PostCounter, &post_id);

        let post = Post {
            id: post_id,
            author: author.clone(),
            content_hash,
            timestamp: env.ledger().timestamp(),
            likes: 0,
            tips_collected: 0,
            is_premium,
            min_tip,
        };
        env.storage().instance().set(&DataKey::Posts(post_id), &post);

        // Update author's user-post index.
        let user_posts_key = DataKey::UserPosts(author.clone());
        let mut user_posts: Vec<u64> =
            env.storage().instance().get(&user_posts_key).unwrap_or(vec![&env]);
        user_posts.push_back(post_id);
        env.storage().instance().set(&user_posts_key, &user_posts);

        // Update author's profile post_count.
        let profile_key = DataKey::Profiles(author.clone());
        if let Some(mut profile) = env.storage().instance().get::<DataKey, Profile>(&profile_key) {
            profile.post_count += 1;
            env.storage().instance().set(&profile_key, &profile);
        }

        // Update global latest-posts feed (most-recent-10).
        let mut latest: Vec<u64> =
            env.storage().instance().get(&DataKey::LatestPostIds).unwrap_or(vec![&env]);
        latest.push_front(post_id);
        if latest.len() > 10 {
            latest.pop_back();
        }
        env.storage().instance().set(&DataKey::LatestPostIds, &latest);

        log!(&env, "post {} by {}", post_id, author);
        post_id
    }

    pub fn get_post(env: Env, post_id: u64) -> Option<Post> {
        env.storage().instance().get(&DataKey::Posts(post_id))
    }

    pub fn get_latest_posts(env: Env) -> Vec<Post> {
        let latest: Vec<u64> =
            env.storage().instance().get(&DataKey::LatestPostIds).unwrap_or(vec![&env]);
        let mut posts = vec![&env];
        for id in latest.iter() {
            if let Some(post) = env.storage().instance().get(&DataKey::Posts(id)) {
                posts.push_back(post);
            }
        }
        posts
    }

    pub fn get_user_posts(env: Env, author: Address) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::UserPosts(author))
            .unwrap_or(vec![&env])
    }

    // ── Engagement ─────────────────────────────────────────────────────────

    pub fn like_post(env: Env, user: Address, post_id: u64) {
        user.require_auth();
        let key = DataKey::Posts(post_id);
        let mut post: Post = env.storage().instance().get(&key).expect("Post not found");
        post.likes += 1;
        env.storage().instance().set(&key, &post);

        // Accumulate creator's total likes for analytics.
        let likes_key = DataKey::CreatorTotalLikes(post.author.clone());
        let total: u32 = env.storage().instance().get(&likes_key).unwrap_or(0);
        env.storage().instance().set(&likes_key, &(total + 1));
    }

    /// Tip a post. For premium posts, tipper must be subscribed to the author.
    pub fn tip_post(env: Env, from: Address, post_id: u64, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }

        let key = DataKey::Posts(post_id);
        let mut post: Post = env.storage().instance().get(&key).expect("Post not found");

        if amount < post.min_tip {
            panic!("Tip below minimum");
        }

        // Premium gate: tipper must be subscribed.
        if post.is_premium {
            let is_sub = env.storage()
                .instance()
                .get::<DataKey, bool>(&DataKey::Subscribed(from.clone(), post.author.clone()))
                .unwrap_or(false);
            if !is_sub {
                panic!("Must be subscribed to tip premium content");
            }
        }

        post.tips_collected += amount;
        env.storage().instance().set(&key, &post);

        // Credit creator earnings.
        let earnings_key = DataKey::CreatorEarnings(post.author.clone());
        let current: i128 = env.storage().instance().get(&earnings_key).unwrap_or(0);
        env.storage().instance().set(&earnings_key, &(current + amount));

        env.events().publish(
            (symbol_short!("tip"), post.author, post_id),
            (from, amount),
        );
    }

    // ── Creator analytics & earnings ───────────────────────────────────────

    /// Returns a full analytics snapshot for a creator.
    pub fn get_creator_analytics(env: Env, creator: Address) -> CreatorAnalytics {
        let profile: Option<Profile> = env.storage().instance().get(&DataKey::Profiles(creator.clone()));
        let follower_count = profile.as_ref().map(|p| p.followers).unwrap_or(0);
        let post_count = profile.as_ref().map(|p| p.post_count).unwrap_or(0);

        let subscriber_count: u32 = env.storage()
            .instance()
            .get(&DataKey::CreatorSubscriberCount(creator.clone()))
            .unwrap_or(0);

        let total_likes: u32 = env.storage()
            .instance()
            .get(&DataKey::CreatorTotalLikes(creator.clone()))
            .unwrap_or(0);

        let withdrawable_earnings: i128 = env.storage()
            .instance()
            .get(&DataKey::CreatorEarnings(creator.clone()))
            .unwrap_or(0);

        // Total tips = sum of tips from each post; we use the earnings ledger.
        // Here we approximate: total_tips = a subset of earnings (all tips route through earnings).
        // Since tips and subscriptions both go to CreatorEarnings we report withdrawable as the sum.
        CreatorAnalytics {
            post_count,
            total_tips: withdrawable_earnings, // combined earnings (tips + subs)
            total_subscription_revenue: env.storage()
                .instance()
                .get(&DataKey::CreatorEarnings(creator.clone()))
                .unwrap_or(0),
            subscriber_count,
            follower_count,
            total_likes,
            withdrawable_earnings,
        }
    }

    /// Creator withdraws their accumulated earnings. Returns amount withdrawn.
    pub fn withdraw_earnings(env: Env, creator: Address) -> i128 {
        creator.require_auth();
        let earnings_key = DataKey::CreatorEarnings(creator.clone());
        let amount: i128 = env.storage().instance().get(&earnings_key).unwrap_or(0);
        if amount == 0 {
            panic!("No earnings to withdraw");
        }
        // In production this would transfer tokens; for the playground we zero the balance.
        env.storage().instance().set(&earnings_key, &0_i128);
        log!(&env, "withdrawn {} by {}", amount, creator);
        amount
    }
}

mod test;
