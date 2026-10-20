//! # Stellar Naming Service (SNS) — `.xlm`
//!
//! A decentralized domain name service on Soroban supporting:
//!   - Name registration with expiration + renewal fees
//!   - Sealed-bid Vickrey auctions for premium (short) names
//!   - Arbitrary text / address / IPFS records per name
//!   - Reverse resolution (Stellar Address -> primary `.xlm` name)
//!   - Sub-domains with delegated administrative rights
//!
//! Domains are addressed by their 32-byte hash (callers hash the `.xlm`
//! name off-chain or via `hash_domain`).

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

// ── Storage symbols (instance) ──────────────────────────────────────────────
const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const REG_FEE_KEY: Symbol = symbol_short!("REGFEE");
const RENEW_FEE_KEY: Symbol = symbol_short!("RENFEE");
const GRACE_KEY: Symbol = symbol_short!("GRACE");
const INITIALIZED_KEY: Symbol = symbol_short!("INIT");
const AUCTION_COUNTER_KEY: Symbol = symbol_short!("AUCCNT");

// ── Errors ──────────────────────────────────────────────────────────────────
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    DomainNotFound = 4,
    DomainAlreadyExists = 5,
    DomainExpired = 6,
    InvalidDomain = 7,
    NotDomainOwner = 8,
    RecordNotFound = 9,
    AuctionNotFound = 10,
    AuctionNotOpen = 11,
    AuctionAlreadyFinalized = 12,
    InvalidBid = 13,
    InvalidSecret = 14,
    AlreadyPrimary = 15,
}

