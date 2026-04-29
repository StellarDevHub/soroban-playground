#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    decrement_active_profiles, get_admin, get_endorsement, get_profile, get_recovery, get_stats,
    get_verification, has_profile, increment_active_profiles, is_initialized, is_paused,
    is_verifier, next_endorsement, next_profile, next_verification, set_admin, set_endorsement,
    set_paused, set_profile, set_recovery, set_verification, set_verifier,
};
use crate::types::{
    Error, FreelancerProfile, IdentityStats, PortfolioVerification, SkillEndorsement,
};

const MAX_SCORE: u32 = 100;
const MAX_ENDORSEMENT_WEIGHT: u32 = 10;

#[contract]
pub struct FreelancerIdentity;

#[contractimpl]
impl FreelancerIdentity {
    /// Initialize the identity registry. The recovery address can migrate a
    /// profile when a freelancer rotates wallets.
    pub fn initialize(env: Env, admin: Address, recovery: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_recovery(&env, &recovery);
        set_paused(&env, false);
        env.events()
            .publish((symbol_short!("init"),), (admin, recovery));
        Ok(())
    }

    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    pub fn set_verifier(
        env: Env,
        admin: Address,
        verifier: Address,
        active: bool,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_verifier(&env, &verifier, active);
        env.events()
            .publish((symbol_short!("verifyr"),), (verifier, active));
        Ok(())
    }

    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_admin(&env, &new_admin);
        env.events()
            .publish((symbol_short!("admin"),), (admin, new_admin));
        Ok(())
    }

    pub fn register_profile(
        env: Env,
        owner: Address,
        display_hash: u64,
        portfolio_hash: u64,
    ) -> Result<(), Error> {
        assert_ready(&env)?;
        owner.require_auth();
        if has_profile(&env, &owner) {
            return Err(Error::ProfileAlreadyExists);
        }
        if display_hash == 0 || portfolio_hash == 0 {
            return Err(Error::EmptyField);
        }

        let now = env.ledger().timestamp();
        next_profile(&env);
        increment_active_profiles(&env);
        set_profile(
            &env,
            &FreelancerProfile {
                owner: owner.clone(),
                display_hash,
                portfolio_hash,
                verified_projects: 0,
                endorsement_count: 0,
                reputation: 0,
                active: true,
                created_at: now,
                updated_at: now,
            },
        );
        env.events()
            .publish((symbol_short!("profile"),), (owner, portfolio_hash));
        Ok(())
    }

    pub fn update_portfolio(
        env: Env,
        owner: Address,
        portfolio_hash: u64,
    ) -> Result<(), Error> {
        assert_ready(&env)?;
        owner.require_auth();
        if portfolio_hash == 0 {
            return Err(Error::EmptyField);
        }
        let mut profile = get_active_profile(&env, &owner)?;
        profile.portfolio_hash = portfolio_hash;
        profile.updated_at = env.ledger().timestamp();
        set_profile(&env, &profile);
        env.events()
            .publish((symbol_short!("port_upd"),), (owner, portfolio_hash));
        Ok(())
    }

    pub fn verify_portfolio(
        env: Env,
        verifier: Address,
        freelancer: Address,
        project_hash: u64,
        evidence_hash: u64,
        score: u32,
    ) -> Result<u32, Error> {
        assert_ready(&env)?;
        verifier.require_auth();
        if !is_verifier(&env, &verifier) {
            return Err(Error::Unauthorized);
        }
        if score == 0 || score > MAX_SCORE {
            return Err(Error::InvalidScore);
        }
        if project_hash == 0 || evidence_hash == 0 {
            return Err(Error::EmptyField);
        }

        let mut profile = get_active_profile(&env, &freelancer)?;
        let id = next_verification(&env);
        let verification = PortfolioVerification {
            id,
            freelancer: freelancer.clone(),
            verifier: verifier.clone(),
            project_hash,
            evidence_hash,
            score,
            created_at: env.ledger().timestamp(),
            active: true,
        };
        set_verification(&env, &verification);

        profile.verified_projects = profile.verified_projects.saturating_add(1);
        profile.reputation = profile.reputation.saturating_add(score as i32);
        profile.updated_at = env.ledger().timestamp();
        set_profile(&env, &profile);

        env.events()
            .publish((symbol_short!("verif"), id), (freelancer, score));
        Ok(id)
    }

    pub fn endorse_skill(
        env: Env,
        endorser: Address,
        subject: Address,
        skill_hash: u64,
        evidence_hash: u64,
        weight: u32,
    ) -> Result<u32, Error> {
        assert_ready(&env)?;
        endorser.require_auth();
        if endorser == subject {
            return Err(Error::SelfEndorsement);
        }
        if weight == 0 || weight > MAX_ENDORSEMENT_WEIGHT {
            return Err(Error::InvalidWeight);
        }
        if skill_hash == 0 || evidence_hash == 0 {
            return Err(Error::EmptyField);
        }
        let endorser_profile = get_active_profile(&env, &endorser)?;
        let mut subject_profile = get_active_profile(&env, &subject)?;

        let id = next_endorsement(&env);
        let endorsement = SkillEndorsement {
            id,
            subject: subject.clone(),
            endorser: endorser.clone(),
            skill_hash,
            evidence_hash,
            weight,
            created_at: env.ledger().timestamp(),
            revoked: false,
        };
        set_endorsement(&env, &endorsement);

        let trust_bonus = if endorser_profile.verified_projects > 0 { 2 } else { 1 };
        subject_profile.endorsement_count = subject_profile.endorsement_count.saturating_add(1);
        subject_profile.reputation = subject_profile
            .reputation
            .saturating_add((weight * trust_bonus) as i32);
        subject_profile.updated_at = env.ledger().timestamp();
        set_profile(&env, &subject_profile);

        env.events()
            .publish((symbol_short!("endorse"), id), (subject, skill_hash, weight));
        Ok(id)
    }

    pub fn revoke_endorsement(
        env: Env,
        admin: Address,
        endorsement_id: u32,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        let mut endorsement = get_endorsement(&env, endorsement_id)?;
        if endorsement.revoked {
            return Err(Error::AlreadyRevoked);
        }
        endorsement.revoked = true;
        set_endorsement(&env, &endorsement);
        env.events()
            .publish((symbol_short!("rev_end"), endorsement_id), admin);
        Ok(())
    }

    pub fn deactivate_profile(env: Env, owner: Address) -> Result<(), Error> {
        assert_ready(&env)?;
        owner.require_auth();
        let mut profile = get_active_profile(&env, &owner)?;
        profile.active = false;
        profile.updated_at = env.ledger().timestamp();
        set_profile(&env, &profile);
        decrement_active_profiles(&env);
        env.events().publish((symbol_short!("deact"),), owner);
        Ok(())
    }

    pub fn recover_profile(
        env: Env,
        recovery: Address,
        old_owner: Address,
        new_owner: Address,
    ) -> Result<(), Error> {
        assert_ready(&env)?;
        let registered_recovery = get_recovery(&env)?;
        if recovery != registered_recovery {
            return Err(Error::Unauthorized);
        }
        recovery.require_auth();
        if has_profile(&env, &new_owner) {
            return Err(Error::ProfileAlreadyExists);
        }
        let mut profile = get_active_profile(&env, &old_owner)?;
        profile.owner = new_owner.clone();
        profile.updated_at = env.ledger().timestamp();
        set_profile(&env, &profile);

        let mut old_profile = profile.clone();
        old_profile.owner = old_owner.clone();
        old_profile.active = false;
        set_profile(&env, &old_profile);
        env.events()
            .publish((symbol_short!("recover"),), (old_owner, new_owner));
        Ok(())
    }

    pub fn get_profile(env: Env, owner: Address) -> Result<FreelancerProfile, Error> {
        get_profile(&env, &owner)
    }

    pub fn get_verification(env: Env, id: u32) -> Result<PortfolioVerification, Error> {
        get_verification(&env, id)
    }

    pub fn get_endorsement(env: Env, id: u32) -> Result<SkillEndorsement, Error> {
        get_endorsement(&env, id)
    }

    pub fn get_stats(env: Env) -> IdentityStats {
        get_stats(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

fn assert_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    assert_initialized(env)?;
    let stored = get_admin(env)?;
    if stored != *admin {
        return Err(Error::Unauthorized);
    }
    admin.require_auth();
    Ok(())
}

fn assert_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn assert_ready(env: &Env) -> Result<(), Error> {
    assert_initialized(env)?;
    if is_paused(env) {
        return Err(Error::Paused);
    }
    Ok(())
}

fn get_active_profile(env: &Env, owner: &Address) -> Result<FreelancerProfile, Error> {
    let profile = get_profile(env, owner)?;
    if !profile.active {
        return Err(Error::ProfileInactive);
    }
    Ok(profile)
}
