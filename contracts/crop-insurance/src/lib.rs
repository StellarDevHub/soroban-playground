#![no_std]

//! Parametric Crop Insurance with Satellite Rainfall Oracle Integration.
//!
//! Automated insurance policy creation, satellite rainfall oracle data updates,
//! and threshold-triggered parametric claim payouts on Soroban.
//!
//! ## Solvency model
//!
//! Underwriting is gated on the contract's *actual* settlement-token balance:
//!
//! `liquid_reserves >= total_active_coverage * minimum_reserve_factor`
//!
//! The reserve factor is expressed in basis points and may not be configured
//! below 100% (10,000 bps). A second, geographic concentration limit caps the
//! active coverage written in any single `region_id` as a fraction of liquid
//! reserves, preventing one climate zone from exhausting the pool.
//!
//! Premiums are locked for the life of an active policy. Admin withdrawals may
//! only remove reserves that are surplus to both the capital requirement and
//! the aggregate locked premium balance. An optional excess-of-loss reinsurance
//! treaty exposes the recoverable amount after cumulative claims cross the
//! treaty attachment point.

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

const INSTANCE_TTL_THRESHOLD: u32 = 30 * 17_280;
const INSTANCE_TTL_BUMP: u32 = 120 * 17_280;
const DATA_TTL_THRESHOLD: u32 = 30 * 17_280;
const DATA_TTL_BUMP: u32 = 365 * 17_280;

const BPS_DENOMINATOR: i128 = 10_000;
const DEFAULT_MIN_RESERVE_FACTOR_BPS: u32 = 10_000; // 100% of active coverage
const DEFAULT_REGION_CONCENTRATION_CAP_BPS: u32 = 5_000; // 50% of liquid reserves
const MAX_MIN_RESERVE_FACTOR_BPS: u32 = 20_000; // 200% of active coverage

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Oracle,
    Token,
    Paused,
    PolicyCount,
    Policy(u64),
    Rainfall(String),
    ReserveConfig,
    TotalActiveCoverage,
    TotalLockedPremiums,
    LockedPremium(u64),
    RegionCoverage(String),
    TotalClaimsPaid,
    ReinsuranceTreaty,
    ReinsuranceRecovered,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PolicyStatus {
    Active,
    Claimed,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CropPolicy {
    pub id: u64,
    pub farmer: Address,
    pub region_id: String,
    pub rainfall_threshold_mm: u32,
    pub trigger_on_drought: bool,
    pub premium_amount: i128,
    pub payout_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub status: PolicyStatus,
}

/// Risk parameters enforced when new coverage is underwritten.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveConfig {
    /// Required liquid reserves as a basis-point multiple of active coverage.
    pub minimum_reserve_factor_bps: u32,
    /// Maximum active coverage in one region as a fraction of liquid reserves.
    pub region_concentration_cap_bps: u32,
}

/// Excess-of-loss reinsurance treaty.
///
/// The reinsurer covers losses above `attachment_point`, up to
/// `coverage_limit`, through `recover_from_reinsurer`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReinsuranceTreaty {
    pub reinsurer: Address,
    pub coverage_limit: i128,
    pub attachment_point: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    InvalidSchedule = 5,
    InvalidAmount = 6,
    PolicyNotFound = 7,
    PolicyNotActive = 8,
    TriggerConditionNotMet = 9,
    RainfallDataMissing = 10,
    AlreadyClaimed = 11,
    ArithmeticError = 12,
    InsufficientReserves = 13,
    RegionCapExceeded = 14,
    InvalidRiskConfig = 15,
    NoReinsuranceTreaty = 16,
    ReinsuranceLimitExceeded = 17,
}

#[contract]
pub struct CropInsurance;

