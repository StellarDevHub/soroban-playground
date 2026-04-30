#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_executor, get_position, get_strategy, get_strategy_count, has_position,
    has_strategy, is_initialized, is_paused, remove_position, set_admin, set_executor,
    set_paused, set_position, set_strategy, set_strategy_count,
};
use crate::types::{Error, Position, PositionView, Strategy};

const SECONDS_PER_YEAR: u64 = 31_536_000;
const BPS_DENOM: u32 = 10_000;
const MAX_APY_BPS: u32 = 20_000;
const MAX_FEE_BPS: u32 = 2_500;

#[contract]
pub struct YieldOptimizer;

#[contractimpl]
impl YieldOptimizer {
    pub fn initialize(env: Env, admin: Address, executor: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_executor(&env, &executor);
        set_strategy_count(&env, 0);
        set_paused(&env, false);

        env.events()
            .publish((symbol_short!("init"),), (admin, executor));

        Ok(())
    }

    pub fn create_strategy(
        env: Env,
        admin: Address,
        name: String,
        protocol: String,
        apy_bps: u32,
        fee_bps: u32,
        compound_interval: u64,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        Self::assert_strategy_params(&name, &protocol, apy_bps, fee_bps, compound_interval)?;

        let id = get_strategy_count(&env) + 1;
        let strategy = Strategy {
            name,
            protocol,
            apy_bps,
            fee_bps,
            total_deposited: 0,
            total_shares: 0,
            is_active: true,
            compound_interval,
            last_compound_ts: env.ledger().timestamp(),
        };

        set_strategy(&env, id, &strategy);
        set_strategy_count(&env, id);

        env.events()
            .publish((symbol_short!("strat"), symbol_short!("create"), id), apy_bps);

        Ok(id)
    }

