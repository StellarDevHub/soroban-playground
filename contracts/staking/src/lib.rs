#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::storage::{
    get_admin, get_stake, get_token, get_total_shares, get_total_staked,
    get_unstake_count, get_unstake_period, get_unstake_request, is_initialized,
    set_admin, set_initialized, set_stake, set_token, set_total_shares,
    set_total_staked, set_unstake_period, set_unstake_count, set_unstake_request,
};
use crate::types::{Error, StakeInfo, UnstakeRequest};

#[contract]
pub struct Staking;

#[contractimpl]
impl Staking {
    pub fn initialize(env: Env, admin: Address, token: Address, unstake_period: u64) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_token(&env, &token);
        set_unstake_period(&env, unstake_period);
        set_initialized(&env, true);
        Ok(())
    }

    pub fn stake(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        user.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let total_staked = get_total_staked(&env);
        let total_shares = get_total_shares(&env);

        let token = get_token(&env)?;
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let shares = if total_shares == 0 {
            amount
        } else {
            (amount * total_shares) / total_staked
        };

        let mut user_stake = get_stake(&env, &user).unwrap_or(StakeInfo {
            amount: 0,
            shares: 0,
        });
        user_stake.amount += amount;
        user_stake.shares += shares;
        set_stake(&env, &user, &user_stake);

        set_total_staked(&env, total_staked + amount);
        set_total_shares(&env, total_shares + shares);

        Ok(shares)
    }

    pub fn request_unstake(env: Env, user: Address, shares: i128) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        user.require_auth();

        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut user_stake = get_stake(&env, &user).ok_or(Error::NothingToUnstake)?;
        if user_stake.shares < shares {
            return Err(Error::InsufficientBalance);
        }

        let total_staked = get_total_staked(&env);
        let total_shares = get_total_shares(&env);
        let amount = (shares * total_staked) / total_shares;

        user_stake.shares -= shares;
        user_stake.amount -= amount;
        set_stake(&env, &user, &user_stake);

        set_total_staked(&env, total_staked - amount);
        set_total_shares(&env, total_shares - shares);

        let count = get_unstake_count(&env, &user);
        let request = UnstakeRequest {
            amount,
            unlock_timestamp: env.ledger().timestamp() + get_unstake_period(&env),
        };
        set_unstake_request(&env, &user, count, &request);
        set_unstake_count(&env, &user, count + 1);

        Ok(count)
    }

    pub fn claim_unstake(env: Env, user: Address, request_idx: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        user.require_auth();

        let request = get_unstake_request(&env, &user, request_idx).ok_or(Error::RequestNotFound)?;
        let now = env.ledger().timestamp();

        if now < request.unlock_timestamp {
            return Err(Error::InvalidWithdrawalPeriod);
        }

        let token = get_token(&env)?;
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &user, &request.amount);

        Ok(request.amount)
    }

    pub fn get_stake_info(env: Env, user: Address) -> Result<StakeInfo, Error> {
        ensure_initialized(&env)?;
        get_stake(&env, &user).ok_or(Error::NothingToUnstake)
    }

    pub fn get_unstake_request(env: Env, user: Address, request_idx: u32) -> Result<UnstakeRequest, Error> {
        ensure_initialized(&env)?;
        get_unstake_request(&env, &user, request_idx).ok_or(Error::RequestNotFound)
    }

    pub fn get_total_staked(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_total_staked(&env))
    }

    pub fn get_total_shares(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_total_shares(&env))
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}