#[contractimpl]
impl CropInsurance {
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::PolicyCount, &0u64);
        env.storage().instance().set(
            &DataKey::ReserveConfig,
            &ReserveConfig {
                minimum_reserve_factor_bps: DEFAULT_MIN_RESERVE_FACTOR_BPS,
                region_concentration_cap_bps: DEFAULT_REGION_CONCENTRATION_CAP_BPS,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::TotalActiveCoverage, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::TotalLockedPremiums, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::TotalClaimsPaid, &0i128);
        bump_instance(&env);
        env.events()
            .publish((symbol_short!("init"),), (admin, oracle, token));
        Ok(())
    }

    // ── Risk configuration ──────────────────────────────────────────────────

    /// Update the minimum reserve factor and regional concentration cap.
    ///
    /// The reserve factor may never be lowered below 100%, and a stricter
    /// factor is rejected if the current book would immediately be
    /// under-collateralised.
    pub fn set_reserve_config(
        env: Env,
        minimum_reserve_factor_bps: u32,
        region_concentration_cap_bps: u32,
    ) -> Result<(), Error> {
        admin(&env)?.require_auth();
        if !(10_000..=MAX_MIN_RESERVE_FACTOR_BPS).contains(&minimum_reserve_factor_bps)
            || !(1..=10_000).contains(&region_concentration_cap_bps)
        {
            return Err(Error::InvalidRiskConfig);
        }

        let required = required_reserves(total_active_coverage(&env), minimum_reserve_factor_bps)?;
        if required > liquid_reserves(&env)? {
            return Err(Error::InsufficientReserves);
        }

        env.storage().instance().set(
            &DataKey::ReserveConfig,
            &ReserveConfig {
                minimum_reserve_factor_bps,
                region_concentration_cap_bps,
            },
        );
        bump_instance(&env);
        env.events().publish(
            (symbol_short!("cfg"),),
            (minimum_reserve_factor_bps, region_concentration_cap_bps),
        );
        Ok(())
    }

    pub fn get_reserve_config(env: Env) -> ReserveConfig {
        reserve_config(&env)
    }

    // ── Reserve funding and withdrawals ─────────────────────────────────────

    /// Deposit settlement tokens into the underwriting pool. Anyone may fund.
    pub fn fund_reserves(env: Env, funder: Address, amount: i128) -> Result<(), Error> {
        initialized(&env)?;
        funder.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let token_addr = token_address(&env)?;
        token::Client::new(&env, &token_addr).transfer(
            &funder,
            &env.current_contract_address(),
            &amount,
        );
        env.events()
            .publish((symbol_short!("fund"),), (funder, amount));
        Ok(())
    }

    /// Withdraw only reserves surplus to active coverage requirements and
    /// locked premiums. Restricted while the contract is paused.
    pub fn withdraw_excess_reserves(env: Env, amount: i128) -> Result<(), Error> {
        initialized(&env)?;
        not_paused(&env)?;
        let admin_addr = admin(&env)?;
        admin_addr.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let config = reserve_config(&env);
        let required = required_reserves(
            total_active_coverage(&env),
            config.minimum_reserve_factor_bps,
        )?;
        let committed = required.max(total_locked_premiums(&env));
        let available = liquid_reserves(&env)?.saturating_sub(committed);
        if amount > available {
            return Err(Error::InsufficientReserves);
        }

        let token_addr = token_address(&env)?;
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &admin_addr,
            &amount,
        );
        env.events().publish((symbol_short!("wdraw"),), amount);
        Ok(())
    }

    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    pub fn set_oracle(env: Env, new_oracle: Address) -> Result<(), Error> {
        admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Oracle, &new_oracle);
        bump_instance(&env);
        env.events().publish((symbol_short!("oracle"),), new_oracle);
        Ok(())
    }

    /// Create a parametric crop insurance policy funded by premium deposit.
    ///
    /// Underwriting fails unless the post-deposit liquid reserves cover the
    /// entire active book at the configured reserve factor and the region's
    /// concentration cap.
    #[allow(clippy::too_many_arguments)]
    pub fn create_policy(
        env: Env,
        farmer: Address,
        region_id: String,
        rainfall_threshold_mm: u32,
        trigger_on_drought: bool,
        premium_amount: i128,
        payout_amount: i128,
        duration_seconds: u64,
    ) -> Result<u64, Error> {
        initialized(&env)?;
        not_paused(&env)?;
        farmer.require_auth();

        if premium_amount <= 0 || payout_amount <= premium_amount {
            return Err(Error::InvalidAmount);
        }
        if duration_seconds == 0 {
            return Err(Error::InvalidSchedule);
        }

        let now = env.ledger().timestamp();
        let end_time = now
            .checked_add(duration_seconds)
            .ok_or(Error::ArithmeticError)?;

        let token_addr = token_address(&env)?;
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&farmer, &env.current_contract_address(), &premium_amount);

        // Solvency is measured after the premium lands in the pool, so the
        // premium itself can contribute to the capital requirement.
        let reserves = token_client.balance(&env.current_contract_address());
        let config = reserve_config(&env);
        let new_coverage = total_active_coverage(&env)
            .checked_add(payout_amount)
            .ok_or(Error::ArithmeticError)?;
        if reserves < required_reserves(new_coverage, config.minimum_reserve_factor_bps)? {
            return Err(Error::InsufficientReserves);
        }

        let region_key = DataKey::RegionCoverage(region_id.clone());
        let region_coverage: i128 = env.storage().persistent().get(&region_key).unwrap_or(0);
        let new_region_coverage = region_coverage
            .checked_add(payout_amount)
            .ok_or(Error::ArithmeticError)?;
        if new_region_coverage > regional_cap(reserves, config.region_concentration_cap_bps)? {
            return Err(Error::RegionCapExceeded);
        }

        let new_locked = total_locked_premiums(&env)
            .checked_add(premium_amount)
            .ok_or(Error::ArithmeticError)?;

        let id: u64 = env.storage().instance().get(&DataKey::PolicyCount).unwrap();
        let policy = CropPolicy {
            id,
            farmer,
            region_id: region_id.clone(),
            rainfall_threshold_mm,
            trigger_on_drought,
            premium_amount,
            payout_amount,
            start_time: now,
            end_time,
            status: PolicyStatus::Active,
        };

        put_policy(&env, &policy);
        env.storage()
            .instance()
            .set(&DataKey::TotalActiveCoverage, &new_coverage);
        env.storage()
            .instance()
            .set(&DataKey::TotalLockedPremiums, &new_locked);
        env.storage()
            .persistent()
            .set(&DataKey::LockedPremium(id), &premium_amount);
        bump_key(&env, &DataKey::LockedPremium(id));
        env.storage()
            .persistent()
            .set(&region_key, &new_region_coverage);
        bump_key(&env, &region_key);
        env.storage()
            .instance()
            .set(&DataKey::PolicyCount, &(id + 1));
        bump_instance(&env);

        env.events().publish(
            (symbol_short!("create"), id),
            (policy.farmer.clone(), payout_amount, premium_amount),
        );
        Ok(id)
    }

    /// Update satellite rainfall oracle telemetry for a region.
    pub fn submit_rainfall_data(
        env: Env,
        oracle: Address,
        region_id: String,
        rainfall_mm: u32,
    ) -> Result<(), Error> {
        initialized(&env)?;
        not_paused(&env)?;
        oracle.require_auth();

        let expected_oracle: Address = env.storage().instance().get(&DataKey::Oracle).unwrap();
        if oracle != expected_oracle {
            return Err(Error::Unauthorized);
        }

        let key = DataKey::Rainfall(region_id.clone());
        env.storage().persistent().set(&key, &rainfall_mm);
        bump_key(&env, &key);

        env.events()
            .publish((symbol_short!("rain"), region_id), rainfall_mm);
        Ok(())
    }

    /// Trigger payout for a policy based on satellite oracle rainfall telemetry.
    pub fn trigger_payout(env: Env, policy_id: u64) -> Result<i128, Error> {
        initialized(&env)?;
        not_paused(&env)?;

        let mut policy = get_policy(&env, policy_id)?;
        if policy.status != PolicyStatus::Active {
            return Err(Error::PolicyNotActive);
        }

        let key = DataKey::Rainfall(policy.region_id.clone());
        let rainfall_mm: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::RainfallDataMissing)?;

        let condition_met = if policy.trigger_on_drought {
            rainfall_mm < policy.rainfall_threshold_mm
        } else {
            rainfall_mm > policy.rainfall_threshold_mm
        };

        if !condition_met {
            return Err(Error::TriggerConditionNotMet);
        }

        let token_addr = token_address(&env)?;
        let token_client = token::Client::new(&env, &token_addr);
        if token_client.balance(&env.current_contract_address()) < policy.payout_amount {
            return Err(Error::InsufficientReserves);
        }

        release_policy_capacity(&env, &policy);
        policy.status = PolicyStatus::Claimed;
        put_policy(&env, &policy);

        token_client.transfer(
            &env.current_contract_address(),
            &policy.farmer,
            &policy.payout_amount,
        );

        let claims_paid = total_claims_paid(&env)
            .checked_add(policy.payout_amount)
            .ok_or(Error::ArithmeticError)?;
        env.storage()
            .instance()
            .set(&DataKey::TotalClaimsPaid, &claims_paid);
        bump_instance(&env);

        env.events().publish(
            (symbol_short!("claimed"), policy_id),
            (policy.farmer.clone(), policy.payout_amount),
        );

        // Notify the treaty counterparty whenever a loss pushes the book into
        // the reinsurance layer. Recovery itself is pulled by the admin with
        // the reinsurer's authorisation.
        let recoverable = reinsurance_recoverable(&env);
        if recoverable > 0 {
            if let Some(treaty) = get_reinsurance_treaty(&env) {
                env.events().publish(
                    (symbol_short!("reins"), policy_id),
                    (treaty.reinsurer, recoverable),
                );
            }
        }

        Ok(policy.payout_amount)
    }

    /// Expire policy if duration ended without trigger condition being met.
    pub fn expire_policy(env: Env, policy_id: u64) -> Result<(), Error> {
        initialized(&env)?;
        let mut policy = get_policy(&env, policy_id)?;
        if policy.status != PolicyStatus::Active {
            return Err(Error::PolicyNotActive);
        }
        if env.ledger().timestamp() < policy.end_time {
            return Err(Error::InvalidSchedule);
        }

        release_policy_capacity(&env, &policy);
        policy.status = PolicyStatus::Expired;
        put_policy(&env, &policy);

        env.events()
            .publish((symbol_short!("expired"), policy_id), ());
        Ok(())
    }

    // ── Reinsurance treaty ──────────────────────────────────────────────────

    /// Register or replace an excess-of-loss reinsurance treaty.
    pub fn set_reinsurance_treaty(
        env: Env,
        reinsurer: Address,
        coverage_limit: i128,
        attachment_point: i128,
    ) -> Result<(), Error> {
        admin(&env)?.require_auth();
        if coverage_limit <= 0 || attachment_point < 0 {
            return Err(Error::InvalidAmount);
        }
        env.storage().instance().set(
            &DataKey::ReinsuranceTreaty,
            &ReinsuranceTreaty {
                reinsurer: reinsurer.clone(),
                coverage_limit,
                attachment_point,
            },
        );
        // Prior recoveries are intentionally retained so replacing a treaty
        // cannot reset the excess-of-loss layer and permit double recovery.
        bump_instance(&env);
        env.events().publish(
            (symbol_short!("treaty"),),
            (reinsurer, coverage_limit, attachment_point),
        );
        Ok(())
    }

    pub fn remove_reinsurance_treaty(env: Env) -> Result<(), Error> {
        admin(&env)?.require_auth();
        if get_reinsurance_treaty(&env).is_none() {
            return Err(Error::NoReinsuranceTreaty);
        }
        env.storage().instance().remove(&DataKey::ReinsuranceTreaty);
        bump_instance(&env);
        env.events().publish((symbol_short!("treaty"),), ());
        Ok(())
    }

    pub fn get_reinsurance_treaty(env: Env) -> Option<ReinsuranceTreaty> {
        get_reinsurance_treaty(&env)
    }

    pub fn get_reinsurance_recovered(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ReinsuranceRecovered)
            .unwrap_or(0)
    }

    /// Recoverable amount above the treaty attachment point, net of prior
    /// recoveries and capped at the treaty limit.
    pub fn reinsurance_recoverable(env: Env) -> i128 {
        reinsurance_recoverable(&env)
    }

    /// Pull a loss recovery from the reinsurer. Requires both the admin and
    /// the treaty counterparty to authorise the transfer.
    pub fn recover_from_reinsurer(env: Env, amount: i128) -> Result<(), Error> {
        admin(&env)?.require_auth();
        let treaty = get_reinsurance_treaty(&env).ok_or(Error::NoReinsuranceTreaty)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if amount > reinsurance_recoverable(&env) {
            return Err(Error::ReinsuranceLimitExceeded);
        }

        treaty.reinsurer.require_auth();
        let token_addr = token_address(&env)?;
        token::Client::new(&env, &token_addr).transfer(
            &treaty.reinsurer,
            &env.current_contract_address(),
            &amount,
        );

        let recovered = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::ReinsuranceRecovered)
            .unwrap_or(0)
            .checked_add(amount)
            .ok_or(Error::ArithmeticError)?;
        env.storage()
            .instance()
            .set(&DataKey::ReinsuranceRecovered, &recovered);
        env.events().publish((symbol_short!("recover"),), amount);
        Ok(())
    }

    // ── Views ───────────────────────────────────────────────────────────────

    pub fn get_policy(env: Env, policy_id: u64) -> Result<CropPolicy, Error> {
        get_policy(&env, policy_id)
    }

    pub fn get_rainfall(env: Env, region_id: String) -> Option<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::Rainfall(region_id))
    }

    pub fn get_total_active_coverage(env: Env) -> i128 {
        total_active_coverage(&env)
    }

    pub fn get_region_coverage(env: Env, region_id: String) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::RegionCoverage(region_id))
            .unwrap_or(0)
    }

    pub fn get_locked_premium(env: Env, policy_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::LockedPremium(policy_id))
            .unwrap_or(0)
    }

    pub fn get_total_locked_premiums(env: Env) -> i128 {
        total_locked_premiums(&env)
    }

    pub fn get_total_claims_paid(env: Env) -> i128 {
        total_claims_paid(&env)
    }

    /// Live settlement-token balance held by the underwriting pool.
    pub fn get_liquid_reserves(env: Env) -> Result<i128, Error> {
        liquid_reserves(&env)
    }

    pub fn get_required_reserves(env: Env) -> Result<i128, Error> {
        let config = reserve_config(&env);
        required_reserves(
            total_active_coverage(&env),
            config.minimum_reserve_factor_bps,
        )
    }

    /// Reserves that may be withdrawn without breaching the solvency or
    /// premium-lock constraints.
    pub fn get_available_reserves(env: Env) -> Result<i128, Error> {
        let config = reserve_config(&env);
        let required = required_reserves(
            total_active_coverage(&env),
            config.minimum_reserve_factor_bps,
        )?;
        let committed = required.max(total_locked_premiums(&env));
        Ok(liquid_reserves(&env)?.saturating_sub(committed))
    }

    pub fn is_solvent(env: Env) -> bool {
        let config = reserve_config(&env);
        let required = match required_reserves(
            total_active_coverage(&env),
            config.minimum_reserve_factor_bps,
        ) {
            Ok(value) => value,
            Err(_) => return false,
        };
        let committed = required.max(total_locked_premiums(&env));
        match liquid_reserves(&env) {
            Ok(reserves) => reserves >= committed,
            Err(_) => false,
        }
    }
}

