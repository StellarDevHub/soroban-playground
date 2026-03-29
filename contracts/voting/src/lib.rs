#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};

use crate::storage::{
    get_admin, get_count, get_options, get_total_voters, get_vote, has_vote,
    increment_total_voters, is_initialized, is_registered_option, set_admin, set_count,
    set_options, set_total_voters, set_vote,
};
use crate::types::Error;

#[contract]
pub struct VotingContract;

#[contractimpl]
impl VotingContract {
    /// Initialize the poll with an admin address and the allowed options.
    pub fn initialize(env: Env, admin: Address, options: Vec<Symbol>) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        validate_options(&options)?;

        set_admin(&env, &admin);
        set_options(&env, &options);
        set_total_voters(&env, 0);

        Ok(())
    }

    /// Cast a vote for a registered option, or update an existing vote.
    pub fn vote(env: Env, voter: Address, option: Symbol) -> Result<(), Error> {
        ensure_initialized(&env)?;
        voter.require_auth();

        if !is_registered_option(&env, &option)? {
            return Err(Error::UnknownOption);
        }

        let previous_vote = get_vote(&env, &voter);

        if let Some(current_option) = previous_vote {
            if current_option == option {
                return Ok(());
            }

            let current_count = get_count(&env, &current_option);
            set_count(&env, &current_option, current_count - 1);
        } else {
            increment_total_voters(&env);
        }

        let new_count = get_count(&env, &option);
        set_count(&env, &option, new_count + 1);
        set_vote(&env, &voter, &option);

        Ok(())
    }

    /// Return whether the contract has already been initialized.
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Return the admin that initialized the poll.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Return the list of registered options.
    pub fn get_options(env: Env) -> Result<Vec<Symbol>, Error> {
        get_options(&env)
    }

    /// Return whether an option is registered in the poll.
    pub fn is_option_registered(env: Env, option: Symbol) -> Result<bool, Error> {
        is_registered_option(&env, &option)
    }

    /// Return the option currently selected by a voter.
    pub fn get_vote(env: Env, voter: Address) -> Result<Option<Symbol>, Error> {
        ensure_initialized(&env)?;
        Ok(get_vote(&env, &voter))
    }

    /// Return whether a voter has already participated.
    pub fn has_voted(env: Env, voter: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(has_vote(&env, &voter))
    }

    /// Return the number of votes recorded for one registered option.
    pub fn get_votes(env: Env, option: Symbol) -> Result<u32, Error> {
        ensure_initialized(&env)?;

        if !is_registered_option(&env, &option)? {
            return Err(Error::UnknownOption);
        }

        Ok(get_count(&env, &option))
    }

    /// Return the number of unique voters that have cast at least one vote.
    pub fn total_voters(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_total_voters(&env))
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }

    Ok(())
}

fn validate_options(options: &Vec<Symbol>) -> Result<(), Error> {
    if options.is_empty() {
        return Err(Error::EmptyOptions);
    }

    let len = options.len();
    for i in 0..len {
        let option = options.get(i).unwrap();
        for j in (i + 1)..len {
            if option == options.get(j).unwrap() {
                return Err(Error::DuplicateOption);
            }
        }
    }
    Ok(())
}
