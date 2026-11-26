//! # Gas Tank Relay — Sponsored Gasless Transactions
//!
//! A sponsor contract that lets DApps deposit XLM reserves to subsidize
//! transaction fees for end-users. Enforces per-user daily quotas and a
//! whitelist of authorised target contracts and method names. Emits
//! `GasSponsored` telemetry for every subsidised call.
//!
//! ## Drainage prevention
//!
//! [`GasSponsorTank::sponsor_transaction`] layers four independent defences on
//! top of the whitelist so a single actor cannot drain the sponsor pool:
//!
//! 1. **Token bucket rate limiting** per `(user, target)` pair — a bucket of
//!    `bucket_capacity` units refills at `refill_rate` units per second.
//! 2. **Daily sponsorship caps** per user, reset every [`SECONDS_PER_DAY`].
//! 3. **Global circuit breaker** — once the DApp reserve falls below
//!    `circuit_breaker_bps` (default 10%) of its high-water mark, sponsorship
//!    is rejected until the operator tops the tank up.
//! 4. **Backend relayer attestation** — every sponsorship must carry an
//!    ed25519 signature from the registered relayer over the request payload.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    Symbol,
};

const SPONSOR_KEY: Symbol = symbol_short!("SPONSOR");
const MAX_GAS_KEY: Symbol = symbol_short!("MAXGAS");
const TOTAL_RESERVES_KEY: Symbol = symbol_short!("TOTRES");
const INITIALIZED_KEY: Symbol = symbol_short!("INIT");
const RELAYER_KEY: Symbol = symbol_short!("RELAYER");
const RELAYER_PK_KEY: Symbol = symbol_short!("RELPK");
const BUCKET_CAP_KEY: Symbol = symbol_short!("BUCAP");
const REFILL_RATE_KEY: Symbol = symbol_short!("BURATE");
const DAILY_CAP_KEY: Symbol = symbol_short!("DAYCAP");
const CB_BPS_KEY: Symbol = symbol_short!("CBBPS");

const SECONDS_PER_DAY: u64 = 86400;
/// Default circuit-breaker threshold: 10% of the reserve high-water mark.
const DEFAULT_CIRCUIT_BREAKER_BPS: u32 = 1000;
const BPS_DENOMINATOR: i128 = 10_000;
/// Domain separator for relayer attestations.
const ATTESTATION_DOMAIN: &[u8] = b"GST1";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    NotWhitelisted = 4,
    QuotaExceeded = 5,
    InsufficientReserves = 6,
    InvalidGasLimit = 7,
    MaxGasExceeded = 8,
    DAppNotFound = 9,
    /// No backend relayer has been registered.
    RelayerNotSet = 10,
    /// The relayer attestation signature is missing or invalid.
    InvalidAttestation = 11,
    /// The attestation nonce was already consumed (replay).
    AttestationReplayed = 12,
    /// The per-(user, target) token bucket is empty.
    RateLimited = 13,
    /// The user's daily sponsorship cap is exhausted.
    DailyCapExceeded = 14,
    /// The global circuit breaker tripped: reserves below the safety floor.
    CircuitBreakerOpen = 15,
    /// A configured limit was out of range.
    InvalidConfig = 16,
}

// ── Types ───────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SponsorshipEvent {
    pub dapp: Address,
    pub user: Address,
    pub target: Address,
    pub method: Symbol,
    pub gas_used: i128,
    pub timestamp: u64,
}

/// Token bucket state for a `(user, target)` pair.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bucket {
    /// Units currently available.
    pub tokens: i128,
    /// Ledger timestamp of the last refill.
    pub last_refill: u64,
}

#[contracttype]
pub enum DataKey {
    Reserve(Address),
    Usage((Address, u64)),
    Quota(Address),
    WhitelistContract(Address),
    WhitelistMethod((Address, Symbol)),
    /// Token bucket keyed by `(user, target)`.
    Bucket((Address, Address)),
    /// Daily sponsored spend keyed by `(user, day)`.
    DailyUsage((Address, u64)),
    /// Highest reserve balance ever observed for a DApp.
    ReserveHighWater(Address),
    /// Last consumed relayer attestation nonce per user.
    AttestationNonce(Address),
}

#[contract]
pub struct GasSponsorTank;

