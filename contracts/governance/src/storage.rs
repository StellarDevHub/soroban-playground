// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, Vec};

use crate::types::{DataKey, Error, InstanceKey, Proposal, UpgradePending};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}
pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

macro_rules! inst {
    ($get:ident, $set:ident, $key:ident, $t:ty, $default:expr) => {
        pub fn $get(env: &Env) -> $t {
            env.storage()
                .instance()
                .get(&InstanceKey::$key)
                .unwrap_or($default)
        }
        pub fn $set(env: &Env, v: $t) {
            env.storage().instance().set(&InstanceKey::$key, &v);
        }
    };
}

inst!(
    get_proposal_count,
    set_proposal_count,
    ProposalCount,
    u32,
    0
);
inst!(get_total_supply, set_total_supply, TotalSupply, i128, 0);
inst!(get_quorum_bps, set_quorum_bps, QuorumBps, i128, 400);
inst!(
    get_voting_period,
    set_voting_period,
    VotingPeriod,
    u64,
    604_800
);
inst!(get_exec_delay, set_exec_delay, ExecDelay, u64, 172_800);
inst!(get_deposit, set_deposit, Deposit, i128, 0);

// ── Historical checkpoints ────────────────────────────────────────────────────

/// Monotonic mutation index. Unlike timestamps, this distinguishes multiple
/// state changes made within the same ledger.
pub fn checkpoint_count(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::CheckpointCount).unwrap_or(0)
}

fn next_checkpoint(env: &Env) -> u32 {
    let next = checkpoint_count(env).saturating_add(1);
    env.storage().instance().set(&InstanceKey::CheckpointCount, &next);
    next
}

fn append_checkpoint_index(env: &Env, addr: &Address, index: u32) {
    let key = DataKey::CheckpointIndices(addr.clone());
    let mut indices: Vec<u32> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    indices.push_back(index);
    env.storage().persistent().set(&key, &indices);
}

pub fn record_balance_checkpoint(env: &Env, addr: &Address, balance: i128) {
    let index = next_checkpoint(env);
    env.storage()
        .persistent()
        .set(&DataKey::BalanceCheckpoint(addr.clone(), index), &balance);
    append_checkpoint_index(env, addr, index);
}

pub fn balance_at(env: &Env, addr: &Address, snapshot: u32) -> i128 {
    let indices: Vec<u32> = env
        .storage()
        .persistent()
        .get(&DataKey::CheckpointIndices(addr.clone()))
        .unwrap_or(Vec::new(env));
    let mut i = indices.len();
    while i > 0 {
        i -= 1;
        let index = indices.get(i).unwrap_or(0);
        if index <= snapshot {
            return env
                .storage()
                .persistent()
                .get(&DataKey::BalanceCheckpoint(addr.clone(), index))
                .unwrap_or(0);
        }
    }
    0
}

pub fn record_delegate_checkpoint(env: &Env, addr: &Address, delegate: Option<Address>) {
    let index = next_checkpoint(env);
    env.storage()
        .persistent()
        .set(&DataKey::DelegateCheckpoint(addr.clone(), index), &delegate);
    let key = DataKey::DelegateCheckpointIndices(addr.clone());
    let mut indices: Vec<u32> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    indices.push_back(index);
    env.storage().persistent().set(&key, &indices);
}

pub fn resolve_delegate_at(env: &Env, addr: &Address, snapshot: u32) -> Address {
    let mut current = addr.clone();
    for _ in 0..8 {
        let indices: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegateCheckpointIndices(current.clone()))
            .unwrap_or(Vec::new(env));
        let mut i = indices.len();
        let mut delegate: Option<Address> = None;
        while i > 0 {
            i -= 1;
            let index = indices.get(i).unwrap_or(0);
            if index <= snapshot {
                delegate = env
                    .storage()
                    .persistent()
                    .get(&DataKey::DelegateCheckpoint(current.clone(), index))
                    .unwrap_or(None);
                break;
            }
        }
        match delegate {
            Some(next) if next != current => current = next,
            _ => break,
        }
    }
    current
}

// ── Proposals ─────────────────────────────────────────────────────────────────

pub fn set_proposal(env: &Env, p: &Proposal) {
    env.storage().persistent().set(&DataKey::Proposal(p.id), p);
}
pub fn get_proposal(env: &Env, id: u32) -> Result<Proposal, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(Error::ProposalNotFound)
}

// ── Balances (governance tokens) ──────────────────────────────────────────────

pub fn get_balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(addr.clone()))
        .unwrap_or(0)
}
pub fn set_balance(env: &Env, addr: &Address, v: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(addr.clone()), &v);
}

// ── Delegation ────────────────────────────────────────────────────────────────

/// Returns the effective delegate of `addr` (follows chain up to depth 8).
pub fn resolve_delegate(env: &Env, addr: &Address) -> Address {
    let mut current = addr.clone();
    for _ in 0..8 {
        let next: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegate(current.clone()));
        match next {
            Some(d) if d != current => current = d,
            _ => break,
        }
    }
    current
}
pub fn set_delegate(env: &Env, from: &Address, to: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Delegate(from.clone()), to);
}
pub fn remove_delegate(env: &Env, from: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Delegate(from.clone()));
}

// ── Vote tracking ─────────────────────────────────────────────────────────────

pub fn has_voted(env: &Env, proposal_id: u32, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Voted(proposal_id, voter.clone()))
}
pub fn record_vote(env: &Env, proposal_id: u32, voter: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Voted(proposal_id, voter.clone()), &true);
}

// ── Pending upgrade ───────────────────────────────────────────────────────────

pub fn set_pending_upgrade(env: &Env, pending: &UpgradePending) {
    env.storage()
        .instance()
        .set(&InstanceKey::PendingUpgrade, pending);
}
pub fn get_pending_upgrade(env: &Env) -> Option<UpgradePending> {
    env.storage().instance().get(&InstanceKey::PendingUpgrade)
}
pub fn clear_pending_upgrade(env: &Env) {
    env.storage()
        .instance()
        .remove(&InstanceKey::PendingUpgrade);
}
