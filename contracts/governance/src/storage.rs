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

macro_rules! inst {
    ($get:ident, $set:ident, $key:ident, $t:ty, $default:expr) => {
        pub fn $get(env: &Env) -> $t {
            env.storage().instance().get(&InstanceKey::$key).unwrap_or($default)
        }
        pub fn $set(env: &Env, v: $t) {
            env.storage().instance().set(&InstanceKey::$key, &v);
        }
    };
}

inst!(get_proposal_count, set_proposal_count, ProposalCount, u32, 0);
inst!(get_total_supply, set_total_supply, TotalSupply, i128, 0);
inst!(get_quorum_bps, set_quorum_bps, QuorumBps, i128, 400);
inst!(get_voting_period, set_voting_period, VotingPeriod, u64, 604_800);
inst!(get_exec_delay, set_exec_delay, ExecDelay, u64, 172_800);
inst!(get_deposit, set_deposit, Deposit, i128, 0);

// ── Proposals ─────────────────────────────────────────────────────────────────

pub fn set_proposal(env: &Env, p: &Proposal) {
    env.storage().persistent().set(&DataKey::Proposal(p.id), p);
}
pub fn get_proposal(env: &Env, id: u32) -> Result<Proposal, Error> {
    env.storage().persistent().get(&DataKey::Proposal(id)).ok_or(Error::ProposalNotFound)
}

// ── Balances (governance tokens) ──────────────────────────────────────────────

pub fn get_balance(env: &Env, addr: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::Balance(addr.clone())).unwrap_or(0)
}
pub fn set_balance(env: &Env, addr: &Address, v: i128) {
    env.storage().persistent().set(&DataKey::Balance(addr.clone()), &v);
}

// ── Delegation ────────────────────────────────────────────────────────────────

/// Returns the effective delegate of `addr` (follows chain up to depth 8).
pub fn resolve_delegate(env: &Env, addr: &Address) -> Address {
    let mut current = addr.clone();
    for _ in 0..8 {
        let next: Option<Address> = env.storage().persistent().get(&DataKey::Delegate(current.clone()));
        match next {
            Some(d) if d != current => current = d,
            _ => break,
        }
    }
    current
}
pub fn set_delegate(env: &Env, from: &Address, to: &Address) {
    env.storage().persistent().set(&DataKey::Delegate(from.clone()), to);
}
pub fn remove_delegate(env: &Env, from: &Address) {
    env.storage().persistent().remove(&DataKey::Delegate(from.clone()));
}

// ── Vote tracking ─────────────────────────────────────────────────────────────

pub fn has_voted(env: &Env, proposal_id: u32, voter: &Address) -> bool {
    env.storage().persistent().has(&DataKey::Voted(proposal_id, voter.clone()))
}
pub fn record_vote(env: &Env, proposal_id: u32, voter: &Address) {
    env.storage().persistent().set(&DataKey::Voted(proposal_id, voter.clone()), &true);
}