fn initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    bump_instance(env);
    Ok(())
}

fn admin(env: &Env) -> Result<Address, Error> {
    initialized(env)?;
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        return Err(Error::Paused);
    }
    Ok(())
}

fn token_address(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(Error::NotInitialized)
}

fn liquid_reserves(env: &Env) -> Result<i128, Error> {
    let token_addr = token_address(env)?;
    Ok(token::Client::new(env, &token_addr).balance(&env.current_contract_address()))
}

fn reserve_config(env: &Env) -> ReserveConfig {
    env.storage()
        .instance()
        .get(&DataKey::ReserveConfig)
        .unwrap_or(ReserveConfig {
            minimum_reserve_factor_bps: DEFAULT_MIN_RESERVE_FACTOR_BPS,
            region_concentration_cap_bps: DEFAULT_REGION_CONCENTRATION_CAP_BPS,
        })
}

fn total_active_coverage(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalActiveCoverage)
        .unwrap_or(0)
}

fn total_locked_premiums(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalLockedPremiums)
        .unwrap_or(0)
}

fn total_claims_paid(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalClaimsPaid)
        .unwrap_or(0)
}

fn required_reserves(coverage: i128, factor_bps: u32) -> Result<i128, Error> {
    coverage
        .checked_mul(i128::from(factor_bps))
        .and_then(|value| value.checked_add(BPS_DENOMINATOR - 1))
        .map(|value| value / BPS_DENOMINATOR)
        .ok_or(Error::ArithmeticError)
}

