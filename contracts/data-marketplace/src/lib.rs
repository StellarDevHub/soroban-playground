#![no_std]
//! Decentralized Data Marketplace with Privacy-Preserving Queries
//!
//! Providers list datasets (referenced by manifest + schema hashes; the actual
//! payload lives off-chain, encrypted under the dataset's public key). Buyers
//! purchase a `License` granting a bounded number of queries valid until a
//! deadline. To run a query, a buyer submits a *commitment*
//! `H(query || nonce || buyer_pk)` — the contract decrements quota and emits an
//! event without ever observing the query content. If a dispute arises, the
//! buyer can reveal `(query, nonce)` off-chain and any third party can verify
//! the hash matches the on-chain commitment.
//!
//! Security:
//!   * `require_auth` on every state mutation
//!   * Typed `Error` enum — no `panic!` strings
//!   * Checks → effects → events ordering throughout
//!   * Admin-gated emergency pause; mutations short-circuit while paused
//!   * Self-purchase / self-query of own datasets rejected (prevents wash usage)
//!   * Commitment uniqueness enforced — receipts cannot be replayed
//!   * Saturating arithmetic on counters; no silent over/underflow

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
    DatasetCounter,
    Provider(Address),
    Dataset(u64),
    ProviderDatasets(Address),
    License(u64, Address), // (dataset_id, buyer)
    DatasetBuyers(u64),
    DatasetStats(u64),
    BuyerStats(Address),
    QueryReceipt(BytesN<32>),
    ActiveDatasets, // bounded ring of recently listed IDs
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
    ProviderNotFound = 5,
    ProviderAlreadyRegistered = 6,
    DatasetNotFound = 7,
    DatasetDelisted = 8,
    LicenseNotFound = 9,
    LicenseExpired = 10,
    NoQuotaRemaining = 11,
    InvalidAmount = 12,
    SelfPurchaseForbidden = 13,
    SelfQueryForbidden = 14,
    CommitmentAlreadyUsed = 15,
    InvalidParameter = 16,
}

