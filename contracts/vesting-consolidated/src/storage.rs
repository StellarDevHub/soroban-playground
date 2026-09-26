use soroban_sdk::{Address, Env};
use crate::types::{Error, ScheduleId, VestingSchedule};

pub enum StorageKey {
    Admin,
    Initialized,
    ScheduleCount,
    Schedule(ScheduleId),
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .persistent()
        .has(&StorageKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .persistent()
        .set(&StorageKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .persistent()
        .get(&StorageKey::Admin)
        .ok_or(Error::NotInitialized)
        .map(|a: Address| a)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .persistent()
        .set(&StorageKey::Admin, admin);
}

pub fn get_schedule(env: &Env, schedule_id: ScheduleId) -> Result<VestingSchedule, Error> {
    env.storage()
        .persistent()
        .get(&StorageKey::Schedule(schedule_id))
        .ok_or(Error::ScheduleNotFound)
        .map(|s: VestingSchedule| s)
}

pub fn set_schedule(env: &Env, schedule_id: ScheduleId, schedule: VestingSchedule) {
    env.storage()
        .persistent()
        .set(&StorageKey::Schedule(schedule_id), &schedule);
}

pub fn get_schedule_count(env: &Env) -> ScheduleId {
    env.storage()
        .persistent()
        .get(&StorageKey::ScheduleCount)
        .unwrap_or(0u32)
}

pub fn set_schedule_count(env: &Env, count: ScheduleId) {
    env.storage()
        .persistent()
        .set(&StorageKey::ScheduleCount, &count);
}