fn regional_cap(reserves: i128, cap_bps: u32) -> Result<i128, Error> {
    reserves
        .checked_mul(i128::from(cap_bps))
        .map(|value| value / BPS_DENOMINATOR)
        .ok_or(Error::ArithmeticError)
}

fn get_reinsurance_treaty(env: &Env) -> Option<ReinsuranceTreaty> {
    env.storage().instance().get(&DataKey::ReinsuranceTreaty)
}

fn reinsurance_recoverable(env: &Env) -> i128 {
    let Some(treaty) = get_reinsurance_treaty(env) else {
        return 0;
    };
    let excess = total_claims_paid(env).saturating_sub(treaty.attachment_point);
    let covered = excess.min(treaty.coverage_limit);
    let recovered: i128 = env
        .storage()
        .instance()
        .get(&DataKey::ReinsuranceRecovered)
        .unwrap_or(0);
    covered.saturating_sub(recovered)
}

fn get_policy(env: &Env, id: u64) -> Result<CropPolicy, Error> {
    initialized(env)?;
    let key = DataKey::Policy(id);
    let policy = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::PolicyNotFound)?;
    bump_key(env, &key);
    Ok(policy)
}

fn put_policy(env: &Env, policy: &CropPolicy) {
    let key = DataKey::Policy(policy.id);
    env.storage().persistent().set(&key, policy);
    bump_key(env, &key);
}

