// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Event emissions for the Job Marketplace contract

use soroban_sdk::{Env, Address, Symbol, symbol_short};

/// Event: Job created
pub fn emit_job_created(
    env: &Env,
    job_id: u64,
    client: &Address,
    payment_token: &Address,
    total_escrow: i128,
) {
    env.events().publish(
        (symbol_short!("job_crtd"),),
        (job_id, client.clone(), payment_token.clone(), total_escrow),
    );
}

/// Event: Job accepted
pub fn emit_job_accepted(
    env: &Env,
    job_id: u64,
    freelancer: &Address,
) {
    env.events().publish(
        (symbol_short!("job_accpt"),),
        (job_id, freelancer.clone()),
    );
}

/// Event: Milestone released
pub fn emit_milestone_released(
    env: &Env,
    job_id: u64,
    freelancer: &Address,
    amount: i128,
    milestone_index: u32,
) {
    env.events().publish(
        (symbol_short!("ms_rlsd"),),
        (job_id, freelancer.clone(), amount, milestone_index),
    );
}

/// Event: Job completed
pub fn emit_job_completed(
    env: &Env,
    job_id: u64,
    freelancer: &Address,
    total_paid: i128,
) {
    env.events().publish(
        (symbol_short!("job_cmplt"),),
        (job_id, freelancer.clone(), total_paid),
    );
}

/// Event: Job cancelled
pub fn emit_job_cancelled(
    env: &Env,
    job_id: u64,
    client: &Address,
    refund_amount: i128,
) {
    env.events().publish(
        (symbol_short!("job_cncld"),),
        (job_id, client.clone(), refund_amount),
    );
}

/// Event: Dispute raised
pub fn emit_dispute_raised(
    env: &Env,
    dispute_id: u64,
    job_id: u64,
    raised_by: &Address,
    reason: &soroban_sdk::String,
) {
    env.events().publish(
        (symbol_short!("disp_rlsd"),),
        (dispute_id, job_id, raised_by.clone(), reason.clone()),
    );
}

/// Event: Dispute resolved
pub fn emit_dispute_resolved(
    env: &Env,
    dispute_id: u64,
    job_id: u64,
    resolved_by: &Address,
    refund_client: i128,
    release_freelancer: i128,
) {
    env.events().publish(
        (symbol_short!("disp_rslv"),),
        (dispute_id, job_id, resolved_by.clone(), refund_client, release_freelancer),
    );
}

/// Event: Skill verified
pub fn emit_skill_verified(
    env: &Env,
    user: &Address,
    skill: &Symbol,
    level: u32,
) {
    env.events().publish(
        (symbol_short!("skill_vrf"),),
        (user.clone(), skill.clone(), level),
    );
}

/// Event: Certification issued
pub fn emit_certification_issued(
    env: &Env,
    user: &Address,
    certification_name: &soroban_sdk::String,
    issuer: &soroban_sdk::String,
    valid_until: u64,
) {
    env.events().publish(
        (symbol_short!("cert_iss"),),
        (user.clone(), certification_name.clone(), issuer.clone(), valid_until),
    );
}

/// Event: Contract paused
pub fn emit_paused(
    env: &Env,
    admin: &Address,
) {
    env.events().publish(
        (symbol_short!("paused"),),
        admin.clone(),
    );
}

/// Event: Contract unpaused
pub fn emit_unpaused(
    env: &Env,
    admin: &Address,
) {
    env.events().publish(
        (symbol_short!("unpause"),),
        admin.clone(),
    );
}
