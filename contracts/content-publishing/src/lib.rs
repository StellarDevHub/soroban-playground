#![no_std]
//! Decentralized Content Publishing Platform
//!
//! Authors register channels, publish articles (off-chain content referenced by hash),
//! collect tips from readers, and sell time-bounded subscriptions. Per-author analytics
//! (subscriber count, tips received, views, likes) are maintained on-chain so the
//! frontend can render a creator dashboard without an external indexer.
//!
//! Security:
//!   * `require_auth` on every state mutation
//!   * Custom error enum (no `panic!` strings) — checks-effects-interactions order
//!   * Admin-gated emergency pause; mutations short-circuit while paused
//!   * Authors can never tip themselves or self-subscribe (prevents wash metrics)

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String, Symbol, Vec,
};

// ── Storage keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    ArticleCounter,
    Author(Address),
    Article(u64),
    AuthorArticles(Address),
    AuthorSubscribers(Address),
    Subscription(Address, Address), // (author, subscriber)
    AuthorStats(Address),
    LatestArticles, // bounded ring of recent IDs
    HasLiked(u64, Address),
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    AuthorNotFound = 5,
    AuthorAlreadyRegistered = 6,
    ArticleNotFound = 7,
    InvalidAmount = 8,
    SelfTipForbidden = 9,
    SelfSubscribeForbidden = 10,
    SubscriptionNotFound = 11,
    PremiumRequiresSubscription = 12,
    AlreadyLiked = 13,
}