// ── Domain types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ProviderProfile {
    pub address: Address,
    pub name: String,
    /// Hash of an off-chain contact card (PGP key, email, URL, etc.).
    pub contact_hash: BytesN<32>,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Dataset {
    pub id: u64,
    pub provider: Address,
    pub title: String,
    /// Hash of the schema descriptor (column types, units, etc.).
    pub schema_hash: BytesN<32>,
    /// Hash of the encrypted manifest (file index, off-chain location pointers).
    pub manifest_hash: BytesN<32>,
    /// Public key buyers encrypt their queries against; opaque bytes.
    pub encryption_pubkey: BytesN<32>,
    /// Flat fee charged at license purchase, regardless of query volume.
    pub flat_price: i128,
    /// Per-query unit price; total purchase = flat_price + price_per_query * max_queries.
    pub price_per_query: i128,
    /// License lifetime (seconds) for newly issued licenses on this dataset.
    pub license_seconds: u64,
    pub listed_at: u64,
    pub delisted: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct License {
    pub dataset_id: u64,
    pub buyer: Address,
    pub purchased_at: u64,
    pub expires_at: u64,
    pub queries_total: u32,
    pub queries_used: u32,
    pub total_paid: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct DatasetStats {
    pub license_count: u32,
    pub active_buyers: u32,
    pub queries_executed: u64,
    pub revenue: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct BuyerStats {
    pub licenses_purchased: u32,
    pub queries_executed: u64,
    pub total_spent: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct QueryReceipt {
    pub commitment: BytesN<32>,
    pub dataset_id: u64,
    pub buyer: Address,
    pub timestamp: u64,
    /// Sequence index of this query within the buyer's license.
    pub sequence: u32,
}

// ── Contract ────────────────────────────────────────────────────────────────

const ACTIVE_CAP: u32 = 100;
const TOPIC_LIST: Symbol = symbol_short!("list");
const TOPIC_DELIST: Symbol = symbol_short!("delist");
const TOPIC_BUY: Symbol = symbol_short!("buy");
const TOPIC_QUERY: Symbol = symbol_short!("query");
const TOPIC_PAUSE: Symbol = symbol_short!("pause");

#[contract]
pub struct DataMarketplaceContract;

#[contractimpl]
impl DataMarketplaceContract {
    // ── Lifecycle ───────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::DatasetCounter, &0u64);
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

    // ── Provider management ────────────────────────────────────────────────

    pub fn register_provider(
        env: Env,
        provider: Address,
        name: String,
        contact_hash: BytesN<32>,
    ) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        provider.require_auth();
        if env.storage().persistent().has(&DataKey::Provider(provider.clone())) {
            return Err(Error::ProviderAlreadyRegistered);
        }
        let profile = ProviderProfile {
            address: provider.clone(),
            name,
            contact_hash,
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Provider(provider.clone()), &profile);
        env.storage()
            .persistent()
            .set(&DataKey::ProviderDatasets(provider), &Vec::<u64>::new(&env));
        Ok(())
    }

    pub fn get_provider(env: Env, provider: Address) -> Option<ProviderProfile> {
        env.storage().persistent().get(&DataKey::Provider(provider))
    }

    // ── Dataset listing ─────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn list_dataset(
        env: Env,
        provider: Address,
        title: String,
        schema_hash: BytesN<32>,
        manifest_hash: BytesN<32>,
        encryption_pubkey: BytesN<32>,
        flat_price: i128,
        price_per_query: i128,
        license_seconds: u64,
    ) -> Result<u64, Error> {
        Self::ensure_running(&env)?;
        provider.require_auth();
        Self::load_provider(&env, &provider)?;
        if flat_price < 0 || price_per_query < 0 {
            return Err(Error::InvalidAmount);
        }
        if license_seconds == 0 {
            return Err(Error::InvalidParameter);
        }

        let mut id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DatasetCounter)
            .unwrap_or(0);
        id += 1;

        let dataset = Dataset {
            id,
            provider: provider.clone(),
            title,
            schema_hash,
            manifest_hash,
            encryption_pubkey,
            flat_price,
            price_per_query,
            license_seconds,
            listed_at: env.ledger().timestamp(),
            delisted: false,
        };

        // effects
        env.storage().instance().set(&DataKey::DatasetCounter, &id);
        env.storage().persistent().set(&DataKey::Dataset(id), &dataset);

        let mut owned: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ProviderDatasets(provider.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        owned.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::ProviderDatasets(provider.clone()), &owned);

        env.storage().persistent().set(
            &DataKey::DatasetStats(id),
            &DatasetStats {
                license_count: 0,
                active_buyers: 0,
                queries_executed: 0,
                revenue: 0,
            },
        );
        env.storage()
            .persistent()
            .set(&DataKey::DatasetBuyers(id), &Vec::<Address>::new(&env));

        let mut active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveDatasets)
            .unwrap_or_else(|| Vec::new(&env));
        active.push_front(id);
        while active.len() > ACTIVE_CAP {
            active.pop_back();
        }
        env.storage().instance().set(&DataKey::ActiveDatasets, &active);

        env.events().publish((TOPIC_LIST, provider), id);
        Ok(id)
    }

    pub fn update_dataset_price(
        env: Env,
        provider: Address,
        id: u64,
        flat_price: i128,
        price_per_query: i128,
    ) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        provider.require_auth();
        if flat_price < 0 || price_per_query < 0 {
            return Err(Error::InvalidAmount);
        }
        let mut dataset = Self::load_dataset(&env, id)?;
        if dataset.provider != provider {
            return Err(Error::Unauthorized);
        }
        if dataset.delisted {
            return Err(Error::DatasetDelisted);
        }
        dataset.flat_price = flat_price;
        dataset.price_per_query = price_per_query;
        env.storage().persistent().set(&DataKey::Dataset(id), &dataset);
        Ok(())
    }

    pub fn delist_dataset(env: Env, provider: Address, id: u64) -> Result<(), Error> {
        Self::ensure_running(&env)?;
        provider.require_auth();
        let mut dataset = Self::load_dataset(&env, id)?;
        if dataset.provider != provider {
            return Err(Error::Unauthorized);
        }
        if dataset.delisted {
            return Ok(());
        }
        dataset.delisted = true;
        env.storage().persistent().set(&DataKey::Dataset(id), &dataset);
        env.events().publish((TOPIC_DELIST, provider), id);
        Ok(())
    }

    pub fn get_dataset(env: Env, id: u64) -> Option<Dataset> {
        env.storage().persistent().get(&DataKey::Dataset(id))
    }

    pub fn get_provider_datasets(env: Env, provider: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::ProviderDatasets(provider))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn list_active_datasets(env: Env) -> Vec<Dataset> {
        let ids: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveDatasets)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(d) = env.storage().persistent().get::<_, Dataset>(&DataKey::Dataset(id)) {
                if !d.delisted {
                    out.push_back(d);
                }
            }
        }
        out
    }

    // ── Access purchase ─────────────────────────────────────────────────────

    pub fn purchase_access(
        env: Env,
        buyer: Address,
        dataset_id: u64,
        max_queries: u32,
    ) -> Result<License, Error> {
        Self::ensure_running(&env)?;
        buyer.require_auth();
        if max_queries == 0 {
            return Err(Error::InvalidParameter);
        }
        let dataset = Self::load_dataset(&env, dataset_id)?;
        if dataset.delisted {
            return Err(Error::DatasetDelisted);
        }
        if buyer == dataset.provider {
            return Err(Error::SelfPurchaseForbidden);
        }

        let cost = dataset
            .price_per_query
            .checked_mul(max_queries as i128)
            .and_then(|v| v.checked_add(dataset.flat_price))
            .ok_or(Error::InvalidAmount)?;

        let now = env.ledger().timestamp();
        let key = DataKey::License(dataset_id, buyer.clone());
        let was_active = env
            .storage()
            .persistent()
            .get::<_, License>(&key)
            .map(|l| l.expires_at > now && l.queries_used < l.queries_total)
            .unwrap_or(false);

        let license = match env.storage().persistent().get::<_, License>(&key) {
            Some(existing) if existing.expires_at > now => License {
                expires_at: existing.expires_at.saturating_add(dataset.license_seconds),
                queries_total: existing.queries_total.saturating_add(max_queries),
                total_paid: existing.total_paid.saturating_add(cost),
                ..existing
            },
            _ => License {
                dataset_id,
                buyer: buyer.clone(),
                purchased_at: now,
                expires_at: now.saturating_add(dataset.license_seconds),
                queries_total: max_queries,
                queries_used: 0,
                total_paid: cost,
            },
        };
        env.storage().persistent().set(&key, &license);

        // Dataset stats
        let mut ds_stats = Self::load_dataset_stats(&env, dataset_id);
        ds_stats.revenue = ds_stats.revenue.saturating_add(cost);
        if !was_active {
            ds_stats.license_count = ds_stats.license_count.saturating_add(1);
            ds_stats.active_buyers = ds_stats.active_buyers.saturating_add(1);
            let mut roster: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::DatasetBuyers(dataset_id))
                .unwrap_or_else(|| Vec::new(&env));
            if !roster.contains(&buyer) {
                roster.push_back(buyer.clone());
            }
            env.storage()
                .persistent()
                .set(&DataKey::DatasetBuyers(dataset_id), &roster);
        }
        env.storage()
            .persistent()
            .set(&DataKey::DatasetStats(dataset_id), &ds_stats);

        // Buyer stats
        let mut b_stats = Self::load_buyer_stats(&env, &buyer);
        b_stats.total_spent = b_stats.total_spent.saturating_add(cost);
        if !was_active {
            b_stats.licenses_purchased = b_stats.licenses_purchased.saturating_add(1);
        }
        env.storage()
            .persistent()
            .set(&DataKey::BuyerStats(buyer.clone()), &b_stats);

        env.events()
            .publish((TOPIC_BUY, dataset.provider, dataset_id), (buyer, cost));
        Ok(license)
    }

    pub fn get_license(
        env: Env,
        dataset_id: u64,
        buyer: Address,
    ) -> Option<License> {
        env.storage().persistent().get(&DataKey::License(dataset_id, buyer))
    }

    // ── Privacy-preserving query ───────────────────────────────────────────

    /// Submit a commitment `H(query || nonce || buyer_pk)` representing one
    /// off-chain query. The contract decrements the buyer's quota, records the
    /// commitment for replay protection / audit, and emits an event. The query
    /// content is **never** visible on-chain.
    pub fn submit_query(
        env: Env,
        buyer: Address,
        dataset_id: u64,
        commitment: BytesN<32>,
    ) -> Result<QueryReceipt, Error> {
        Self::ensure_running(&env)?;
        buyer.require_auth();

        let dataset = Self::load_dataset(&env, dataset_id)?;
        if buyer == dataset.provider {
            return Err(Error::SelfQueryForbidden);
        }

        let lic_key = DataKey::License(dataset_id, buyer.clone());
        let mut license: License = env
            .storage()
            .persistent()
            .get(&lic_key)
            .ok_or(Error::LicenseNotFound)?;

        let now = env.ledger().timestamp();
        if license.expires_at <= now {
            return Err(Error::LicenseExpired);
        }
        if license.queries_used >= license.queries_total {
            return Err(Error::NoQuotaRemaining);
        }

        let receipt_key = DataKey::QueryReceipt(commitment.clone());
        if env.storage().persistent().has(&receipt_key) {
            return Err(Error::CommitmentAlreadyUsed);
        }

        license.queries_used = license.queries_used.saturating_add(1);
        env.storage().persistent().set(&lic_key, &license);

        let receipt = QueryReceipt {
            commitment: commitment.clone(),
            dataset_id,
            buyer: buyer.clone(),
            timestamp: now,
            sequence: license.queries_used,
        };
        env.storage().persistent().set(&receipt_key, &receipt);

        let mut ds_stats = Self::load_dataset_stats(&env, dataset_id);
        ds_stats.queries_executed = ds_stats.queries_executed.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::DatasetStats(dataset_id), &ds_stats);

        let mut b_stats = Self::load_buyer_stats(&env, &buyer);
        b_stats.queries_executed = b_stats.queries_executed.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::BuyerStats(buyer.clone()), &b_stats);

        env.events()
            .publish((TOPIC_QUERY, dataset.provider, dataset_id), (buyer, commitment));
        Ok(receipt)
    }

    pub fn get_query_receipt(env: Env, commitment: BytesN<32>) -> Option<QueryReceipt> {
        env.storage().persistent().get(&DataKey::QueryReceipt(commitment))
    }

    /// Off-chain reveal helper: anyone can verify a `(query, nonce, buyer_pk)`
    /// triple matches a recorded commitment using the chain's SHA-256.
    pub fn verify_commitment(
        env: Env,
        commitment: BytesN<32>,
        preimage: soroban_sdk::Bytes,
    ) -> bool {
        let computed = env.crypto().sha256(&preimage);
        BytesN::<32>::from_array(&env, &computed.to_array()) == commitment
    }

    // ── Analytics ───────────────────────────────────────────────────────────

    pub fn get_dataset_stats(env: Env, dataset_id: u64) -> Option<DatasetStats> {
        env.storage().persistent().get(&DataKey::DatasetStats(dataset_id))
    }

    pub fn get_buyer_stats(env: Env, buyer: Address) -> Option<BuyerStats> {
        env.storage().persistent().get(&DataKey::BuyerStats(buyer))
    }

    pub fn get_dataset_buyers(env: Env, dataset_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DatasetBuyers(dataset_id))
            .unwrap_or_else(|| Vec::new(&env))
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

    fn load_provider(env: &Env, provider: &Address) -> Result<ProviderProfile, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Provider(provider.clone()))
            .ok_or(Error::ProviderNotFound)
    }

    fn load_dataset(env: &Env, id: u64) -> Result<Dataset, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Dataset(id))
            .ok_or(Error::DatasetNotFound)
    }

    fn load_dataset_stats(env: &Env, id: u64) -> DatasetStats {
        env.storage()
            .persistent()
            .get(&DataKey::DatasetStats(id))
            .unwrap_or(DatasetStats {
                license_count: 0,
                active_buyers: 0,
                queries_executed: 0,
                revenue: 0,
            })
    }

    fn load_buyer_stats(env: &Env, buyer: &Address) -> BuyerStats {
        env.storage()
            .persistent()
            .get(&DataKey::BuyerStats(buyer.clone()))
            .unwrap_or(BuyerStats {
                licenses_purchased: 0,
                queries_executed: 0,
                total_spent: 0,
            })
    }
}

#[cfg(test)]
mod test;
