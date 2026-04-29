#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use crate::storage::{
    get_admin, get_author_sub_count, get_content_count, get_stats, is_initialized, is_paused,
    load_content, load_subscription, next_content_id, save_content, save_subscription,
    set_admin, set_author_sub_count, set_paused, set_stats,
};
use crate::types::{Content, Error, PlatformStats, Subscription};

#[contract]
pub struct ContentPublishing;

#[contractimpl]
impl ContentPublishing {
    /// Initialize the platform with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);

        env.events().publish(
            (soroban_sdk::symbol_short!("init"),),
            (admin,),
        );

        Ok(())
    }

    /// Publish a new content item.
    ///
    /// `title_hash` and `content_hash` are sha256 hashes / IPFS CIDs stored off-chain.
    pub fn publish_content(
        env: Env,
        author: Address,
        title_hash: String,
        content_hash: String,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        author.require_auth();

        if title_hash.len() == 0 || content_hash.len() == 0 {
            return Err(Error::InvalidContent);
        }

        let id = next_content_id(&env);
        let now = env.ledger().timestamp();
        let sub_count = get_author_sub_count(&env, &author);

        let content = Content {
            id,
            author: author.clone(),
            title_hash,
            content_hash,
            total_tips: 0,
            tip_count: 0,
            subscriber_count: sub_count,
            published_at: now,
            active: true,
        };

        save_content(&env, &content);

        let mut stats = get_stats(&env);
        stats.total_content += 1;
        set_stats(&env, &stats);

        env.events().publish(
            (soroban_sdk::symbol_short!("publish"),),
            (id, author, now),
        );

        Ok(id)
    }

    /// Send a tip to a content author.
    ///
    /// Uses checks-effects-interactions: state is updated before the token transfer.
    pub fn tip_author(
        env: Env,
        tipper: Address,
        content_id: u32,
        payment_token: Address,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        tipper.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut content = load_content(&env, content_id)?;
        if !content.active {
            return Err(Error::ContentNotFound);
        }
        if content.author == tipper {
            return Err(Error::SelfTip);
        }

        // Effects: update state before external call
        content.total_tips += amount;
        content.tip_count += 1;
        save_content(&env, &content);

        let mut stats = get_stats(&env);
        stats.total_tips += amount;
        set_stats(&env, &stats);

        // Interaction: transfer tokens
        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&tipper, &content.author, &amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("tip"),),
            (content_id, tipper, content.author, amount),
        );

        Ok(())
    }

    /// Subscribe to an author to receive content notifications.
    pub fn subscribe(env: Env, subscriber: Address, author: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        subscriber.require_auth();

        if let Some(existing) = load_subscription(&env, &subscriber, &author) {
            if existing.active {
                return Err(Error::AlreadySubscribed);
            }
        }

        let now = env.ledger().timestamp();
        let sub = Subscription {
            subscriber: subscriber.clone(),
            author: author.clone(),
            subscribed_at: now,
            active: true,
        };
        save_subscription(&env, &sub);

        let count = get_author_sub_count(&env, &author);
        set_author_sub_count(&env, &author, count + 1);

        let mut stats = get_stats(&env);
        stats.total_subscriptions += 1;
        set_stats(&env, &stats);

        env.events().publish(
            (soroban_sdk::symbol_short!("subscribe"),),
            (subscriber, author, now),
        );

        Ok(())
    }

    /// Unsubscribe from an author.
    pub fn unsubscribe(env: Env, subscriber: Address, author: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        subscriber.require_auth();

        let mut sub = load_subscription(&env, &subscriber, &author)
            .ok_or(Error::SubscriptionNotFound)?;

        if !sub.active {
            return Err(Error::SubscriptionNotFound);
        }

        sub.active = false;
        save_subscription(&env, &sub);

        let count = get_author_sub_count(&env, &author);
        if count > 0 {
            set_author_sub_count(&env, &author, count - 1);
        }

        env.events().publish(
            (soroban_sdk::symbol_short!("unsub"),),
            (subscriber, author),
        );

        Ok(())
    }

    /// Remove content (author or admin only).
    pub fn remove_content(env: Env, caller: Address, content_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();

        let mut content = load_content(&env, content_id)?;
        let admin = get_admin(&env)?;

        if content.author != caller && admin != caller {
            return Err(Error::Unauthorized);
        }

        content.active = false;
        save_content(&env, &content);

        env.events().publish(
            (soroban_sdk::symbol_short!("removed"),),
            (content_id, caller),
        );

        Ok(())
    }

    /// Pause or unpause the platform (admin only).
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let stored_admin = get_admin(&env)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }
        admin.require_auth();
        set_paused(&env, paused);

        env.events().publish(
            (soroban_sdk::symbol_short!("paused"),),
            (admin, paused),
        );

        Ok(())
    }

    /// Get content by ID.
    pub fn get_content(env: Env, content_id: u32) -> Result<Content, Error> {
        ensure_initialized(&env)?;
        load_content(&env, content_id)
    }

    /// Get subscription status between a subscriber and author.
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        author: Address,
    ) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(load_subscription(&env, &subscriber, &author)
            .map(|s| s.active)
            .unwrap_or(false))
    }

    /// Get subscriber count for an author.
    pub fn get_subscriber_count(env: Env, author: Address) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_author_sub_count(&env, &author))
    }

    /// Get total content count.
    pub fn get_content_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_content_count(&env))
    }

    /// Get platform-wide analytics.
    pub fn get_platform_stats(env: Env) -> Result<PlatformStats, Error> {
        ensure_initialized(&env)?;
        Ok(get_stats(&env))
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::Paused);
    }
    Ok(())
}
