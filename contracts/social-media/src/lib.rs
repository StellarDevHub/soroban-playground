#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, symbol_short, log, vec, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Profiles(Address),
    Posts(u64),
    PostCounter,
    UserPosts(Address),
    LatestPostIds, // To store a small list of latest IDs for feed
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Profile {
    pub author: Address,
    pub nickname: String,
    pub bio: String,
    pub followers: u32,
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
}

#[contract]
pub struct SocialMediaContract;

#[contractimpl]
impl SocialMediaContract {
    pub fn create_profile(env: Env, user: Address, nickname: String, bio: String) {
        user.require_auth();
        let key = DataKey::Profiles(user.clone());
        let profile = Profile {
            author: user,
            nickname,
            bio,
            followers: 0,
        };
        env.storage().instance().set(&key, &profile);
    }

    pub fn create_post(env: Env, author: Address, content_hash: String) -> u64 {
        author.require_auth();
        
        // Ensure profile exists
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
        };

        env.storage().instance().set(&DataKey::Posts(post_id), &post);

        // Track user posts
        let user_posts_key = DataKey::UserPosts(author.clone());
        let mut user_posts: Vec<u64> = env.storage().instance().get(&user_posts_key).unwrap_or(vec![&env]);
        user_posts.push_back(post_id);
        env.storage().instance().set(&user_posts_key, &user_posts);

        // Update latest IDs for feed
        let mut latest_ids: Vec<u64> = env.storage().instance().get(&DataKey::LatestPostIds).unwrap_or(vec![&env]);
        latest_ids.push_front(post_id);
        if latest_ids.len() > 10 {
            latest_ids.pop_back();
        }
        env.storage().instance().set(&DataKey::LatestPostIds, &latest_ids);

        log!(&env, "Post created by {} with ID {}", author, post_id);
        post_id
    }

    pub fn like_post(env: Env, user: Address, post_id: u64) {
        user.require_auth();
        let key = DataKey::Posts(post_id);
        let mut post: Post = env.storage().instance().get(&key).expect("Post not found");
        
        post.likes += 1;
        env.storage().instance().set(&key, &post);
        
        log!(&env, "Post {} liked by {}", post_id, user);
    }

    pub fn tip_post(env: Env, from: Address, post_id: u64, amount: i128) {
        from.require_auth();
        
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }

        let key = DataKey::Posts(post_id);
        let mut post: Post = env.storage().instance().get(&key).expect("Post not found");
        
        // In a real app, you would transfer underlying tokens here
        // env.invoke_contract(...) for token transfer
        
        post.tips_collected += amount;
        env.storage().instance().set(&key, &post);

        log!(&env, "Post {} tipped {} by {}", post_id, amount, from);
        
        env.events().publish(
            (symbol_short!("tip"), post.author, post_id),
            (from, amount)
        );
    }

    pub fn get_profile(env: Env, user: Address) -> Option<Profile> {
        env.storage().instance().get(&DataKey::Profiles(user))
    }

    pub fn get_post(env: Env, post_id: u64) -> Option<Post> {
        env.storage().instance().get(&DataKey::Posts(post_id))
    }

    pub fn get_latest_posts(env: Env) -> Vec<Post> {
        let latest_ids: Vec<u64> = env.storage().instance().get(&DataKey::LatestPostIds).unwrap_or(vec![&env]);
        let mut posts = vec![&env];
        for id in latest_ids.iter() {
            if let Some(post) = env.storage().instance().get(&DataKey::Posts(id)) {
                posts.push_back(post);
            }
        }
        posts
    }
}

mod test;