/// Release the coverage, regional exposure, and premium lock held by a policy
/// that has just been claimed or expired. Aggregate values are clamped at zero
/// so policies written before the solvency ledger existed can still settle.
fn release_policy_capacity(env: &Env, policy: &CropPolicy) {
    let coverage = policy.payout_amount;
    let active = total_active_coverage(env);
    env.storage().instance().set(
        &DataKey::TotalActiveCoverage,
        &active.saturating_sub(coverage),
    );

    let region_key = DataKey::RegionCoverage(policy.region_id.clone());
    let region: i128 = env.storage().persistent().get(&region_key).unwrap_or(0);
    env.storage()
        .persistent()
        .set(&region_key, &region.saturating_sub(coverage));
    bump_key(env, &region_key);

    let locked_key = DataKey::LockedPremium(policy.id);
    let locked: i128 = env.storage().persistent().get(&locked_key).unwrap_or(0);
    if locked > 0 {
        env.storage().persistent().remove(&locked_key);
    }
    let total_locked = total_locked_premiums(env);
    env.storage().instance().set(
        &DataKey::TotalLockedPremiums,
        &total_locked.saturating_sub(locked),
    );
    bump_instance(env);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);
}

fn bump_key(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, DATA_TTL_THRESHOLD, DATA_TTL_BUMP);
}