// ── Domain types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct AuthorProfile {
    pub address: Address,
    pub name: String,
    pub bio: String,
    /// Stroops (or arbitrary token base unit) charged per subscription period.
    pub subscription_price: i128,
    /// Length of one subscription period, in seconds.
    pub period_seconds: u64,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Article {
    pub id: u64,
    pub author: Address,
    pub title: String,
    /// IPFS / S3 / arweave content hash — actual body lives off-chain.
    pub content_hash: BytesN<32>,
    pub timestamp: u64,
    pub premium: bool,
    pub views: u64,
    pub likes: u32,
    pub tips_collected: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Subscription {
    pub author: Address,
    pub subscriber: Address,
    pub started_at: u64,
    pub expires_at: u64,
    pub total_paid: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct AuthorStats {
    pub article_count: u32,
    pub total_views: u64,
    pub total_likes: u64,
    pub total_tips: i128,
    pub active_subscribers: u32,
    pub lifetime_subscribers: u32,
    pub subscription_revenue: i128,
}

// ── Contract ────────────────────────────────────────────────────────────────

const LATEST_CAP: u32 = 50;
const TOPIC_PUBLISH: Symbol = symbol_short!("publish");
const TOPIC_TIP: Symbol = symbol_short!("tip");
const TOPIC_SUB: Symbol = symbol_short!("subscribe");
const TOPIC_LIKE: Symbol = symbol_short!("like");
const TOPIC_PAUSE: Symbol = symbol_short!("pause");

#[contract]
pub struct ContentPublishingContract;

#[contractimpl]
impl ContentPublishingContract {
    // ── Lifecycle ───────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::ArticleCounter, &0u64);
        Ok(())
    }

    pub fn set_paused(env: Env, caller: Address, paused: bool) -> Result<(), Error> {
        Self::ensure_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((TOPIC_PAUSE, caller), paused);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    // ── Author management ───────────────────────────────────────────────────

    pub fn register_author(
        env: Env,
        author: Address,
        name: String,
        bio: String,
        subscription_price: i128,
        period_seconds: u64,
    ) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        author.require_auth();
        if subscription_price < 0 {
            return Err(Error::InvalidAmount);
        }
        if env.storage().persistent().has(&DataKey::Author(author.clone())) {
            return Err(Error::AuthorAlreadyRegistered);
        }
        let profile = AuthorProfile {
            address: author.clone(),
            name,
            bio,
            subscription_price,
            period_seconds: period_seconds.max(1),
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Author(author.clone()), &profile);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorStats(author.clone()), &AuthorStats {
                article_count: 0,
                total_views: 0,
                total_likes: 0,
                total_tips: 0,
                active_subscribers: 0,
                lifetime_subscribers: 0,
                subscription_revenue: 0,
            });
        env.storage()
            .persistent()
            .set(&DataKey::AuthorArticles(author.clone()), &Vec::<u64>::new(&env));
        env.storage()
            .persistent()
            .set(&DataKey::AuthorSubscribers(author), &Vec::<Address>::new(&env));
        Ok(())
    }

    pub fn update_author(
        env: Env,
        author: Address,
        name: String,
        bio: String,
        subscription_price: i128,
        period_seconds: u64,
    ) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        author.require_auth();
        if subscription_price < 0 {
            return Err(Error::InvalidAmount);
        }
        let mut profile = Self::load_author(&env, &author)?;
        profile.name = name;
        profile.bio = bio;
        profile.subscription_price = subscription_price;
        profile.period_seconds = period_seconds.max(1);
        env.storage().persistent().set(&DataKey::Author(author), &profile);
        Ok(())
    }

    pub fn get_author(env: Env, author: Address) -> Option<AuthorProfile> {
        env.storage().persistent().get(&DataKey::Author(author))
    }

    // ── Publishing ──────────────────────────────────────────────────────────

    pub fn publish(
        env: Env,
        author: Address,
        title: String,
        content_hash: BytesN<32>,
        premium: bool,
    ) -> Result<u64, Error> {
        Self::ensure_running(&env)?;
        author.require_auth();
        Self::load_author(&env, &author)?;

        let mut id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ArticleCounter)
            .unwrap_or(0);
        id += 1;

        let article = Article {
            id,
            author: author.clone(),
            title,
            content_hash,
            timestamp: env.ledger().timestamp(),
            premium,
            views: 0,
            likes: 0,
            tips_collected: 0,
        };

        // effects
        env.storage().instance().set(&DataKey::ArticleCounter, &id);
        env.storage().persistent().set(&DataKey::Article(id), &article);

        let mut owned: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorArticles(author.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        owned.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorArticles(author.clone()), &owned);

        let mut stats = Self::load_stats(&env, &author);
        stats.article_count = stats.article_count.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorStats(author.clone()), &stats);

        // bounded latest-feed ring
        let mut latest: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::LatestArticles)
            .unwrap_or_else(|| Vec::new(&env));
        latest.push_front(id);
        while latest.len() > LATEST_CAP {
            latest.pop_back();
        }
        env.storage().instance().set(&DataKey::LatestArticles, &latest);

        env.events().publish((TOPIC_PUBLISH, author), id);
        Ok(id)
    }

    pub fn get_article(env: Env, id: u64) -> Option<Article> {
        env.storage().persistent().get(&DataKey::Article(id))
    }

    /// Records a view. Premium articles require an active subscription from `reader`.
    pub fn record_view(env: Env, reader: Address, id: u64) -> Result<Article, Error> {
        Self::ensure_running(&env)?;
        reader.require_auth();
        let mut article: Article = env
            .storage()
            .persistent()
            .get(&DataKey::Article(id))
            .ok_or(Error::ArticleNotFound)?;

        if article.premium && reader != article.author {
            if !Self::has_active_subscription(&env, &article.author, &reader) {
                return Err(Error::PremiumRequiresSubscription);
            }
        }

        article.views = article.views.saturating_add(1);
        env.storage().persistent().set(&DataKey::Article(id), &article);

        let mut stats = Self::load_stats(&env, &article.author);
        stats.total_views = stats.total_views.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorStats(article.author.clone()), &stats);
        Ok(article)
    }

    pub fn like(env: Env, reader: Address, id: u64) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        reader.require_auth();
        let mut article: Article = env
            .storage()
            .persistent()
            .get(&DataKey::Article(id))
            .ok_or(Error::ArticleNotFound)?;

        let liked_key = DataKey::HasLiked(id, reader.clone());
        if env.storage().persistent().get::<_, bool>(&liked_key).unwrap_or(false) {
            return Err(Error::AlreadyLiked);
        }

        article.likes = article.likes.saturating_add(1);
        env.storage().persistent().set(&DataKey::Article(id), &article);
        env.storage().persistent().set(&liked_key, &true);

        let mut stats = Self::load_stats(&env, &article.author);
        stats.total_likes = stats.total_likes.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorStats(article.author.clone()), &stats);

        env.events().publish((TOPIC_LIKE, article.author, id), reader);
        Ok(())
    }

    // ── Tip jar ─────────────────────────────────────────────────────────────

    pub fn tip(env: Env, from: Address, article_id: u64, amount: i128) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut article: Article = env
            .storage()
            .persistent()
            .get(&DataKey::Article(article_id))
            .ok_or(Error::ArticleNotFound)?;
        if from == article.author {
            return Err(Error::SelfTipForbidden);
        }

        // effects-only on-chain bookkeeping. Token transfer is delegated to a
        // wrapping contract or a frontend-issued classic Stellar payment so this
        // contract stays asset-agnostic.
        article.tips_collected = article.tips_collected.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::Article(article_id), &article);

        let mut stats = Self::load_stats(&env, &article.author);
        stats.total_tips = stats.total_tips.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorStats(article.author.clone()), &stats);

        env.events()
            .publish((TOPIC_TIP, article.author, article_id), (from, amount));
        Ok(())
    }

    // ── Subscriptions ───────────────────────────────────────────────────────

    pub fn subscribe(
        env: Env,
        subscriber: Address,
        author: Address,
        periods: u32,
    ) -> Result<Subscription, Error> {
        Self::ensure_running(&env)?;
        subscriber.require_auth();
        if periods == 0 {
            return Err(Error::InvalidAmount);
        }
        if subscriber == author {
            return Err(Error::SelfSubscribeForbidden);
        }
        let profile = Self::load_author(&env, &author)?;
        let cost = profile
            .subscription_price
            .checked_mul(periods as i128)
            .ok_or(Error::InvalidAmount)?;

        let now = env.ledger().timestamp();
        let extension = profile.period_seconds.saturating_mul(periods as u64);

        let key = DataKey::Subscription(author.clone(), subscriber.clone());
        let was_active = env
            .storage()
            .persistent()
            .get::<_, Subscription>(&key)
            .map(|s| s.expires_at > now)
            .unwrap_or(false);

        let sub = match env.storage().persistent().get::<_, Subscription>(&key) {
            Some(existing) if existing.expires_at > now => Subscription {
                expires_at: existing.expires_at.saturating_add(extension),
                total_paid: existing.total_paid.saturating_add(cost),
                ..existing
            },
            _ => Subscription {
                author: author.clone(),
                subscriber: subscriber.clone(),
                started_at: now,
                expires_at: now.saturating_add(extension),
                total_paid: cost,
            },
        };
        env.storage().persistent().set(&key, &sub);

        let mut stats = Self::load_stats(&env, &author);
        stats.subscription_revenue = stats.subscription_revenue.saturating_add(cost);
        if !was_active {
            stats.active_subscribers = stats.active_subscribers.saturating_add(1);
            // append subscriber to the author's roster (only on first activation)
            let mut roster: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::AuthorSubscribers(author.clone()))
                .unwrap_or_else(|| Vec::new(&env));
            if !roster.contains(&subscriber) {
                roster.push_back(subscriber.clone());
                stats.lifetime_subscribers = stats.lifetime_subscribers.saturating_add(1);
            }
            env.storage()
                .persistent()
                .set(&DataKey::AuthorSubscribers(author.clone()), &roster);
        }
        env.storage()
            .persistent()
            .set(&DataKey::AuthorStats(author.clone()), &stats);

        env.events()
            .publish((TOPIC_SUB, author, subscriber), (cost, sub.expires_at));
        Ok(sub)
    }

    pub fn get_subscription(
        env: Env,
        author: Address,
        subscriber: Address,
    ) -> Option<Subscription> {
        env.storage()
            .persistent()
            .get(&DataKey::Subscription(author, subscriber))
    }

    pub fn is_subscribed(env: Env, author: Address, subscriber: Address) -> bool {
        Self::has_active_subscription(&env, &author, &subscriber)
    }

    // ── Analytics & feeds ───────────────────────────────────────────────────

    pub fn get_stats(env: Env, author: Address) -> Option<AuthorStats> {
        env.storage().persistent().get(&DataKey::AuthorStats(author))
    }

    pub fn get_articles_by_author(env: Env, author: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorArticles(author))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_subscribers(env: Env, author: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorSubscribers(author))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_latest_articles(env: Env) -> Vec<Article> {
        let ids: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::LatestArticles)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(article) = env.storage().persistent().get::<_, Article>(&DataKey::Article(id)) {
                out.push_back(article);
            }
        }
        out
    }

    // ── Internals ───────────────────────────────────────────────────────────

    fn ensure_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if &admin != caller {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn ensure_running(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        if env.storage().instance().get::<_, bool>(&DataKey::Paused).unwrap_or(false) {
            return Err(Error::Paused);
        }
        Ok(())
    }

    fn load_author(env: &Env, author: &Address) -> Result<AuthorProfile, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Author(author.clone()))
            .ok_or(Error::AuthorNotFound)
    }

    fn load_stats(env: &Env, author: &Address) -> AuthorStats {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorStats(author.clone()))
            .unwrap_or(AuthorStats {
                article_count: 0,
                total_views: 0,
                total_likes: 0,
                total_tips: 0,
                active_subscribers: 0,
                lifetime_subscribers: 0,
                subscription_revenue: 0,
            })
    }

    fn has_active_subscription(env: &Env, author: &Address, subscriber: &Address) -> bool {
        env.storage()
            .persistent()
            .get::<_, Subscription>(&DataKey::Subscription(author.clone(), subscriber.clone()))
            .map(|s| s.expires_at > env.ledger().timestamp())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test;
