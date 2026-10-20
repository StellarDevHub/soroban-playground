//! # Decentralized Derivative Options Vault (DOV)
//!
//! Automated covered-call option writing vault. Users deposit base collateral
//! into weekly vault rounds; the vault writes out-of-the-money European call
//! options and sells them via Dutch auction, distributing premiums to
//! depositors and rolling capital into the next epoch.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Env, Map, Symbol,
};

const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const ORACLE_KEY: Symbol = symbol_short!("ORACLE");
const CURRENT_EPOCH_KEY: Symbol = symbol_short!("CUREP");
const INITIALIZED_KEY: Symbol = symbol_short!("INIT");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    RoundNotFound = 4,
    RoundNotActive = 5,
    RoundAlreadySettled = 6,
    InvalidAmount = 7,
    InsufficientCollateral = 8,
    NotDepositor = 9,
    InvalidStrike = 10,
    OraclePriceMissing = 11,
}

// ── Types ───────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RoundStatus {
    Active,
    Settled,
    Rolled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Round {
    pub epoch: u64,
    pub collateral: i128,
    pub premium_collected: i128,
    pub strike_price: i128,
    pub oracle_price: Option<i128>,
    pub option_tokens_issued: i128,
    pub settled: bool,
    pub status: RoundStatus,
}

#[contracttype]
pub enum DataKey {
    Round(u64),
    Deposit((u64, Address)),
}

#[contract]
pub struct OptionsVault;

#[contractimpl]
impl OptionsVault {
    // ── Initialisation ──────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&ORACLE_KEY, &oracle);
        env.storage().instance().set(&CURRENT_EPOCH_KEY, &1u64);
        env.storage().instance().set(&INITIALIZED_KEY, &true);

