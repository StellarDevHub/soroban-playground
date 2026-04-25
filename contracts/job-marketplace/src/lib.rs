#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, token};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    JobCount,
    Job(u64), // JobId
}

#[contracttype]
#[derive(Clone, PartialEq, Eq)]
pub enum JobStatus {
    Open,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    pub description: Symbol,
    pub amount: i128,
    pub is_released: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct Job {
    pub id: u64,
    pub client: Address,
    pub freelancer: Option<Address>,
    pub payment_token: Address,
    pub total_escrow: i128,
    pub status: JobStatus,
    pub active_milestone: u32,
    pub total_milestones: u32,
}

#[contract]
pub struct JobMarketplace;

#[contractimpl]
impl JobMarketplace {
    pub fn create_job(
        env: Env,
        client: Address,
        payment_token: Address,
        total_escrow: i128,
        total_milestones: u32,
    ) -> u64 {
        client.require_auth();

        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&client, &env.current_contract_address(), &total_escrow);

        let mut count: u64 = env.storage().instance().get(&DataKey::JobCount).unwrap_or(0);
        count += 1;

        let job = Job {
            id: count,
            client,
            freelancer: None,
            payment_token,
            total_escrow,
            status: JobStatus::Open,
            active_milestone: 0,
            total_milestones,
        };

        env.storage().persistent().set(&DataKey::Job(count), &job);
        env.storage().instance().set(&DataKey::JobCount, &count);

        count
    }

    pub fn accept_job(env: Env, freelancer: Address, job_id: u64) {
        freelancer.require_auth();
        let mut job: Job = env.storage().persistent().get(&DataKey::Job(job_id)).unwrap();
        if job.status != JobStatus::Open {
            panic!("Job not open");
        }
        if job.client == freelancer {
            panic!("Client cannot be freelancer");
        }

        job.freelancer = Some(freelancer);
        job.status = JobStatus::InProgress;
        env.storage().persistent().set(&DataKey::Job(job_id), &job);
    }

    pub fn release_milestone(env: Env, client: Address, job_id: u64, amount: i128) {
        client.require_auth();
        let mut job: Job = env.storage().persistent().get(&DataKey::Job(job_id)).unwrap();
        if job.status != JobStatus::InProgress {
            panic!("Job not in progress");
        }
        if job.client != client {
            panic!("Not the client");
        }
        if job.active_milestone >= job.total_milestones {
            panic!("All milestones released");
        }

        let token_client = token::Client::new(&env, &job.payment_token);
        token_client.transfer(&env.current_contract_address(), job.freelancer.as_ref().unwrap(), &amount);

        job.active_milestone += 1;
        if job.active_milestone == job.total_milestones {
            job.status = JobStatus::Completed;
        }

        env.storage().persistent().set(&DataKey::Job(job_id), &job);
    }

    pub fn cancel_job(env: Env, client: Address, job_id: u64) {
        client.require_auth();
        let mut job: Job = env.storage().persistent().get(&DataKey::Job(job_id)).unwrap();
        if job.client != client {
            panic!("Not the client");
        }
        if job.status != JobStatus::Open {
            panic!("Can only cancel open jobs");
        }

        let token_client = token::Client::new(&env, &job.payment_token);
        token_client.transfer(&env.current_contract_address(), &client, &job.total_escrow);

        job.status = JobStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Job(job_id), &job);
    }
}
