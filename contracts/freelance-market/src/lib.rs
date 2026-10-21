// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    JobNotFound = 4,
    InvalidJobStatus = 5,
    InsufficientStake = 6,
    AlreadyApplied = 7,
    ApplicationNotFound = 8,
    DeadlineExceeded = 9,
    DeadlineNotBreached = 10,
    InvalidMilestone = 11,
    MilestoneAlreadyCompleted = 12,
    MilestoneNotSubmitted = 13,
    InvalidParameters = 14,
    MathOverflow = 15,
    CancellationAlreadyRequested = 16,
    NoCancellationPending = 17,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum JobStatus {
    Open = 0,
    InProgress = 1,
    Completed = 2,
    Slashed = 3,
    Cancelled = 4,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MilestoneStatus {
    Pending = 0,
    Submitted = 1,
    Approved = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub index: u32,
    pub amount: i128,
    pub status: MilestoneStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobListing {
    pub id: u64,
    pub client: Address,
    pub selected_freelancer: Option<Address>,
    pub title: String,
    pub total_budget: i128,
    pub remaining_budget: i128,
    pub required_stake: i128,
    pub deadline: u64,
    pub status: JobStatus,
    pub milestone_count: u32,
    pub completed_milestones: u32,
    pub cancellation_initiator: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Application {
    pub freelancer: Address,
    pub stake_amount: i128,
    pub applied_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reputation {
    pub completed_gigs: u32,
    pub on_time_deliveries: u32,
    pub slashed_gigs: u32,
    pub total_earned: i128,
}

#[contracttype]
enum DataKey {
    Admin,
    JobCount,
    Job(u64),
    Milestone(u64, u32),
    Application(u64, Address),
    ApplicantList(u64),
    Reputation(Address),
}

#[contract]
pub struct FreelanceMarket;

#[contractimpl]
impl FreelanceMarket {
    /// Initialize the freelance marketplace
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::JobCount, &0u64);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Post a new job listing with project payment budget locked in escrow
    pub fn create_job(
        env: Env,
        client: Address,
        title: String,
        total_budget: i128,
        required_stake: i128,
        deadline: u64,
        milestone_count: u32,
    ) -> Result<u64, Error> {
        client.require_auth();

        if total_budget <= 0 || required_stake < 0 || milestone_count == 0 {
            return Err(Error::InvalidParameters);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidParameters);
        }

        let mut job_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::JobCount)
            .unwrap_or(0);
        job_id = job_id.checked_add(1).ok_or(Error::MathOverflow)?;

        let milestone_payout = total_budget
            .checked_div(milestone_count as i128)
            .ok_or(Error::MathOverflow)?;
        if milestone_payout <= 0 {
            return Err(Error::InvalidParameters);
        }

        let job = JobListing {
            id: job_id,
            client: client.clone(),
            selected_freelancer: None,
            title,
            total_budget,
            remaining_budget: total_budget,
            required_stake,
            deadline,
            status: JobStatus::Open,
            milestone_count,
            completed_milestones: 0,
            cancellation_initiator: None,
        };

        // Initialize milestones
        for idx in 0..milestone_count {
            let milestone = Milestone {
                index: idx,
                amount: milestone_payout,
                status: MilestoneStatus::Pending,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Milestone(job_id, idx), &milestone);
        }

        env.storage().persistent().set(&DataKey::Job(job_id), &job);
        let empty_applicants: Vec<Address> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::ApplicantList(job_id), &empty_applicants);
        env.storage().instance().set(&DataKey::JobCount, &job_id);

        env.events().publish(
            (symbol_short!("job_crt"),),
            (job_id, client, total_budget, required_stake),
        );

        Ok(job_id)
    }

    /// Freelancer applies by depositing commitment stake bond to eliminate spam
    pub fn apply(
        env: Env,
        freelancer: Address,
        job_id: u64,
        stake_amount: i128,
    ) -> Result<(), Error> {
        freelancer.require_auth();

        let job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::Open {
            return Err(Error::InvalidJobStatus);
        }
        if stake_amount < job.required_stake {
            return Err(Error::InsufficientStake);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Application(job_id, freelancer.clone()))
        {
            return Err(Error::AlreadyApplied);
        }

        let application = Application {
            freelancer: freelancer.clone(),
            stake_amount,
            applied_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Application(job_id, freelancer.clone()), &application);

        let mut applicants: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::ApplicantList(job_id))
            .unwrap_or(Vec::new(&env));
        applicants.push_back(freelancer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ApplicantList(job_id), &applicants);

        env.events().publish(
            (symbol_short!("applied"),),
            (job_id, freelancer, stake_amount),
        );

        Ok(())
    }

    /// Client selects and hires applicant; transitions job to InProgress
    pub fn hire_freelancer(
        env: Env,
        client: Address,
        job_id: u64,
        freelancer: Address,
    ) -> Result<(), Error> {
        client.require_auth();

        let mut job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.client != client {
            return Err(Error::Unauthorized);
        }
        if job.status != JobStatus::Open {
            return Err(Error::InvalidJobStatus);
        }

        if !env
            .storage()
            .persistent()
            .has(&DataKey::Application(job_id, freelancer.clone()))
        {
            return Err(Error::ApplicationNotFound);
        }

        job.selected_freelancer = Some(freelancer.clone());
        job.status = JobStatus::InProgress;
        env.storage().persistent().set(&DataKey::Job(job_id), &job);

        env.events().publish(
            (symbol_short!("hired"),),
            (job_id, client, freelancer),
        );

        Ok(())
    }

    /// Freelancer submits milestone delivery for review
    pub fn submit_milestone(
        env: Env,
        freelancer: Address,
        job_id: u64,
        milestone_index: u32,
    ) -> Result<(), Error> {
        freelancer.require_auth();

        let job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }
        if job.selected_freelancer != Some(freelancer.clone()) {
            return Err(Error::Unauthorized);
        }
        if milestone_index >= job.milestone_count {
            return Err(Error::InvalidMilestone);
        }

        let mut milestone: Milestone = env
            .storage()
            .persistent()
            .get(&DataKey::Milestone(job_id, milestone_index))
            .ok_or(Error::InvalidMilestone)?;

        if milestone.status != MilestoneStatus::Pending {
            return Err(Error::MilestoneAlreadyCompleted);
        }

        milestone.status = MilestoneStatus::Submitted;
        env.storage()
            .persistent()
            .set(&DataKey::Milestone(job_id, milestone_index), &milestone);

        env.events().publish(
            (symbol_short!("sub_mile"),),
            (job_id, milestone_index, freelancer),
        );

        Ok(())
    }

    /// Client approves milestone delivery: releases payout tranche, returns stake on completion
    pub fn release_milestone(
        env: Env,
        client: Address,
        job_id: u64,
        milestone_index: u32,
    ) -> Result<i128, Error> {
        client.require_auth();

        let mut job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.client != client {
            return Err(Error::Unauthorized);
        }
        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }
        if milestone_index >= job.milestone_count {
            return Err(Error::InvalidMilestone);
        }

        let mut milestone: Milestone = env
            .storage()
            .persistent()
            .get(&DataKey::Milestone(job_id, milestone_index))
            .ok_or(Error::InvalidMilestone)?;

        if milestone.status == MilestoneStatus::Approved {
            return Err(Error::MilestoneAlreadyCompleted);
        }
        if milestone.status != MilestoneStatus::Submitted {
            return Err(Error::MilestoneNotSubmitted);
        }

        milestone.status = MilestoneStatus::Approved;
        env.storage()
            .persistent()
            .set(&DataKey::Milestone(job_id, milestone_index), &milestone);

        let payout = milestone.amount;
        job.remaining_budget = job
            .remaining_budget
            .checked_sub(payout)
            .ok_or(Error::MathOverflow)?;
        job.completed_milestones = job
            .completed_milestones
            .checked_add(1)
            .ok_or(Error::MathOverflow)?;

        let freelancer = job.selected_freelancer.clone().unwrap();

        // Check if all milestones are completed
        let is_completed = job.completed_milestones == job.milestone_count;
        if is_completed {
            job.status = JobStatus::Completed;

            // Update reputation
            let mut rep = Self::get_reputation_internal(&env, &freelancer);
            rep.completed_gigs = rep.completed_gigs.checked_add(1).ok_or(Error::MathOverflow)?;
            rep.total_earned = rep
                .total_earned
                .checked_add(job.total_budget)
                .ok_or(Error::MathOverflow)?;

            let is_on_time = env.ledger().timestamp() <= job.deadline;
            if is_on_time {
                rep.on_time_deliveries = rep
                    .on_time_deliveries
                    .checked_add(1)
                    .ok_or(Error::MathOverflow)?;
            }
            env.storage()
                .persistent()
                .set(&DataKey::Reputation(freelancer.clone()), &rep);
        }

        env.storage().persistent().set(&DataKey::Job(job_id), &job);

        env.events().publish(
            (symbol_short!("rel_mile"),),
            (job_id, milestone_index, payout, is_completed),
        );

        Ok(payout)
    }

    /// Slashing mechanism: if freelancer abandons project or breaches agreed timeline
    pub fn slash_freelancer(
        env: Env,
        caller: Address,
        job_id: u64,
    ) -> Result<i128, Error> {
        caller.require_auth();

        let mut job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }

        let is_client = caller == job.client;
        let is_admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            == Some(caller.clone());

        if !is_client && !is_admin {
            return Err(Error::Unauthorized);
        }

        // Must have breached timeline unless admin peer arbitrator overrides
        let now = env.ledger().timestamp();
        if !is_admin && now <= job.deadline {
            return Err(Error::DeadlineNotBreached);
        }

        let freelancer = job
            .selected_freelancer
            .clone()
            .ok_or(Error::ApplicationNotFound)?;

        let slashed_stake = job.required_stake;
        job.status = JobStatus::Slashed;
        env.storage().persistent().set(&DataKey::Job(job_id), &job);

        // Update reputation penalty
        let mut rep = Self::get_reputation_internal(&env, &freelancer);
        rep.slashed_gigs = rep.slashed_gigs.checked_add(1).ok_or(Error::MathOverflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(freelancer.clone()), &rep);

        env.events().publish(
            (symbol_short!("slashed"),),
            (job_id, freelancer, slashed_stake, job.remaining_budget),
        );

        Ok(slashed_stake)
    }

    /// Mutual cancellation: one party initiates, other confirms; returns stake and unspent escrow
    pub fn request_cancellation(
        env: Env,
        caller: Address,
        job_id: u64,
    ) -> Result<(), Error> {
        caller.require_auth();

        let mut job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }

        let is_client = caller == job.client;
        let is_freelancer = job.selected_freelancer == Some(caller.clone());

        if !is_client && !is_freelancer {
            return Err(Error::Unauthorized);
        }

        if job.cancellation_initiator.is_some() {
            return Err(Error::CancellationAlreadyRequested);
        }

        job.cancellation_initiator = Some(caller.clone());
        env.storage().persistent().set(&DataKey::Job(job_id), &job);

        env.events().publish((symbol_short!("req_cnc"),), (job_id, caller));
        Ok(())
    }

    /// Confirm mutual cancellation by the counterparty
    pub fn confirm_cancellation(
        env: Env,
        caller: Address,
        job_id: u64,
    ) -> Result<(), Error> {
        caller.require_auth();

        let mut job: JobListing = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(Error::InvalidJobStatus);
        }

        let initiator = job
            .cancellation_initiator
            .clone()
            .ok_or(Error::NoCancellationPending)?;

        if initiator == caller {
            return Err(Error::Unauthorized);
        }

        let is_client = caller == job.client;
        let is_freelancer = job.selected_freelancer == Some(caller.clone());

        if !is_client && !is_freelancer {
            return Err(Error::Unauthorized);
        }

        job.status = JobStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Job(job_id), &job);

        env.events().publish(
            (symbol_short!("canceled"),),
            (job_id, job.remaining_budget, job.required_stake),
        );

        Ok(())
    }

    /// Query reputation history
    pub fn get_reputation(env: Env, freelancer: Address) -> Reputation {
        Self::get_reputation_internal(&env, &freelancer)
    }

    /// Query on-time delivery rate in basis points (e.g. 9500 = 95.00%)
    pub fn get_on_time_rate_bps(env: Env, freelancer: Address) -> u32 {
        let rep = Self::get_reputation_internal(&env, &freelancer);
        if rep.completed_gigs == 0 {
            return 0;
        }
        ((rep.on_time_deliveries as u64 * 10_000) / rep.completed_gigs as u64) as u32
    }

    /// Query job listing
    pub fn get_job(env: Env, job_id: u64) -> Result<JobListing, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(Error::JobNotFound)
    }

    /// Query milestone details
    pub fn get_milestone(
        env: Env,
        job_id: u64,
        milestone_index: u32,
    ) -> Result<Milestone, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(job_id, milestone_index))
            .ok_or(Error::InvalidMilestone)
    }

    /// Helper for reputation
    fn get_reputation_internal(env: &Env, freelancer: &Address) -> Reputation {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(freelancer.clone()))
            .unwrap_or(Reputation {
                completed_gigs: 0,
                on_time_deliveries: 0,
                slashed_gigs: 0,
                total_earned: 0,
            })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, String, Env};

    #[test]
    fn test_job_creation_and_application_staking() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer1 = Address::generate(&env);
        let freelancer2 = Address::generate(&env);

        env.mock_all_auths();
        FreelanceMarket::initialize(env.clone(), admin).unwrap();

        let title = String::from_str(&env, "Build Soroban Oracle");
        let deadline = env.ledger().timestamp() + 86400;

        let job_id = FreelanceMarket::create_job(
            env.clone(),
            client.clone(),
            title,
            1_000, // budget
            100,   // required stake
            deadline,
            2,     // 2 milestones
        ).unwrap();

        assert_eq!(job_id, 1);

        // Low stake rejected
        let err = FreelanceMarket::apply(env.clone(), freelancer1.clone(), job_id, 50);
        assert_eq!(err, Err(Error::InsufficientStake));

        // Valid stake accepted
        assert_eq!(FreelanceMarket::apply(env.clone(), freelancer1.clone(), job_id, 100), Ok(()));

        // Duplicate application rejected
        let err = FreelanceMarket::apply(env.clone(), freelancer1.clone(), job_id, 100);
        assert_eq!(err, Err(Error::AlreadyApplied));

        // Second applicant applies
        assert_eq!(FreelanceMarket::apply(env.clone(), freelancer2.clone(), job_id, 100), Ok(()));
    }

    #[test]
    fn test_hiring_milestone_delivery_and_reputation() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        env.mock_all_auths();
        FreelanceMarket::initialize(env.clone(), admin).unwrap();

        let deadline = env.ledger().timestamp() + 10_000;
        let job_id = FreelanceMarket::create_job(
            env.clone(),
            client.clone(),
            String::from_str(&env, "Indexer Dev"),
            2_000,
            200,
            deadline,
            2,
        ).unwrap();

        FreelanceMarket::apply(env.clone(), freelancer.clone(), job_id, 200).unwrap();
        FreelanceMarket::hire_freelancer(env.clone(), client.clone(), job_id, freelancer.clone()).unwrap();

        let job = FreelanceMarket::get_job(env.clone(), job_id).unwrap();
        assert_eq!(job.status, JobStatus::InProgress);
        assert_eq!(job.selected_freelancer, Some(freelancer.clone()));

        // Submit and release Milestone 0
        FreelanceMarket::submit_milestone(env.clone(), freelancer.clone(), job_id, 0).unwrap();
        let payout1 = FreelanceMarket::release_milestone(env.clone(), client.clone(), job_id, 0).unwrap();
        assert_eq!(payout1, 1_000);

        // Submit and release Milestone 1 (Completes project)
        FreelanceMarket::submit_milestone(env.clone(), freelancer.clone(), job_id, 1).unwrap();
        let payout2 = FreelanceMarket::release_milestone(env.clone(), client.clone(), job_id, 1).unwrap();
        assert_eq!(payout2, 1_000);

        let final_job = FreelanceMarket::get_job(env.clone(), job_id).unwrap();
        assert_eq!(final_job.status, JobStatus::Completed);
        assert_eq!(final_job.remaining_budget, 0);

        // Check reputation
        let rep = FreelanceMarket::get_reputation(env.clone(), freelancer.clone());
        assert_eq!(rep.completed_gigs, 1);
        assert_eq!(rep.on_time_deliveries, 1);
        assert_eq!(rep.total_earned, 2_000);
        assert_eq!(FreelanceMarket::get_on_time_rate_bps(env.clone(), freelancer), 10_000);
    }

    #[test]
    fn test_slashing_abandoned_project() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        env.mock_all_auths();
        FreelanceMarket::initialize(env.clone(), admin).unwrap();

        let start_time = 1_000;
        env.ledger().set_timestamp(start_time);
        let deadline = start_time + 500;

        let job_id = FreelanceMarket::create_job(
            env.clone(),
            client.clone(),
            String::from_str(&env, "UI Design"),
            1_500,
            150,
            deadline,
            1,
        ).unwrap();

        FreelanceMarket::apply(env.clone(), freelancer.clone(), job_id, 150).unwrap();
        FreelanceMarket::hire_freelancer(env.clone(), client.clone(), job_id, freelancer.clone()).unwrap();

        // Attempt slashing before deadline fails
        let err = FreelanceMarket::slash_freelancer(env.clone(), client.clone(), job_id);
        assert_eq!(err, Err(Error::DeadlineNotBreached));

        // Advance ledger past deadline
        env.ledger().set_timestamp(deadline + 1);

        // Client successfully slashes commitment bond
        let slashed = FreelanceMarket::slash_freelancer(env.clone(), client.clone(), job_id).unwrap();
        assert_eq!(slashed, 150);

        let job = FreelanceMarket::get_job(env.clone(), job_id).unwrap();
        assert_eq!(job.status, JobStatus::Slashed);

        let rep = FreelanceMarket::get_reputation(env.clone(), freelancer);
        assert_eq!(rep.slashed_gigs, 1);
    }

    #[test]
    fn test_mutual_cancellation() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        env.mock_all_auths();
        FreelanceMarket::initialize(env.clone(), admin).unwrap();

        let deadline = env.ledger().timestamp() + 5_000;
        let job_id = FreelanceMarket::create_job(
            env.clone(),
            client.clone(),
            String::from_str(&env, "Smart Contract Audit"),
            3_000,
            300,
            deadline,
            3,
        ).unwrap();

        FreelanceMarket::apply(env.clone(), freelancer.clone(), job_id, 300).unwrap();
        FreelanceMarket::hire_freelancer(env.clone(), client.clone(), job_id, freelancer.clone()).unwrap();

        // Client initiates cancellation
        FreelanceMarket::request_cancellation(env.clone(), client.clone(), job_id).unwrap();

        // Client cannot confirm their own request
        let err = FreelanceMarket::confirm_cancellation(env.clone(), client.clone(), job_id);
        assert_eq!(err, Err(Error::Unauthorized));

        // Freelancer confirms cancellation
        assert_eq!(FreelanceMarket::confirm_cancellation(env.clone(), freelancer, job_id), Ok(()));

        let job = FreelanceMarket::get_job(env.clone(), job_id).unwrap();
        assert_eq!(job.status, JobStatus::Cancelled);
    }
}
