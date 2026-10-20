//! # Gas Tank Relay — Sponsored Gasless Transactions
//!
//! A sponsor contract that lets DApps deposit XLM reserves to subsidize
//! transaction fees for end-users. Enforces per-user daily quotas and a
//! whitelist of authorised target contracts and method names. Emits
//! `GasSponsored` telemetry for every subsidised call.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Env, Map, Symbol,
};

const SPONSOR_KEY: Symbol = symbol_short!("SPONSOR");
const MAX_GAS_KEY: Symbol = symbol_short!("MAXGAS");
const TOTAL_RESERVES_KEY: Symbol = symbol_short!("TOTRES");
const INITIALIZED_KEY: Symbol = symbol_short!("INIT");

const SECONDS_PER_DAY: u64 = 86400;

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

#[contracttype]
pub enum DataKey {
    Reserve(Address),
    Usage((Address, u64)),
    Quota(Address),
    WhitelistContract(Address),
    WhitelistMethod((Address, Symbol)),
}

#[contract]
pub struct GasSponsorTank;

#[contractimpl]
impl GasSponsorTank {
    // ── Initialisation ──────────────────────────────────────────────────────

    pub fn initialize(env: Env, sponsor: Address, max_gas_per_tx: i128) -> Result<(), Error> {
        if env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
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
        env.events().publish((symbol_short!("init"),), (sponsor, max_gas_per_tx));
        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn sponsor(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&SPONSOR_KEY)
            .unwrap_or_else(|| Address::generate(env))
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
        env.storage().persistent().set(&rkey, &(prior + amount));

        let total: i128 = env
            .storage()
            .instance()
            .get(&TOTAL_RESERVES_KEY)
            .unwrap_or(0i128);
        env.storage()
            .instance()
            .set(&TOTAL_RESERVES_KEY, &(total + amount));

        env.events().publish((symbol_short!("deposit"),), (dapp, amount));
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
        if caller != Self::sponsor(&env) {
            return Err(Error::Unauthorized);
        }
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
        if caller != Self::sponsor(&env) {
            return Err(Error::Unauthorized);
        }
        env.storage()
            .persistent()
            .set(&DataKey::WhitelistMethod((target.clone(), method.clone())), &true);
        env.events()
            .publish((symbol_short!("wlst"), symbol_short!("mth")), (target, method));
        Ok(())
    }

    /// Sets the daily gas quota for a user (admin only).
    pub fn set_quota(env: Env, caller: Address, user: Address, quota: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        if caller != Self::sponsor(&env) {
            return Err(Error::Unauthorized);
        }
        env.storage().persistent().set(&DataKey::Quota(user.clone()), &quota);
        env.events()
            .publish((symbol_short!("qta"), symbol_short!("set")), (user, quota));
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

        // Reserve check.
        let rkey = DataKey::Reserve(dapp.clone());
        let reserve: i128 = env.storage().persistent().get(&rkey).unwrap_or(0i128);
        if reserve < gas_limit {
            return Err(Error::InsufficientReserves);
        }

        // Apply: deduct from reserve, record usage.
        env.storage().persistent().set(&rkey, &(reserve - gas_limit));
        env.storage().persistent().set(&ukey, &(used + gas_limit));

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
    use super::*;

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
        assert_eq!(client.get_usage(&user, &(env.ledger().timestamp() / 86400)), 10000);
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

        client.sponsor_call(&dapp, &user, &target, &method, &3000).unwrap();
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
}