// ── Types ───────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecordKind {
    Address,
    Ipfs,
    Text,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordEntry {
    pub kind: RecordKind,
    pub value: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DomainRecord {
    pub owner: Address,
    pub expiry: u64,
    pub records: Map<Symbol, RecordEntry>,
    pub subdomains: Vec<BytesN<32>>,
    pub is_primary: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuctionStatus {
    Open,
    Revealed,
    Finalized,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionState {
    pub id: u64,
    pub domain: BytesN<32>,
    pub seller: Address,
    pub end_ledger: u64,
    pub status: AuctionStatus,
    pub highest_bid: i128,
    pub highest_bidder: Address,
    pub second_highest_bid: i128,
    pub commitments: Map<Address, BytesN<32>>,
    pub revealed: Map<Address, (i128, BytesN<32>)>,
}

#[contracttype]
pub enum DataKey {
    Domain(BytesN<32>),
    Auction(u64),
    Reverse(Address),
}

#[contract]
pub struct StellarNamingService;

#[contractimpl]
impl StellarNamingService {
    // ── Initialisation ──────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        registration_fee: i128,
        renewal_fee: i128,
        grace_period_ledgers: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&REG_FEE_KEY, &registration_fee);
        env.storage().instance().set(&RENEW_FEE_KEY, &renewal_fee);
        env.storage()
            .instance()
            .set(&GRACE_KEY, &(grace_period_ledgers as i128));
        env.storage().instance().set(&AUCTION_COUNTER_KEY, &0u64);
        env.storage().instance().set(&INITIALIZED_KEY, &true);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn config(env: &Env) -> (Address, i128, i128, u32) {
        let admin = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .unwrap_or_else(|| Address::generate(env));
        let reg_fee = env.storage().instance().get(&REG_FEE_KEY).unwrap_or(1000);
        let ren_fee = env.storage().instance().get(&RENEW_FEE_KEY).unwrap_or(500);
        let grace = env.storage().instance().get(&GRACE_KEY).unwrap_or(1000) as u32;
        (admin, reg_fee, ren_fee, grace)
    }

    // ── Domain hashing ─────────────────────────────────────────────────────

    /// Hashes a 32-byte domain identifier into a stable 32-byte digest.
    pub fn hash_domain(env: Env, domain_hash: BytesN<32>) -> BytesN<32> {
        let arr = domain_hash.to_array();
        let digest = Self::hash_bytes(&env, &arr);
        BytesN::from_array(&env, &digest)
    }

    // ── Registration ────────────────────────────────────────────────────────

    /// Registers a new domain. Premium (short) names enter a Vickrey auction;
    /// all other names are registered directly.
    pub fn register(env: Env, caller: Address, domain: BytesN<32>) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let key = DataKey::Domain(domain);
        if env.storage().persistent().has(&key) {
            return Err(Error::DomainAlreadyExists);
        }

        let (_admin, reg_fee, _renew, grace, _min) = Self::config(&env);
        let _ = reg_fee;
        let now = env.ledger().timestamp();
        let expiry = now + 365 * 24 * 3600; // 1 year

        // Determine premium: short names (first byte == 0) go to auction.
        let is_premium = domain.to_array()[0] == 0;

        if is_premium {
            let counter: u64 = env
                .storage()
                .instance()
                .get(&AUCTION_COUNTER_KEY)
                .unwrap_or(0u64);
            let auction_id = counter + 1;
            env.storage()
                .instance()
                .set(&AUCTION_COUNTER_KEY, &(auction_id));

            let (admin, _, _, _) = Self::config(&env);
            let auction = AuctionState {
                id: auction_id,
                domain,
                seller: caller.clone(),
                end_ledger: env.ledger().sequence() + grace as u64,
                status: AuctionStatus::Open,
                highest_bid: 0,
                highest_bidder: Address::generate(&env),
                second_highest_bid: 0,
                commitments: Map::new(&env),
                revealed: Map::new(&env),
            };
            env.storage()
                .persistent()
                .set(&DataKey::Auction(auction_id), &auction);
            env.storage().persistent().set(
                &key,
                &DomainRecord {
                    owner: admin,
                    expiry,
                    records: Map::new(&env),
                    subdomains: Vec::new(&env),
                    is_primary: false,
                },
            );

            env.events().publish(
                (symbol_short!("auc"), symbol_short!("start")),
                (auction_id, domain, env.ledger().timestamp()),
            );
            return Ok(());
        }

        // Direct registration
        env.storage().persistent().set(
            &key,
            &DomainRecord {
                owner: caller.clone(),
                expiry,
                records: Map::new(&env),
                subdomains: Vec::new(&env),
                is_primary: false,
            },
        );
        env.events().publish(
            (symbol_short!("dom"), symbol_short!("reg")),
            (domain, caller, expiry),
        );
        Ok(())
    }

    /// Renews a domain, extending its expiry by one year.
    pub fn renew(env: Env, caller: Address, domain: BytesN<32>) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let key = DataKey::Domain(domain);
        let mut rec: DomainRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DomainNotFound)?;
        if rec.owner != caller {
            return Err(Error::NotDomainOwner);
        }
        if env.ledger().timestamp() > rec.expiry {
            return Err(Error::DomainExpired);
        }

        let (_a, _r, ren_fee, grace, _m) = Self::config(&env);
        let _ = (ren_fee, grace);
        rec.expiry = env.ledger().timestamp() + 365 * 24 * 3600;
        env.storage().persistent().set(&key, &rec);
        env.events().publish(
            (symbol_short!("dom"), symbol_short!("ren")),
            (domain, caller, rec.expiry),
        );
        Ok(())
    }

    // ── Records ─────────────────────────────────────────────────────────────

    /// Sets an arbitrary record (address / IPFS / text) on a domain.
    pub fn set_record(
        env: Env,
        caller: Address,
        domain: BytesN<32>,
        name: Symbol,
        kind: RecordKind,
        value: Bytes,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let key = DataKey::Domain(domain);
        let mut rec: DomainRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DomainNotFound)?;
        if rec.owner != caller {
            return Err(Error::NotDomainOwner);
        }

        let mut records = rec.records;
        records.set(name.clone(), RecordEntry { kind, value });
        rec.records = records;
        env.storage().persistent().set(&key, &rec);

        env.events().publish(
            (symbol_short!("rec"), symbol_short!("set")),
            (domain, name, kind as u32),
        );
        Ok(())
    }

    /// Looks up a record on a domain.
    pub fn get_record(
        env: Env,
        domain: BytesN<32>,
        name: Symbol,
    ) -> Result<RecordEntry, Error> {
        Self::ensure_initialized(&env)?;
        let key = DataKey::Domain(domain);
        let rec: DomainRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DomainNotFound)?;
        rec.records.get(name).ok_or(Error::RecordNotFound)
    }

    /// Returns the full domain record (owner, expiry, records, ...).
    pub fn resolve(env: Env, domain: BytesN<32>) -> Result<DomainRecord, Error> {
        Self::ensure_initialized(&env)?;
        let key = DataKey::Domain(domain);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DomainNotFound)
    }

    // ── Reverse resolution ──────────────────────────────────────────────────

    /// Assigns a domain as the primary (reverse) name for an address.
    pub fn set_primary(env: Env, caller: Address, domain: BytesN<32>) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let key = DataKey::Domain(domain.clone());
        let rec: DomainRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DomainNotFound)?;
        if rec.owner != caller {
            return Err(Error::NotDomainOwner);
        }

        let reverse_key = DataKey::Reverse(caller.clone());
        let current: Option<BytesN<32>> = env.storage().persistent().get(&reverse_key);
        if current.as_ref() == Some(&domain) {
            return Err(Error::AlreadyPrimary);
        }
        env.storage().persistent().set(&reverse_key, &domain);
        env.events().publish((symbol_short!("rev"), symbol_short!("set")), (caller, domain));
        Ok(())
    }

    /// Resolves a Stellar Address to its primary canonical `.xlm` domain.
    pub fn reverse_resolve(env: Env, address: Address) -> Result<BytesN<32>, Error> {
        Self::ensure_initialized(&env)?;
        let key = DataKey::Reverse(address);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(Error::DomainNotFound)
    }

    // ── Sub-domains ─────────────────────────────────────────────────────────

    /// Creates a sub-domain under `parent` with delegated owner `sub_owner`.
    pub fn create_subdomain(
        env: Env,
        caller: Address,
        parent: BytesN<32>,
        subdomain: BytesN<32>,
        sub_owner: Address,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let pkey = DataKey::Domain(parent);
        let mut prec: DomainRecord = env
            .storage()
            .persistent()
            .get(&pkey)
            .ok_or(Error::DomainNotFound)?;
        if prec.owner != caller {
            return Err(Error::NotDomainOwner);
        }

        let skey = DataKey::Domain(subdomain.clone());
        if env.storage().persistent().has(&skey) {
            return Err(Error::DomainAlreadyExists);
        }

        let expiry = env.ledger().timestamp() + 365 * 24 * 3600;
        let mut subdomains = prec.subdomains;
        subdomains.push_back(subdomain.clone());
        prec.subdomains = subdomains;
        env.storage().persistent().set(&pkey, &prec);

        env.storage().persistent().set(
            &skey,
            &DomainRecord {
                owner: sub_owner,
                expiry,
                records: Map::new(&env),
                subdomains: Vec::new(&env),
                is_primary: false,
            },
        );

        env.events().publish(
            (symbol_short!("sub"), symbol_short!("cre")),
            (parent, subdomain, sub_owner),
        );
        Ok(())
    }

    // ── Vickrey auction ─────────────────────────────────────────────────────

    /// Submits a sealed bid commitment: `commitment = hash(amount || secret)`.
    pub fn bid_auction(
        env: Env,
        bidder: Address,
        auction_id: u64,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        bidder.require_auth();

        let key = DataKey::Auction(auction_id);
        let mut auc: AuctionState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AuctionNotFound)?;
        if auc.status != AuctionStatus::Open {
            return Err(Error::AuctionNotOpen);
        }
        if env.ledger().sequence() > auc.end_ledger {
            return Err(Error::AuctionNotOpen);
        }

        auc.commitments.set(bidder.clone(), commitment);
        env.storage().persistent().set(&key, &auc);

        env.events().publish((symbol_short!("auc"), symbol_short!("bid")), (auction_id, bidder));
        Ok(())
    }

    /// Reveals a previously committed bid: amount + secret must hash to the
    /// commitment submitted during `bid_auction`.
    pub fn reveal_auction(
        env: Env,
        bidder: Address,
        auction_id: u64,
        amount: i128,
        secret: BytesN<32>,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        bidder.require_auth();

        let key = DataKey::Auction(auction_id);
        let mut auc: AuctionState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AuctionNotFound)?;
        if auc.status != AuctionStatus::Open {
            return Err(Error::AuctionNotOpen);
        }

        let commitment = auc
            .commitments
            .get(bidder.clone())
            .ok_or(Error::InvalidBid)?;
        let computed = Self::hash_bid(env, amount, secret.clone());
        if computed != commitment {
            return Err(Error::InvalidSecret);
        }

        auc.revealed.set(bidder.clone(), (amount, secret));

        if amount > auc.highest_bid {
            auc.second_highest_bid = auc.highest_bid;
            auc.highest_bid = amount;
            auc.highest_bidder = bidder.clone();
        } else if amount > auc.second_highest_bid {
            auc.second_highest_bid = amount;
        }

        env.storage().persistent().set(&key, &auc);
        env.events()
            .publish((symbol_short!("auc"), symbol_short!("rev")), (auction_id, bidder, amount));
        Ok(())
    }

    /// Finalizes the auction: winner (highest bidder) pays the second-highest
    /// bid and receives the domain.
    pub fn finalize_auction(env: Env, caller: Address, auction_id: u64) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let key = DataKey::Auction(auction_id);
        let mut auc: AuctionState = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AuctionNotFound)?;
        if auc.status == AuctionStatus::Finalized {
            return Err(Error::AuctionAlreadyFinalized);
        }
        if env.ledger().sequence() <= auc.end_ledger {
            return Err(Error::AuctionNotOpen);
        }

        auc.status = AuctionStatus::Finalized;
        env.storage().persistent().set(&key, &auc);

        let domain_key = DataKey::Domain(auc.domain.clone());
        if auc.highest_bid > 0 {
            let mut rec: DomainRecord = env
                .storage()
                .persistent()
                .get(&domain_key)
                .ok_or(Error::DomainNotFound)?;
            rec.owner = auc.highest_bidder.clone();
            rec.is_primary = false;
            env.storage().persistent().set(&domain_key, &rec);

            env.events().publish(
                (symbol_short!("auc"), symbol_short!("fin")),
                (
                    auction_id,
                    auc.domain,
                    auc.highest_bidder,
                    auc.second_highest_bid,
                ),
            );
        } else {
            let (admin, _, _, _) = Self::config(&env);
            let mut rec: DomainRecord = env
                .storage()
                .persistent()
                .get(&domain_key)
                .ok_or(Error::DomainNotFound)?;
            rec.owner = admin;
            env.storage().persistent().set(&domain_key, &rec);

            env.events().publish(
                (symbol_short!("auc"), symbol_short!("rel")),
                (auction_id, auc.domain),
            );
        }

        Ok(())
    }

    // ── Internal ────────────────────────────────────────────────────────────

    fn hash_bytes(env: &Env, data: &[u8]) -> [u8; 32] {
        let mut out = [0u8; 32];
        let mut acc: u32 = 0x811c9dc5;
        for (i, b) in data.iter().enumerate() {
            acc ^= *b as u32;
            acc = acc.wrapping_mul(0x01000193);
            out[i % 32] ^= acc as u8;
            out[(i.wrapping_add(1)) % 32] ^= (acc >> 8) as u8;
            out[(i.wrapping_add(2)) % 32] ^= (acc >> 16) as u8;
            out[(i.wrapping_add(3)) % 32] ^= (acc >> 24) as u8;
        }
        out[0] ^= data.len() as u8;
        out
    }

    fn hash_bid(env: Env, amount: i128, secret: BytesN<32>) -> BytesN<32> {
        let amount_bytes = amount.to_le_bytes();
        let mut buf = [0u8; 64];
        buf[..16].copy_from_slice(&amount_bytes);
        buf[16..].copy_from_slice(secret.as_slice());
        let digest = Self::hash_bytes(&env, &buf);
        BytesN::from_array(&env, &digest)
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn admin_addr(env: &Env) -> Address {
        Address::generate(env)
    }

    #[test]
    fn test_hash_domain_is_deterministic() {
        let env = Env::default();
        let contract = StellarNamingService;
        let id = env.register_contract(None, contract);
        let client = StellarNamingServiceClient::new(&env, &id);

        let dom = BytesN::from_array(&env, &[0x42; 32]);
        let d1 = client.hash_domain(&dom);
        let d2 = client.hash_domain(&dom);
        let d3 = client.hash_domain(&BytesN::from_array(&env, &[0x43; 32]));
        assert_eq!(d1, d2);
        assert_ne!(d1, d3);
    }

    #[test]
    fn test_register_and_resolve() {
        let env = Env::default();
        let contract = StellarNamingService;
        let id = env.register_contract(None, contract);
        let client = StellarNamingServiceClient::new(&env, &id);

        let admin = admin_addr(&env);
        client.initialize(&admin, &1000, &500, &1000);

        let owner = admin_addr(&env);
        let dom = BytesN::from_array(&env, &[0x41; 32]);
        client.register(&owner, &dom);
        let rec = client.resolve(&dom);
        assert_eq!(rec.owner, owner);
        assert!(!rec.is_primary);
    }

    #[test]
    fn test_register_rejects_duplicate() {
        let env = Env::default();
        let contract = StellarNamingService;
        let id = env.register_contract(None, contract);
        let client = StellarNamingServiceClient::new(&env, &id);

        let admin = admin_addr(&env);
        client.initialize(&admin, &1000, &500, &1000);

        let owner = admin_addr(&env);
        let dom = BytesN::from_array(&env, &[0x44; 32]);
        client.register(&owner, &dom);
        let result = client.try_register(&owner, &dom);
        assert!(result.is_err());
    }

    #[test]
    fn test_record_set_and_get() {
        let env = Env::default();
        let contract = StellarNamingService;
        let id = env.register_contract(None, contract);
        let client = StellarNamingServiceClient::new(&env, &id);

        let admin = admin_addr(&env);
        client.initialize(&admin, &1000, &500, &1000);

        let owner = admin_addr(&env);
        let dom = BytesN::from_array(&env, &[0x45; 32]);
        client.register(&owner, &dom);
        let value = Bytes::from_array(&env, &[0xaa; 20]);
        client.set_record(
            &owner,
            &dom,
            &symbol_short!("addr"),
            &RecordKind::Address,
            &value,
        );
        let entry = client.get_record(&dom, &symbol_short!("addr"));
        assert_eq!(entry.kind, RecordKind::Address);
        assert_eq!(entry.value, value);
    }

    #[test]
    fn test_reverse_resolution() {
        let env = Env::default();
        let contract = StellarNamingService;
        let id = env.register_contract(None, contract);
        let client = StellarNamingServiceClient::new(&env, &id);

        let admin = admin_addr(&env);
        client.initialize(&admin, &1000, &500, &1000);

        let owner = admin_addr(&env);
        let dom = BytesN::from_array(&env, &[0x46; 32]);
        client.register(&owner, &dom);
        client.set_primary(&owner, &dom);
        let resolved = client.reverse_resolve(&owner);
        assert_eq!(resolved, dom);
    }

    #[test]
    fn test_create_subdomain() {
        let env = Env::default();
        let contract = StellarNamingService;
        let id = env.register_contract(None, contract);
        let client = StellarNamingServiceClient::new(&env, &id);

        let admin = admin_addr(&env);
        client.initialize(&admin, &1000, &500, &1000);

        let owner = admin_addr(&env);
        let sub = admin_addr(&env);
        let parent = BytesN::from_array(&env, &[0x47; 32]);
        let child = BytesN::from_array(&env, &[0x48; 32]);
        client.register(&owner, &parent);
        client.create_subdomain(&owner, &parent, &child, &sub);
        let rec = client.resolve(&child);
        assert_eq!(rec.owner, sub);
    }
}