#[contractimpl]
impl GasSponsorTank {
    // ── Initialisation ──────────────────────────────────────────────────────

    pub fn initialize(env: Env, sponsor: Address, max_gas_per_tx: i128) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&INITIALIZED_KEY)
            .unwrap_or(false)
        {
            return Err(Error::AlreadyInitialized);
        }
        sponsor.require_auth();
        if max_gas_per_tx <= 0 {
            return Err(Error::InvalidGasLimit);
        }
        env.storage().instance().set(&SPONSOR_KEY, &sponsor);
        env.storage().instance().set(&MAX_GAS_KEY, &max_gas_per_tx);
        env.storage().instance().set(&TOTAL_RESERVES_KEY, &0i128);
        env.storage().instance().set(&INITIALIZED_KEY, &true);
        // Sensible drainage-prevention defaults.
        env.storage().instance().set(&BUCKET_CAP_KEY, &max_gas_per_tx);
        env.storage().instance().set(&REFILL_RATE_KEY, &1i128);
        env.storage()
            .instance()
            .set(&DAILY_CAP_KEY, &(max_gas_per_tx * 10));
        env.storage()
            .instance()
            .set(&CB_BPS_KEY, &DEFAULT_CIRCUIT_BREAKER_BPS);
        env.events()
            .publish((symbol_short!("init"),), (sponsor, max_gas_per_tx));
        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env
            .storage()
            .instance()
            .get(&INITIALIZED_KEY)
            .unwrap_or(false)
        {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn sponsor(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&SPONSOR_KEY)
            .ok_or(Error::NotInitialized)
    }

    fn require_sponsor(env: &Env, caller: &Address) -> Result<(), Error> {
        if caller != &Self::sponsor(env)? {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    // ── DApp reserves ───────────────────────────────────────────────────────

    /// A DApp deposits XLM reserves to fund sponsored transactions.
    pub fn deposit(env: Env, dapp: Address, amount: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        dapp.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidGasLimit);
        }

        let rkey = DataKey::Reserve(dapp.clone());
        let prior: i128 = env.storage().persistent().get(&rkey).unwrap_or(0i128);
        let new_reserve = prior + amount;
        env.storage().persistent().set(&rkey, &new_reserve);

        // Track the high-water mark used by the circuit breaker.
        let hw_key = DataKey::ReserveHighWater(dapp.clone());
        let high_water: i128 = env.storage().persistent().get(&hw_key).unwrap_or(0i128);
        if new_reserve > high_water {
            env.storage().persistent().set(&hw_key, &new_reserve);
        }

        let total: i128 = env
            .storage()
            .instance()
            .get(&TOTAL_RESERVES_KEY)
            .unwrap_or(0i128);
        env.storage()
            .instance()
            .set(&TOTAL_RESERVES_KEY, &(total + amount));

        env.events()
            .publish((symbol_short!("deposit"),), (dapp, amount));
        Ok(())
    }

    /// Returns a DApp's remaining reserve balance.
    pub fn get_reserve(env: Env, dapp: Address) -> i128 {
        let _ = Self::ensure_initialized(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Reserve(dapp))
            .unwrap_or(0i128)
    }

    // ── Whitelist ───────────────────────────────────────────────────────────

    /// Whitelists a target contract for sponsored calls (admin only).
    pub fn whitelist_contract(env: Env, caller: Address, target: Address) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        env.storage()
            .persistent()
            .set(&DataKey::WhitelistContract(target.clone()), &true);
        env.events()
            .publish((symbol_short!("wlst"), symbol_short!("ctr")), target);
        Ok(())
    }

    /// Whitelists a (contract, method) pair for sponsored calls (admin only).
    pub fn whitelist_method(
        env: Env,
        caller: Address,
        target: Address,
        method: Symbol,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        env.storage().persistent().set(
            &DataKey::WhitelistMethod((target.clone(), method.clone())),
            &true,
        );
        env.events().publish(
            (symbol_short!("wlst"), symbol_short!("mth")),
            (target, method),
        );
        Ok(())
    }

    /// Sets the daily gas quota for a user (admin only).
    pub fn set_quota(env: Env, caller: Address, user: Address, quota: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        env.storage()
            .persistent()
            .set(&DataKey::Quota(user.clone()), &quota);
        env.events()
            .publish((symbol_short!("qta"), symbol_short!("set")), (user, quota));
        Ok(())
    }

    // ── Rate limiting / drainage prevention config ──────────────────────────

    /// Registers the backend relayer and its ed25519 public key (admin only).
    ///
    /// Every [`GasSponsorTank::sponsor_transaction`] call must carry a
    /// signature from this key over the request payload.
    pub fn set_relayer(
        env: Env,
        caller: Address,
        relayer: Address,
        public_key: BytesN<32>,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        env.storage().instance().set(&RELAYER_KEY, &relayer);
        env.storage().instance().set(&RELAYER_PK_KEY, &public_key);
        env.events()
            .publish((symbol_short!("relayer"),), (relayer, public_key));
        Ok(())
    }

    /// Returns the registered relayer address, if any.
    pub fn get_relayer(env: Env) -> Option<Address> {
        env.storage().instance().get(&RELAYER_KEY)
    }

    /// Configures the per-`(user, target)` token bucket (admin only).
    ///
    /// `capacity` is the maximum number of units a bucket can hold and
    /// `refill_rate` is the number of units restored per second.
    pub fn set_rate_limit(
        env: Env,
        caller: Address,
        capacity: i128,
        refill_rate: i128,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        if capacity <= 0 || refill_rate <= 0 {
            return Err(Error::InvalidConfig);
        }
        env.storage().instance().set(&BUCKET_CAP_KEY, &capacity);
        env.storage().instance().set(&REFILL_RATE_KEY, &refill_rate);
        env.events()
            .publish((symbol_short!("rate"),), (capacity, refill_rate));
        Ok(())
    }

    /// Sets the per-user daily sponsorship cap (admin only).
    pub fn set_daily_cap(env: Env, caller: Address, cap: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        if cap <= 0 {
            return Err(Error::InvalidConfig);
        }
        env.storage().instance().set(&DAILY_CAP_KEY, &cap);
        env.events().publish((symbol_short!("daycap"),), cap);
        Ok(())
    }

    /// Sets the circuit-breaker threshold in basis points of the reserve
    /// high-water mark (admin only). `1000` == 10%.
    pub fn set_circuit_breaker(env: Env, caller: Address, threshold_bps: u32) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::require_sponsor(&env, &caller)?;
        if threshold_bps > BPS_DENOMINATOR as u32 {
            return Err(Error::InvalidConfig);
        }
        env.storage().instance().set(&CB_BPS_KEY, &threshold_bps);
        env.events().publish((symbol_short!("cb"),), threshold_bps);
        Ok(())
    }

    /// Whether the global circuit breaker is currently tripped for `dapp`.
    pub fn is_circuit_breaker_open(env: Env, dapp: Address) -> bool {
        Self::circuit_breaker_open(&env, &dapp)
    }

    fn circuit_breaker_open(env: &Env, dapp: &Address) -> bool {
        let reserve: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Reserve(dapp.clone()))
            .unwrap_or(0i128);
        let high_water: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ReserveHighWater(dapp.clone()))
            .unwrap_or(0i128);
        if high_water <= 0 {
            return false;
        }
        let bps: u32 = env
            .storage()
            .instance()
            .get(&CB_BPS_KEY)
            .unwrap_or(DEFAULT_CIRCUIT_BREAKER_BPS);
        let floor = high_water * (bps as i128) / BPS_DENOMINATOR;
        reserve < floor
    }

    // ── Token bucket ────────────────────────────────────────────────────────

    fn bucket_capacity(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&BUCKET_CAP_KEY)
            .unwrap_or(1_000_000)
    }

    fn refill_rate(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&REFILL_RATE_KEY)
            .unwrap_or(1)
    }

    /// Loads the bucket for `(user, target)`, refilling it for elapsed time.
    fn load_bucket(env: &Env, user: &Address, target: &Address) -> Bucket {
        let capacity = Self::bucket_capacity(env);
        let rate = Self::refill_rate(env);
        let now = env.ledger().timestamp();
        let key = DataKey::Bucket((user.clone(), target.clone()));
        match env.storage().persistent().get::<DataKey, Bucket>(&key) {
            Some(bucket) => {
                let elapsed = now.saturating_sub(bucket.last_refill);
                let refilled = bucket
                    .tokens
                    .saturating_add((elapsed as i128).saturating_mul(rate))
                    .min(capacity);
                Bucket {
                    tokens: refilled,
                    last_refill: now,
                }
            }
            None => Bucket {
                tokens: capacity,
                last_refill: now,
            },
        }
    }

    /// Returns the number of tokens currently available for `(user, target)`.
    pub fn get_bucket_tokens(env: Env, user: Address, target: Address) -> i128 {
        Self::load_bucket(&env, &user, &target).tokens
    }

    /// Returns the amount sponsored for `user` on `day`.
    pub fn get_daily_usage(env: Env, user: Address, day: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DailyUsage((user, day)))
            .unwrap_or(0i128)
    }

    // ── Attestation ─────────────────────────────────────────────────────────

    /// Builds the relayer attestation preimage:
    ///
    /// ```text
    /// b"GST1" || user(32) || target(32) || method(32) || max_fee_be(16) || nonce_be(8)
    /// ```
    fn attestation_preimage(
        env: &Env,
        user: &Address,
        target: &Address,
        method: &Symbol,
        max_fee: i128,
        nonce: u64,
    ) -> Bytes {
        let mut preimage = Bytes::from_slice(env, ATTESTATION_DOMAIN);
        preimage.append(&Bytes::from_array(env, &user.to_string().into_bytes()));
        preimage.append(&Bytes::from_array(env, &target.to_string().into_bytes()));
        preimage.append(&Bytes::from_array(env, &method.to_string().into_bytes()));
        preimage.append(&Bytes::from_array(env, &max_fee.to_be_bytes()));
        preimage.append(&Bytes::from_array(env, &nonce.to_be_bytes()));
        preimage
    }

    fn verify_attestation(
        env: &Env,
        user: &Address,
        target: &Address,
        method: &Symbol,
        max_fee: i128,
        nonce: u64,
        signature: &BytesN<64>,
    ) -> Result<(), Error> {
        let public_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&RELAYER_PK_KEY)
            .ok_or(Error::RelayerNotSet)?;

        // Replay protection: nonces must strictly increase per user.
        let nonce_key = DataKey::AttestationNonce(user.clone());
        let last_nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0u64);
        if nonce <= last_nonce {
            return Err(Error::AttestationReplayed);
        }

        let preimage = Self::attestation_preimage(env, user, target, method, max_fee, nonce);
        env.crypto().ed25519_verify(&public_key, &preimage, signature);

        env.storage().persistent().set(&nonce_key, &nonce);
        Ok(())
    }

    // ── Sponsored call ──────────────────────────────────────────────────────

    /// Sponsors a gasless user call. Checks:
    ///   - target contract + method are whitelisted
    ///   - gas_limit <= max_gas_per_tx
    ///   - user's daily quota not exhausted
    ///   - DApp reserve sufficient to cover gas_limit
    /// Deducts gas_limit from the DApp reserve and records usage.
    pub fn sponsor_call(
        env: Env,
        dapp: Address,
        user: Address,
        target: Address,
        method: Symbol,
        gas_limit: i128,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        dapp.require_auth(); // DApp authorises the sponsorship
        Self::sponsor_inner(&env, &dapp, &user, &target, &method, gas_limit)
    }

    /// Sponsors a transaction fee for `user` targeting `target`.
    ///
    /// Unlike [`GasSponsorTank::sponsor_call`] this entry point is designed for
    /// the backend relayer flow and enforces every drainage-prevention layer:
    ///
    /// 1. `signature` must be a valid ed25519 attestation from the registered
    ///    relayer over `(user, target, method, max_fee, nonce)`.
    /// 2. The `(user, target)` token bucket must hold at least `max_fee` units.
    /// 3. The user's daily sponsorship cap must not be exceeded.
    /// 4. The global circuit breaker must be closed (reserve >= 10% of the
    ///    high-water mark).
    pub fn sponsor_transaction(
        env: Env,
        user: Address,
        target: Address,
        method: Symbol,
        max_fee: i128,
        nonce: u64,
        signature: BytesN<64>,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;

        let dapp = Self::sponsor(&env)?;
        Self::verify_attestation(&env, &user, &target, &method, max_fee, nonce, &signature)?;
        Self::sponsor_inner(&env, &dapp, &user, &target, &method, max_fee)
    }

    /// Shared sponsorship pipeline used by both public entry points.
    fn sponsor_inner(
        env: &Env,
        dapp: &Address,
        user: &Address,
        target: &Address,
        method: &Symbol,
        gas_limit: i128,
    ) -> Result<(), Error> {
        let max_gas: i128 = env
            .storage()
            .instance()
            .get(&MAX_GAS_KEY)
            .unwrap_or(1000000);
        if gas_limit <= 0 {
            return Err(Error::InvalidGasLimit);
        }
        if gas_limit > max_gas {
            return Err(Error::MaxGasExceeded);
        }

        // Whitelist checks.
        let contract_ok: bool = env
            .storage()
            .persistent()
            .get(&DataKey::WhitelistContract(target.clone()))
            .unwrap_or(false);
        let method_ok: bool = env
            .storage()
            .persistent()
            .get(&DataKey::WhitelistMethod((target.clone(), method.clone())))
            .unwrap_or(false);
        if !contract_ok || !method_ok {
            return Err(Error::NotWhitelisted);
        }

        // Global circuit breaker: stop sponsoring once reserves run low.
        if Self::circuit_breaker_open(env, dapp) {
            return Err(Error::CircuitBreakerOpen);
        }

        // Daily quota check.
        let day = env.ledger().timestamp() / SECONDS_PER_DAY;
        let ukey = DataKey::Usage((user.clone(), day));
        let used: i128 = env.storage().persistent().get(&ukey).unwrap_or(0i128);
        let quota: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Quota(user.clone()))
            .unwrap_or(max_gas); // default quota = max gas per tx
        if used + gas_limit > quota {
            return Err(Error::QuotaExceeded);
        }

        // Per-user daily sponsorship cap.
        let dkey = DataKey::DailyUsage((user.clone(), day));
        let daily_used: i128 = env.storage().persistent().get(&dkey).unwrap_or(0i128);
        let daily_cap: i128 = env
            .storage()
            .instance()
            .get(&DAILY_CAP_KEY)
            .unwrap_or(max_gas * 10);
        if daily_used + gas_limit > daily_cap {
            return Err(Error::DailyCapExceeded);
        }

        // Token bucket check for this (user, target) pair.
        let mut bucket = Self::load_bucket(env, user, target);
        if bucket.tokens < gas_limit {
            return Err(Error::RateLimited);
        }

        // Reserve check.
        let rkey = DataKey::Reserve(dapp.clone());
        let reserve: i128 = env.storage().persistent().get(&rkey).unwrap_or(0i128);
        if reserve < gas_limit {
            return Err(Error::InsufficientReserves);
        }

        // Apply: deduct from reserve, record usage, drain the bucket.
        env.storage()
            .persistent()
            .set(&rkey, &(reserve - gas_limit));
        env.storage().persistent().set(&ukey, &(used + gas_limit));
        env.storage()
            .persistent()
            .set(&dkey, &(daily_used + gas_limit));
        bucket.tokens -= gas_limit;
        env.storage()
            .persistent()
            .set(&DataKey::Bucket((user.clone(), target.clone())), &bucket);

        let total: i128 = env
            .storage()
            .instance()
            .get(&TOTAL_RESERVES_KEY)
            .unwrap_or(0i128);
        env.storage()
            .instance()
            .set(&TOTAL_RESERVES_KEY, &(total - gas_limit));

        let event = SponsorshipEvent {
            dapp: dapp.clone(),
            user: user.clone(),
            target: target.clone(),
            method: method.clone(),
            gas_used: gas_limit,
            timestamp: env.ledger().timestamp(),
        };
        env.events()
            .publish((symbol_short!("gas"), symbol_short!("spn")), event);

        Ok(())
    }

    // ── Read-only ───────────────────────────────────────────────────────────

    pub fn get_usage(env: Env, user: Address, day: u64) -> i128 {
        let _ = Self::ensure_initialized(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Usage((user, day)))
            .unwrap_or(0i128)
    }

    pub fn is_whitelisted(env: Env, target: Address, method: Symbol) -> bool {
        let _ = Self::ensure_initialized(&env);
        let c = env
            .storage()
            .persistent()
            .get(&DataKey::WhitelistContract(target.clone()))
            .unwrap_or(false);
        let m = env
            .storage()
            .persistent()
            .get(&DataKey::WhitelistMethod((target, method)))
            .unwrap_or(false);
        c && m
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::testutils::Ledger;

    #[test]
    fn test_deposit_and_reserve() {
        let env = Env::default();
        let contract = GasSponsorTank;
        let id = env.register_contract(None, contract);
        let client = GasSponsorTankClient::new(&env, &id);

        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let dapp = Address::generate(&env);
        client.deposit(&dapp, &500000);
        assert_eq!(client.get_reserve(&dapp), 500000);
    }

    #[test]
    fn test_sponsor_call_success() {
        let env = Env::default();
        let contract = GasSponsorTank;
        let id = env.register_contract(None, contract);
        let client = GasSponsorTankClient::new(&env, &id);

        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let dapp = Address::generate(&env);
        let user = Address::generate(&env);
        let target = Address::generate(&env);
        let method = symbol_short!("transfer");

        client.deposit(&dapp, &500000).unwrap();
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.set_quota(&sponsor, &user, &100000).unwrap();

        let res = client.sponsor_call(&dapp, &user, &target, &method, &10000);
        assert!(res.is_ok());
        assert_eq!(client.get_reserve(&dapp), 500000 - 10000);
        assert_eq!(
            client.get_usage(&user, &(env.ledger().timestamp() / 86400)),
            10000
        );
    }

    #[test]
    fn test_sponsor_call_not_whitelisted() {
        let env = Env::default();
        let contract = GasSponsorTank;
        let id = env.register_contract(None, contract);
        let client = GasSponsorTankClient::new(&env, &id);

        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let dapp = Address::generate(&env);
        let user = Address::generate(&env);
        let target = Address::generate(&env);

        client.deposit(&dapp, &500000).unwrap();
        let res = client.sponsor_call(&dapp, &user, &target, &symbol_short!("transfer"), &1000);
        assert!(res.is_err());
    }

    #[test]
    fn test_sponsor_call_quota_exceeded() {
        let env = Env::default();
        let contract = GasSponsorTank;
        let id = env.register_contract(None, contract);
        let client = GasSponsorTankClient::new(&env, &id);

        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let dapp = Address::generate(&env);
        let user = Address::generate(&env);
        let target = Address::generate(&env);
        let method = symbol_short!("transfer");

        client.deposit(&dapp, &500000).unwrap();
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.set_quota(&sponsor, &user, &5000).unwrap();

        client
            .sponsor_call(&dapp, &user, &target, &method, &3000)
            .unwrap();
        let res = client.sponsor_call(&dapp, &user, &target, &method, &3000);
        assert!(res.is_err()); // 3000+3000 > 5000 quota
    }

    #[test]
    fn test_sponsor_call_insufficient_reserves() {
        let env = Env::default();
        let contract = GasSponsorTank;
        let id = env.register_contract(None, contract);
        let client = GasSponsorTankClient::new(&env, &id);

        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let dapp = Address::generate(&env);
        let user = Address::generate(&env);
        let target = Address::generate(&env);
        let method = symbol_short!("transfer");

        client.deposit(&dapp, &1000).unwrap();
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.set_quota(&sponsor, &user, &100000).unwrap();

        let res = client.sponsor_call(&dapp, &user, &target, &method, &50000);
        assert!(res.is_err());
    }

    #[test]
    fn test_sponsor_call_max_gas_exceeded() {
        let env = Env::default();
        let contract = GasSponsorTank;
        let id = env.register_contract(None, contract);
        let client = GasSponsorTankClient::new(&env, &id);

        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000);

        let dapp = Address::generate(&env);
        let user = Address::generate(&env);
        let target = Address::generate(&env);
        let method = symbol_short!("transfer");

        client.deposit(&dapp, &500000).unwrap();
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();

        let res = client.sponsor_call(&dapp, &user, &target, &method, &2000);
        assert!(res.is_err());
    }

    // ── Rate limiting / drainage prevention ─────────────────────────────────

    /// Registers a relayer keypair and returns its signing key.
    fn setup_relayer(
        env: &Env,
        client: &GasSponsorTankClient,
        sponsor: &Address,
    ) -> SigningKey {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let public_key = BytesN::from_array(env, &signing.verifying_key().to_bytes());
        let relayer = Address::generate(env);
        client
            .set_relayer(sponsor, &relayer, &public_key)
            .unwrap();
        signing
    }

    /// The exact preimage the contract verifies:
    /// `b"GST1" || user || target || method || max_fee_be || nonce_be`.
    fn signing_message(
        user: &Address,
        target: &Address,
        method: &Symbol,
        max_fee: i128,
        nonce: u64,
    ) -> std::vec::Vec<u8> {
        let mut msg = std::vec::Vec::new();
        msg.extend_from_slice(ATTESTATION_DOMAIN);
        msg.extend_from_slice(user.to_string().as_bytes());
        msg.extend_from_slice(target.to_string().as_bytes());
        msg.extend_from_slice(method.to_string().as_bytes());
        msg.extend_from_slice(&max_fee.to_be_bytes());
        msg.extend_from_slice(&nonce.to_be_bytes());
        msg
    }

    fn sign(
        env: &Env,
        signing: &SigningKey,
        user: &Address,
        target: &Address,
        method: &Symbol,
        max_fee: i128,
        nonce: u64,
    ) -> BytesN<64> {
        let msg = signing_message(user, target, method, max_fee, nonce);
        let sig = signing.sign(&msg);
        BytesN::from_array(env, &sig.to_bytes())
    }

    #[test]
    fn test_sponsor_transaction_requires_relayer() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let target = Address::generate(&env);
        let method = symbol_short!("transfer");
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.deposit(&sponsor, &500000).unwrap();

        let user = Address::generate(&env);
        let sig = BytesN::from_array(&env, &[0u8; 64]);
        let res = client.try_sponsor_transaction(&user, &target, &method, &1000, &1, &sig);
        assert_eq!(res, Err(Ok(Error::RelayerNotSet)));
    }

    #[test]
    fn test_token_bucket_exhaustion_rejects_further_sponsorships() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let target = Address::generate(&env);
        let method = symbol_short!("transfer");
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.deposit(&sponsor, &500000).unwrap();
        let signing = setup_relayer(&env, &client, &sponsor);

        // Bucket of 10_000 units, refilling 1 unit/second.
        client.set_rate_limit(&sponsor, &10_000, &1).unwrap();
        client.set_daily_cap(&sponsor, &1_000_000).unwrap();

        let user = Address::generate(&env);
        assert_eq!(client.get_bucket_tokens(&user, &target), 10_000);

        // Drain the bucket in a tight loop.
        for nonce in 1..=10u64 {
            let sig = sign(&env, &signing, &user, &target, &method, 1000, nonce);
            client
                .sponsor_transaction(&user, &target, &method, &1000, &nonce, &sig)
                .unwrap();
        }
        assert_eq!(client.get_bucket_tokens(&user, &target), 0);

        // The 11th call in the same ledger is rejected.
        let sig = sign(&env, &signing, &user, &target, &method, 1000, 11);
        let res = client.try_sponsor_transaction(&user, &target, &method, &1000, &11, &sig);
        assert_eq!(res, Err(Ok(Error::RateLimited)));

        // After 1000 seconds the bucket has refilled 1000 units.
        env.ledger().set_timestamp(1000);
        assert_eq!(client.get_bucket_tokens(&user, &target), 1000);
        let sig = sign(&env, &signing, &user, &target, &method, 1000, 12);
        client
            .sponsor_transaction(&user, &target, &method, &1000, &12, &sig)
            .unwrap();
    }

    #[test]
    fn test_buckets_are_isolated_per_target() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let target_a = Address::generate(&env);
        let target_b = Address::generate(&env);
        let method = symbol_short!("transfer");
        for t in [&target_a, &target_b] {
            client.whitelist_contract(&sponsor, t).unwrap();
            client.whitelist_method(&sponsor, t, &method).unwrap();
        }
        client.deposit(&sponsor, &500000).unwrap();
        let signing = setup_relayer(&env, &client, &sponsor);
        client.set_rate_limit(&sponsor, &1000, &1).unwrap();
        client.set_daily_cap(&sponsor, &1_000_000).unwrap();

        let user = Address::generate(&env);
        let sig = sign(&env, &signing, &user, &target_a, &method, 1000, 1);
        client
            .sponsor_transaction(&user, &target_a, &method, &1000, &1, &sig)
            .unwrap();
        assert_eq!(client.get_bucket_tokens(&user, &target_a), 0);
        // Target B still has a full bucket.
        assert_eq!(client.get_bucket_tokens(&user, &target_b), 1000);
    }

    #[test]
    fn test_daily_cap_enforced() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let target = Address::generate(&env);
        let method = symbol_short!("transfer");
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.deposit(&sponsor, &500000).unwrap();
        let signing = setup_relayer(&env, &client, &sponsor);
        client.set_rate_limit(&sponsor, &1_000_000, &1).unwrap();
        client.set_daily_cap(&sponsor, &5000).unwrap();

        let user = Address::generate(&env);
        let sig = sign(&env, &signing, &user, &target, &method, 3000, 1);
        client
            .sponsor_transaction(&user, &target, &method, &3000, &1, &sig)
            .unwrap();
        assert_eq!(client.get_daily_usage(&user, &0), 3000);

        let sig = sign(&env, &signing, &user, &target, &method, 3000, 2);
        let res = client.try_sponsor_transaction(&user, &target, &method, &3000, &2, &sig);
        assert_eq!(res, Err(Ok(Error::DailyCapExceeded)));
    }

    #[test]
    fn test_circuit_breaker_trips_below_ten_percent() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let target = Address::generate(&env);
        let method = symbol_short!("transfer");
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.deposit(&sponsor, &100_000).unwrap();
        let signing = setup_relayer(&env, &client, &sponsor);
        client.set_rate_limit(&sponsor, &1_000_000, &1).unwrap();
        client.set_daily_cap(&sponsor, &1_000_000).unwrap();

        assert!(!client.is_circuit_breaker_open(&sponsor));

        let user = Address::generate(&env);
        // Spend down to 9_000 (< 10% of the 100_000 high-water mark).
        let sig = sign(&env, &signing, &user, &target, &method, 91_000, 1);
        client
            .sponsor_transaction(&user, &target, &method, &91_000, &1, &sig)
            .unwrap();
        assert_eq!(client.get_reserve(&sponsor), 9_000);
        assert!(client.is_circuit_breaker_open(&sponsor));

        let sig = sign(&env, &signing, &user, &target, &method, 1000, 2);
        let res = client.try_sponsor_transaction(&user, &target, &method, &1000, &2, &sig);
        assert_eq!(res, Err(Ok(Error::CircuitBreakerOpen)));

        // Topping the tank back up closes the breaker.
        client.deposit(&sponsor, &100_000).unwrap();
        assert!(!client.is_circuit_breaker_open(&sponsor));
    }

    #[test]
    fn test_attestation_nonce_replay_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        let target = Address::generate(&env);
        let method = symbol_short!("transfer");
        client.whitelist_contract(&sponsor, &target).unwrap();
        client.whitelist_method(&sponsor, &target, &method).unwrap();
        client.deposit(&sponsor, &500000).unwrap();
        let signing = setup_relayer(&env, &client, &sponsor);

        let user = Address::generate(&env);
        let sig = sign(&env, &signing, &user, &target, &method, 1000, 5);
        client
            .sponsor_transaction(&user, &target, &method, &1000, &5, &sig)
            .unwrap();
        let res = client.try_sponsor_transaction(&user, &target, &method, &1000, &5, &sig);
        assert_eq!(res, Err(Ok(Error::AttestationReplayed)));
    }

    #[test]
    fn test_rate_limit_config_validation() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GasSponsorTank);
        let client = GasSponsorTankClient::new(&env, &id);
        let sponsor = Address::generate(&env);
        client.initialize(&sponsor, &1000000);

        assert_eq!(
            client.try_set_rate_limit(&sponsor, &0, &1),
            Err(Ok(Error::InvalidConfig))
        );
        assert_eq!(
            client.try_set_daily_cap(&sponsor, &0),
            Err(Ok(Error::InvalidConfig))
        );
        assert_eq!(
            client.try_set_circuit_breaker(&sponsor, &10_001),
            Err(Ok(Error::InvalidConfig))
        );

        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_set_rate_limit(&stranger, &1000, &1),
            Err(Ok(Error::Unauthorized))
        );
    }
}
