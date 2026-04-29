// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Proposal};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}
pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::Admin).ok_or(Error::NotInitialized)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&InstanceKey::Paused).unwrap_or(false)
}
pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}

pub fn get_proposal_count(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::ProposalCount).unwrap_or(0)
}
pub fn set_proposal_count(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::ProposalCount, &v);
}

pub fn get_voting_period(env: &Env) -> u64 {
    env.storage().instance().get(&InstanceKey::VotingPeriod).unwrap_or(604_800)
}
pub fn set_voting_period(env: &Env, v: u64) {
    env.storage().instance().set(&InstanceKey::VotingPeriod, &v);
}

pub fn get_max_credits(env: &Env) -> i128 {
    env.storage().instance().get(&InstanceKey::MaxCreditsPerUser).unwrap_or(100)
}
pub fn set_max_credits(env: &Env, v: i128) {
    env.storage().instance().set(&InstanceKey::MaxCreditsPerUser, &v);
}

pub fn set_proposal(env: &Env, p: &Proposal) {
    env.storage().persistent().set(&DataKey::Proposal(p.id), p);
}
pub fn get_proposal(env: &Env, id: u32) -> Result<Proposal, Error> {
    env.storage().persistent().get(&DataKey::Proposal(id)).ok_or(Error::ProposalNotFound)
}

pub fn is_whitelisted(env: &Env, addr: &Address) -> bool {
    env.storage().persistent().get(&DataKey::Whitelisted(addr.clone())).unwrap_or(false)
}
pub fn set_whitelisted(env: &Env, addr: &Address, v: bool) {
    env.storage().persistent().set(&DataKey::Whitelisted(addr.clone()), &v);
}

pub fn get_user_credits(env: &Env, voter: &Address, proposal_id: u32) -> i128 {
    env.storage().persistent().get(&DataKey::UserCredits(voter.clone(), proposal_id)).unwrap_or(0)
}
pub fn set_user_credits(env: &Env, voter: &Address, proposal_id: u32, v: i128) {
    env.storage().persistent().set(&DataKey::UserCredits(voter.clone(), proposal_id), &v);
}

pub fn has_voted(env: &Env, proposal_id: u32, voter: &Address) -> bool {
    env.storage().persistent().has(&DataKey::Voted(proposal_id, voter.clone()))
}
pub fn record_vote(env: &Env, proposal_id: u32, voter: &Address) {
    env.storage().persistent().set(&DataKey::Voted(proposal_id, voter.clone()), &true);
}