        // Create the first active round.
        let round = Round {
            epoch: 1,
            collateral: 0,
            premium_collected: 0,
            strike_price: 0,
            oracle_price: None,
            option_tokens_issued: 0,
            settled: false,
            status: RoundStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Round(1), &round);
        env.events().publish((symbol_short!("init"),), (admin, oracle));
        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().get(&INITIALIZED_KEY).unwrap_or(false) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn current_epoch(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&CURRENT_EPOCH_KEY)
            .unwrap_or(1u64)
    }

    // ── Deposit ─────────────────────────────────────────────────────────────

    /// Deposits base collateral into a vault round.
    pub fn deposit(env: Env, user: Address, epoch: u64, amount: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut round: Round = Self::get_round_ref(&env, epoch)?;
        if round.status != RoundStatus::Active || round.settled {
            return Err(Error::RoundNotActive);
        }

        let dkey = DataKey::Deposit((epoch, user.clone()));
        let prior: i128 = env
            .storage()
            .persistent()
            .get(&dkey)
            .unwrap_or(0i128);
        env.storage().persistent().set(&dkey, &(prior + amount));

        round.collateral += amount;
        env.storage().persistent().set(&DataKey::Round(epoch), &round);

        env.events().publish((symbol_short!("deposit"),), (user, epoch, amount));
        Ok(())
    }

    // ── Covered call writing ────────────────────────────────────────────────

    /// Writes OTM European call options for a round based on the oracle price.
    /// `strike_price` must be strictly greater than the oracle price (OTM).
    /// Mints `option_tokens_issued` equal to the collateral divided by strike.
    pub fn write_options(
        env: Env,
        caller: Address,
        epoch: u64,
        oracle_price: i128,
        strike_price: i128,
    ) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        let oracle: Address = env
            .storage()
            .instance()
            .get(&ORACLE_KEY)
            .unwrap_or_else(|| Address::generate(&env));
        if caller != oracle {
            return Err(Error::Unauthorized);
        }

        let mut round: Round = Self::get_round_ref(&env, epoch)?;
        if round.status != RoundStatus::Active || round.settled {
            return Err(Error::RoundNotActive);
        }
        if round.collateral <= 0 {
            return Err(Error::InsufficientCollateral);
        }
        if strike_price <= oracle_price {
            return Err(Error::InvalidStrike);
        }

        round.oracle_price = Some(oracle_price);
        round.strike_price = strike_price;
        // Option tokens backed 1:1 by collateral / strike (covered call).
        round.option_tokens_issued = round.collateral / strike_price;
        if round.option_tokens_issued == 0 {
            round.option_tokens_issued = 1;
        }
        env.storage().persistent().set(&DataKey::Round(epoch), &round);

        env.events().publish(
            (symbol_short!("opt"), symbol_short!("wri")),
            (epoch, oracle_price, strike_price, round.option_tokens_issued),
        );
        Ok(())
    }

    // ── Dutch auction / premium ─────────────────────────────────────────────

    /// Records premium collected from selling option tokens to market makers.
    pub fn collect_premium(env: Env, caller: Address, epoch: u64, premium: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        let oracle: Address = env
            .storage()
            .instance()
            .get(&ORACLE_KEY)
            .unwrap_or_else(|| Address::generate(&env));
        if caller != oracle {
            return Err(Error::Unauthorized);
        }
        if premium < 0 {
            return Err(Error::InvalidAmount);
        }

        let mut round: Round = Self::get_round_ref(&env, epoch)?;
        if round.status != RoundStatus::Active {
            return Err(Error::RoundNotActive);
        }
        round.premium_collected += premium;
        env.storage().persistent().set(&DataKey::Round(epoch), &round);

        env.events()
            .publish((symbol_short!("pre"), symbol_short!("col")), (epoch, premium));
        Ok(())
    }

    // ── Settlement ──────────────────────────────────────────────────────────

    /// Settles a round at expiry using the oracle price.
    ///   - ITM (oracle_price > strike_price): payout = (oracle - strike) * tokens,
    ///     deducted from collateral.
    ///   - OTM/ATM: option expires worthless, premiums compound into collateral.
    pub fn settle(
        env: Env,
        caller: Address,
        epoch: u64,
        oracle_price: i128,
    ) -> Result<i128, Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let mut round: Round = Self::get_round_ref(&env, epoch)?;
        if round.status != RoundStatus::Active || round.settled {
            return Err(Error::RoundAlreadySettled);
        }
        if round.oracle_price.is_none() {
            return Err(Error::OraclePriceMissing);
        }

        round.settled = true;
        round.status = RoundStatus::Settled;

        let payout: i128;
        if oracle_price > round.strike_price {
            // In-the-money call: pay (oracle - strike) per token.
            payout = (oracle_price - round.strike_price) * round.option_tokens_issued;
            if payout > round.collateral + round.premium_collected {
                return Err(Error::InsufficientCollateral);
            }
            round.collateral = round.collateral + round.premium_collected - payout;
        } else {
            // Out-of-the-money: expires worthless, premiums compound.
            payout = 0;
            round.collateral = round.collateral + round.premium_collected;
        }

        env.storage().persistent().set(&DataKey::Round(epoch), &round);

        env.events().publish(
            (symbol_short!("rnd"), symbol_short!("set")),
            (epoch, oracle_price, round.strike_price, payout, round.collateral),
        );
        Ok(payout)
    }

    // ── Rollover ────────────────────────────────────────────────────────────

    /// Rolls remaining capital + accumulated yield into the next weekly epoch.
    pub fn rollover(env: Env, caller: Address) -> Result<u64, Error> {
        Self::ensure_initialized(&env)?;
        caller.require_auth();

        let epoch = Self::current_epoch(&env);
        let round: Round = Self::get_round_ref(&env, epoch)?;
        if round.status != RoundStatus::Settled {
            return Err(Error::RoundNotActive);
        }

        let next_epoch = epoch + 1;
        let next_round = Round {
            epoch: next_epoch,
            collateral: round.collateral,
            premium_collected: 0,
            strike_price: 0,
            oracle_price: None,
            option_tokens_issued: 0,
            settled: false,
            status: RoundStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Round(next_epoch), &next_round);
        env.storage()
            .instance()
            .set(&CURRENT_EPOCH_KEY, &next_epoch);

        env.events()
            .publish((symbol_short!("rnd"), symbol_short!("rol")), (epoch, next_epoch));
        Ok(next_epoch)
    }

    // ── Withdraw ────────────────────────────────────────────────────────────

    /// Withdraws a depositor's share of collateral from a settled round.
    pub fn withdraw(env: Env, user: Address, epoch: u64, amount: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let dkey = DataKey::Deposit((epoch, user.clone()));
        let prior: i128 = env
            .storage()
            .persistent()
            .get(&dkey)
            .unwrap_or(0i128);
        if prior == 0 {
            return Err(Error::NotDepositor);
        }
        if amount > prior {
            return Err(Error::InsufficientCollateral);
        }

        let mut round: Round = Self::get_round_ref(&env, epoch)?;
        if !round.settled {
            return Err(Error::RoundNotActive);
        }
        if round.collateral < amount {
            return Err(Error::InsufficientCollateral);
        }

        env.storage().persistent().set(&dkey, &(prior - amount));
        round.collateral -= amount;
        env.storage().persistent().set(&DataKey::Round(epoch), &round);

        env.events().publish((symbol_short!("withdraw"),), (user, epoch, amount));
        Ok(())
    }

    // ── Read-only ───────────────────────────────────────────────────────────

    fn get_round_ref(env: &Env, epoch: u64) -> Result<Round, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Round(epoch))
            .ok_or(Error::RoundNotFound)
    }

    pub fn get_round(env: Env, epoch: u64) -> Result<Round, Error> {
        Self::ensure_initialized(&env)?;
        Self::get_round_ref(&env, epoch)
    }

    pub fn get_deposit(env: Env, epoch: u64, user: Address) -> Result<i128, Error> {
        Self::ensure_initialized(&env)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Deposit((epoch, user)))
            .unwrap_or(0i128))
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn make_admin(env: &Env) -> Address {
        Address::generate(env)
    }

    #[test]
    fn test_deposit_and_round() {
        let env = Env::default();
        let contract = OptionsVault;
        let id = env.register_contract(None, contract);
        let client = OptionsVaultClient::new(&env, &id);

        let admin = make_admin(&env);
        let oracle = make_admin(&env);
        client.initialize(&admin, &oracle);

        let user = make_admin(&env);
        client.deposit(&user, &1, &1000);
        let round = client.get_round(&1);
        assert_eq!(round.collateral, 1000);
        let dep = client.get_deposit(&1, &user);
        assert_eq!(dep, 1000);
    }

    #[test]
    fn test_write_options_itm_otm() {
        let env = Env::default();
        let contract = OptionsVault;
        let id = env.register_contract(None, contract);
        let client = OptionsVaultClient::new(&env, &id);

        let admin = make_admin(&env);
        let oracle = make_admin(&env);
        client.initialize(&admin, &oracle);

        let user = make_admin(&env);
        client.deposit(&user, &1, &10000);

        // OTM: strike 120 > oracle 100
        client.write_options(&oracle, &1, &100, &120);
        let round = client.get_round(&1);
        assert_eq!(round.strike_price, 120);
        assert_eq!(round.oracle_price, Some(100));
        assert!(round.option_tokens_issued > 0);

        // ITM settlement: oracle 130 > strike 120 -> payout
        let payout = client.settle(&user, &1, &130);
        assert!(payout.is_ok());
        assert_eq!(payout.unwrap(), (130 - 120) * round.option_tokens_issued);
    }

    #[test]
    fn test_settle_otm_compounds_premium() {
        let env = Env::default();
        let contract = OptionsVault;
        let id = env.register_contract(None, contract);
        let client = OptionsVaultClient::new(&env, &id);

        let admin = make_admin(&env);
        let oracle = make_admin(&env);
        client.initialize(&admin, &oracle);

        let user = make_admin(&env);
        client.deposit(&user, &1, &1000);
        client.write_options(&oracle, &1, &100, &120);
        client.collect_premium(&oracle, &1, &200);

        // OTM: oracle 110 < strike 120 -> premiums compound, payout 0
        let payout = client.settle(&user, &1, &110);
        assert_eq!(payout.unwrap(), 0);
        let round = client.get_round(&1);
        assert_eq!(round.collateral, 1000 + 200);
    }

    #[test]
    fn test_rollover_preserves_collateral() {
        let env = Env::default();
        let contract = OptionsVault;
        let id = env.register_contract(None, contract);
        let client = OptionsVaultClient::new(&env, &id);

        let admin = make_admin(&env);
        let oracle = make_admin(&env);
        client.initialize(&admin, &oracle);

        let user = make_admin(&env);
        client.deposit(&user, &1, &1000);
        client.write_options(&oracle, &1, &100, &120);
        client.collect_premium(&oracle, &1, &100);
        client.settle(&user, &1, &110); // OTM -> collateral 1100

        let next = client.rollover(&admin).unwrap();
        assert_eq!(next, 2);
        let r2 = client.get_round(&2);
        assert_eq!(r2.collateral, 1100);
        assert_eq!(r2.status, RoundStatus::Active);
    }

    #[test]
    fn test_withdraw_after_settle() {
        let env = Env::default();
        let contract = OptionsVault;
        let id = env.register_contract(None, contract);
        let client = OptionsVaultClient::new(&env, &id);

        let admin = make_admin(&env);
        let oracle = make_admin(&env);
        client.initialize(&admin, &oracle);

        let user = make_admin(&env);
        client.deposit(&user, &1, &1000);
        client.write_options(&oracle, &1, &100, &120);
        client.collect_premium(&oracle, &1, &50);
        client.settle(&user, &1, &110); // OTM -> collateral 1050

        client.withdraw(&user, &1, &400);
        let dep = client.get_deposit(&1, &user);
        assert_eq!(dep, 600);
        let round = client.get_round(&1);
        assert_eq!(round.collateral, 1050 - 400);
    }
}