    pub fn update_strategy(
        env: Env,
        admin: Address,
        strategy_id: u32,
        apy_bps: u32,
        fee_bps: u32,
        compound_interval: u64,
        is_active: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        if compound_interval == 0 {
            return Err(Error::InvalidInterval);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        strategy.apy_bps = apy_bps;
        strategy.fee_bps = fee_bps;
        strategy.compound_interval = compound_interval;
        strategy.is_active = is_active;

        set_strategy(&env, strategy_id, &strategy);

        env.events().publish(
            (symbol_short!("strat"), symbol_short!("update"), strategy_id),
            (apy_bps, fee_bps),
        );

        Ok(())
    }

    pub fn set_executor(env: Env, admin: Address, executor: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_executor(&env, &executor);
        env.events()
            .publish((symbol_short!("exec"), symbol_short!("set")), executor);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("pause"),), admin);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpause"),), admin);
        Ok(())
    }

    pub fn deposit(
        env: Env,
        user: Address,
        strategy_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        Self::assert_active(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        if !strategy.is_active {
            return Err(Error::StrategyPaused);
        }

        let minted_shares = Self::shares_for_deposit(&strategy, amount);
        let now = env.ledger().timestamp();

        let mut position = if has_position(&env, strategy_id, &user) {
            get_position(&env, strategy_id, &user)?
        } else {
            Position {
                shares: 0,
                principal: 0,
                last_action_ts: now,
            }
        };

        position.shares = position.shares.saturating_add(minted_shares);
        position.principal = position.principal.saturating_add(amount);
        position.last_action_ts = now;

        strategy.total_shares = strategy.total_shares.saturating_add(minted_shares);
        strategy.total_deposited = strategy.total_deposited.saturating_add(amount);

        set_position(&env, strategy_id, &user, &position);
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("deposit"), strategy_id), (user, amount));

        Ok(minted_shares)
    }

    pub fn withdraw(
        env: Env,
        user: Address,
        strategy_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        Self::assert_active(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        let mut position = get_position(&env, strategy_id, &user)?;
        let current_balance = Self::value_for_shares(&strategy, position.shares);
        if amount > current_balance {
            return Err(Error::InsufficientBalance);
        }

        let shares_to_burn = Self::shares_for_withdraw(&strategy, amount);
        if shares_to_burn > position.shares {
            return Err(Error::InsufficientBalance);
        }

        position.shares = position.shares.saturating_sub(shares_to_burn);
        position.principal = position.principal.saturating_sub(amount.min(position.principal));
        position.last_action_ts = env.ledger().timestamp();

        strategy.total_shares = strategy.total_shares.saturating_sub(shares_to_burn);
        strategy.total_deposited = strategy.total_deposited.saturating_sub(amount);

        if position.shares == 0 {
            remove_position(&env, strategy_id, &user);
        } else {
            set_position(&env, strategy_id, &user, &position);
        }
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("withdrw"), strategy_id), (user, amount));

        Ok(amount)
    }

    pub fn compound(env: Env, caller: Address, strategy_id: u32) -> Result<i128, Error> {
        Self::assert_active(&env)?;
        caller.require_auth();
        Self::assert_compounder(&env, &caller)?;

        let mut strategy = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(strategy.last_compound_ts);

        if elapsed < strategy.compound_interval {
            return Err(Error::CompoundTooSoon);
        }

        let gross_reward = strategy
            .total_deposited
            .saturating_mul(strategy.apy_bps as i128)
            .saturating_mul(elapsed as i128)
            / (BPS_DENOM as i128 * SECONDS_PER_YEAR as i128);
        let fee = gross_reward.saturating_mul(strategy.fee_bps as i128) / BPS_DENOM as i128;
        let net_reward = gross_reward.saturating_sub(fee);

        strategy.total_deposited = strategy.total_deposited.saturating_add(net_reward);
        strategy.last_compound_ts = now;
        set_strategy(&env, strategy_id, &strategy);

        env.events().publish(
            (symbol_short!("compound"), strategy_id),
            (caller, net_reward, fee),
        );

        Ok(strategy.total_deposited)
    }

    pub fn get_strategy(env: Env, strategy_id: u32) -> Result<Strategy, Error> {
        get_strategy(&env, strategy_id)
    }

    pub fn get_position(
        env: Env,
        user: Address,
        strategy_id: u32,
    ) -> Result<PositionView, Error> {
        let strategy = get_strategy(&env, strategy_id)?;
        let position = get_position(&env, strategy_id, &user)?;
        Ok(PositionView {
            shares: position.shares,
            principal: position.principal,
            current_balance: Self::value_for_shares(&strategy, position.shares),
            last_action_ts: position.last_action_ts,
        })
    }

    pub fn strategy_count(env: Env) -> u32 {
        get_strategy_count(&env)
    }

    pub fn list_strategies(env: Env) -> Vec<u32> {
        let mut strategies = Vec::new(&env);
        for id in 1..=get_strategy_count(&env) {
            if has_strategy(&env, id) {
                strategies.push_back(id);
            }
        }
        strategies
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_executor(env: Env) -> Result<Address, Error> {
        get_executor(&env)
    }

    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_active(env: &Env) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        if get_admin(env)? != *caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_compounder(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = get_admin(env)?;
        let executor = get_executor(env)?;
        if *caller != admin && *caller != executor {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_strategy_params(
        name: &String,
        protocol: &String,
        apy_bps: u32,
        fee_bps: u32,
        compound_interval: u64,
    ) -> Result<(), Error> {
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if protocol.len() == 0 {
            return Err(Error::InvalidProtocol);
        }
        if apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        if compound_interval == 0 {
            return Err(Error::InvalidInterval);
        }
        Ok(())
    }

    fn shares_for_deposit(strategy: &Strategy, amount: i128) -> i128 {
        if strategy.total_shares == 0 || strategy.total_deposited == 0 {
            return amount;
        }

        amount.saturating_mul(strategy.total_shares) / strategy.total_deposited
    }

    fn shares_for_withdraw(strategy: &Strategy, amount: i128) -> i128 {
        if strategy.total_shares == 0 || strategy.total_deposited == 0 {
            return amount;
        }

        let numerator = amount.saturating_mul(strategy.total_shares);
        let quotient = numerator / strategy.total_deposited;
        let remainder = numerator % strategy.total_deposited;
        if remainder == 0 {
            quotient
        } else {
            quotient.saturating_add(1)
        }
    }

    fn value_for_shares(strategy: &Strategy, shares: i128) -> i128 {
        if strategy.total_shares == 0 || shares == 0 {
            return 0;
        }

        shares.saturating_mul(strategy.total_deposited) / strategy.total_shares
    }
}
