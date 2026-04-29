use soroban_sdk::{Address, Env};

use crate::types::{
    DataKey, Error, FreelancerProfile, IdentityStats, InstanceKey, PortfolioVerification,
    SkillEndorsement,
};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_recovery(env: &Env, recovery: &Address) {
    env.storage().instance().set(&InstanceKey::Recovery, recovery);
}

pub fn get_recovery(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Recovery)
        .ok_or(Error::NotInitialized)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn set_verifier(env: &Env, verifier: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Verifier(verifier.clone()), &active);
}

pub fn is_verifier(env: &Env, verifier: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Verifier(verifier.clone()))
        .unwrap_or(false)
}

pub fn has_profile(env: &Env, owner: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Profile(owner.clone()))
}

pub fn set_profile(env: &Env, profile: &FreelancerProfile) {
    env.storage()
        .persistent()
        .set(&DataKey::Profile(profile.owner.clone()), profile);
}

pub fn get_profile(env: &Env, owner: &Address) -> Result<FreelancerProfile, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Profile(owner.clone()))
        .ok_or(Error::ProfileNotFound)
}

pub fn next_profile(env: &Env) -> u32 {
    let count = get_profile_count(env).saturating_add(1);
    env.storage()
        .instance()
        .set(&InstanceKey::ProfileCount, &count);
    count
}

pub fn increment_active_profiles(env: &Env) {
    let count = get_active_profile_count(env).saturating_add(1);
    env.storage()
        .instance()
        .set(&InstanceKey::ActiveProfileCount, &count);
}

pub fn decrement_active_profiles(env: &Env) {
    let count = get_active_profile_count(env).saturating_sub(1);
    env.storage()
        .instance()
        .set(&InstanceKey::ActiveProfileCount, &count);
}

pub fn get_profile_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::ProfileCount)
        .unwrap_or(0)
}

pub fn get_active_profile_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::ActiveProfileCount)
        .unwrap_or(0)
}

pub fn next_verification(env: &Env) -> u32 {
    let count = get_verification_count(env).saturating_add(1);
    env.storage()
        .instance()
        .set(&InstanceKey::VerificationCount, &count);
    count
}

pub fn get_verification_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::VerificationCount)
        .unwrap_or(0)
}

pub fn set_verification(env: &Env, verification: &PortfolioVerification) {
    env.storage()
        .persistent()
        .set(&DataKey::Verification(verification.id), verification);
}

pub fn get_verification(env: &Env, id: u32) -> Result<PortfolioVerification, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Verification(id))
        .ok_or(Error::PortfolioNotFound)
}

pub fn next_endorsement(env: &Env) -> u32 {
    let count = get_endorsement_count(env).saturating_add(1);
    env.storage()
        .instance()
        .set(&InstanceKey::EndorsementCount, &count);
    count
}

pub fn get_endorsement_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::EndorsementCount)
        .unwrap_or(0)
}

pub fn set_endorsement(env: &Env, endorsement: &SkillEndorsement) {
    env.storage()
        .persistent()
        .set(&DataKey::Endorsement(endorsement.id), endorsement);
}

pub fn get_endorsement(env: &Env, id: u32) -> Result<SkillEndorsement, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Endorsement(id))
        .ok_or(Error::EndorsementNotFound)
}

pub fn get_stats(env: &Env) -> IdentityStats {
    IdentityStats {
        profile_count: get_profile_count(env),
        verification_count: get_verification_count(env),
        endorsement_count: get_endorsement_count(env),
        active_profiles: get_active_profile_count(env),
    }
}
