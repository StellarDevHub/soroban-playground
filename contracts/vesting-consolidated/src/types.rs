use soroban_sdk::{contract, Address};

pub type ScheduleId = u32;

#[derive(Clone, PartialEq)]
#[contract]
pub enum VestingCurve {
    Linear {
        total_amount: i128,
        start_time: u64,
        end_time: u64,
    },
    Cliff {
        initial_unlock: i128,
        cliff_time: u64,
        remaining_amount: i128,
        vesting_end: u64,
    },
    Exponential {
        initial_amount: i128,
        growth_rate: u32,
        cliff_time: u64,
    },
    Staged {
        stages: [(u64, i128); 8],
        stage_count: u8,
    },
}

#[derive(Clone)]
#[contract]
pub struct VestingSchedule {
    pub id: ScheduleId,
    pub beneficiary: Address,
    pub curve: VestingCurve,
    pub clawback_admin: Option<Address>,
    pub claimed_amount: i128,
    pub created_at: u64,
}

#[derive(Clone, Copy, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
    InvalidSchedule = 4,
    ScheduleNotFound = 5,
    VestingNotStarted = 6,
    NothingToClaim = 7,
    ClawbackNotAllowed = 8,
    InvalidClawbackAmount = 9,
    InsufficientBalance = 10,
}
