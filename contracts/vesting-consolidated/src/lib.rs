#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};
use storage::{
    get_admin, get_schedule, get_schedule_count, is_initialized, set_admin, set_initialized,
    set_schedule, set_schedule_count,
};
use types::{Error, ScheduleId, VestingCurve, VestingSchedule};

#[contract]
pub struct VestingEngine;

#[contractimpl]
impl VestingEngine {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn create_schedule(
        env: Env,
        beneficiary: Address,
        curve: VestingCurve,
        clawback_admin: Option<Address>,
    ) -> Result<ScheduleId, Error> {
        beneficiary.require_auth();

        // Validate curve
        match &curve {
            VestingCurve::Linear {
                total_amount,
                start_time,
                end_time,
            } => {
                if *total_amount <= 0 || start_time >= end_time {
                    return Err(Error::InvalidSchedule);
                }
            }
            VestingCurve::Cliff {
                initial_unlock,
                cliff_time,
                remaining_amount,
                vesting_end,
            } => {
                if *initial_unlock <= 0
                    || *remaining_amount <= 0
                    || cliff_time >= vesting_end
                {
                    return Err(Error::InvalidSchedule);
                }
            }
            VestingCurve::Exponential {
                initial_amount,
                growth_rate,
                cliff_time,
            } => {
                if *initial_amount <= 0 || *growth_rate == 0 || *cliff_time == 0 {
                    return Err(Error::InvalidSchedule);
                }
            }
            VestingCurve::Staged {
                stages,
                stage_count,
            } => {
                if *stage_count == 0 || *stage_count > 8 {
                    return Err(Error::InvalidSchedule);
                }
                let mut prev_time = 0u64;
                for i in 0..(*stage_count as usize) {
                    let (time, amount) = stages[i];
                    if time <= prev_time || amount <= 0 {
                        return Err(Error::InvalidSchedule);
                    }
                    prev_time = time;
                }
            }
        }

        let schedule_id = get_schedule_count(&env);
        let now = env.ledger().timestamp();

        let schedule = VestingSchedule {
            id: schedule_id,
            beneficiary: beneficiary.clone(),
            curve,
            clawback_admin,
            claimed_amount: 0,
            created_at: now,
        };

        set_schedule(&env, schedule_id, schedule);
        set_schedule_count(&env, schedule_id + 1);

        env.events().publish(
            (symbol_short!("created"),),
            (schedule_id, beneficiary),
        );

        Ok(schedule_id)
    }

    pub fn get_vested_amount(env: Env, schedule_id: ScheduleId) -> Result<i128, Error> {
        let schedule = get_schedule(&env, schedule_id)?;
        let now = env.ledger().timestamp();

        let vested = match &schedule.curve {
            VestingCurve::Linear {
                total_amount,
                start_time,
                end_time,
            } => {
                if now <= *start_time {
                    0
                } else if now >= *end_time {
                    *total_amount
                } else {
                    let elapsed = now - start_time;
                    let total_duration = end_time - start_time;
                    (*total_amount * elapsed as i128) / total_duration as i128
                }
            }
            VestingCurve::Cliff {
                initial_unlock,
                cliff_time,
                remaining_amount,
                vesting_end,
            } => {
                if now <= *cliff_time {
                    0
                } else if now >= *vesting_end {
                    initial_unlock + remaining_amount
                } else {
                    let elapsed = now - cliff_time;
                    let total_duration = vesting_end - cliff_time;
                    initial_unlock
                        + (*remaining_amount * elapsed as i128) / total_duration as i128
                }
            }
            VestingCurve::Exponential {
                initial_amount,
                growth_rate,
                cliff_time,
            } => {
                if now <= *cliff_time {
                    0
                } else {
                    *initial_amount
                }
            }
            VestingCurve::Staged {
                stages,
                stage_count,
            } => {
                let mut vested_total = 0i128;
                for i in 0..(*stage_count as usize) {
                    let (stage_time, stage_amount) = stages[i];
                    if now >= stage_time {
                        vested_total += stage_amount;
                    }
                }
                vested_total
            }
        };

        Ok(vested)
    }

    pub fn claim(env: Env, beneficiary: Address, schedule_id: ScheduleId) -> Result<i128, Error> {
        beneficiary.require_auth();

        let mut schedule = get_schedule(&env, schedule_id)?;

        if schedule.beneficiary != beneficiary {
            return Err(Error::Unauthorized);
        }

        let vested = Self::get_vested_amount(env.clone(), schedule_id)?;
        let claimable = vested - schedule.claimed_amount;

        if claimable <= 0 {
            return Err(Error::NothingToClaim);
        }

        schedule.claimed_amount = vested;
        set_schedule(&env, schedule_id, schedule);

        env.events().publish(
            (symbol_short!("claimed"),),
            (schedule_id, claimable),
        );

        Ok(claimable)
    }

    pub fn clawback(
        env: Env,
        admin: Address,
        schedule_id: ScheduleId,
        amount: i128,
    ) -> Result<(), Error> {
        admin.require_auth();

        let mut schedule = get_schedule(&env, schedule_id)?;

        let clawback_admin = schedule
            .clawback_admin
            .ok_or(Error::ClawbackNotAllowed)?;

        if clawback_admin != admin {
            return Err(Error::Unauthorized);
        }

        if amount <= 0 {
            return Err(Error::InvalidClawbackAmount);
        }

        let vested = Self::get_vested_amount(env.clone(), schedule_id)?;
        let clawbackable = vested - schedule.claimed_amount;

        if amount > clawbackable {
            return Err(Error::InvalidClawbackAmount);
        }

        schedule.claimed_amount += amount;
        set_schedule(&env, schedule_id, schedule);

        env.events().publish(
            (symbol_short!("clawback"),),
            (schedule_id, amount),
        );

        Ok(())
    }

    pub fn get_schedule(env: Env, schedule_id: ScheduleId) -> Result<VestingSchedule, Error> {
        get_schedule(&env, schedule_id)
    }

    pub fn get_schedule_count(env: Env) -> Result<ScheduleId, Error> {
        Ok(get_schedule_count(&env))
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }
}
