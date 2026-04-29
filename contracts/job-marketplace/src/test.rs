// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Comprehensive test suite for the Job Marketplace contract

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as AddressTestUtils, Events, Ledger},
    Address, Env, IntoVal, Symbol, String, Vec,
};

fn create_test_token(env: &Env) -> Address {
    // Create a mock token contract for testing
    Address::generate(env)
}

fn create_test_account(env: &Env) -> Address {
    Address::generate(env)
}

#[test]
fn test_initialize_contract() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);

    // Initialize should succeed
    client.initialize(&admin);

    // Verify admin is set
    assert_eq!(client.get_admin(), Some(admin.clone()));

    // Double initialization should fail
    let result = std::panic::catch_unwind(|| {
        client.initialize(&admin);
    });
    assert!(result.is_err());
}

#[test]
fn test_create_job_success() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    // Create milestones
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Design phase"),
        amount: 500_000_000, // 500 tokens (assuming 7 decimals)
        is_released: false,
    });
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Development phase"),
        amount: 500_000_000,
        is_released: false,
    });

    // Create required skills
    let mut skills = Vec::new(&env);
    skills.push_back(Symbol::new(&env, "RUST"));
    skills.push_back(Symbol::new(&env, "SOROBAN"));

    // Create job
    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Smart Contract Developer"),
        &String::from_str(&env, "Build a Soroban contract"),
        &token,
        &1_000_000_000, // 1000 tokens total
        &milestones,
        &skills,
    );

    assert_eq!(job_id, 1);

    // Verify job was created
    let job = client.get_job(&job_id);
    assert_eq!(job.client, job_client);
    assert_eq!(job.status, JobStatus::Open);
    assert_eq!(job.total_escrow, 1_000_000_000);
}

#[test]
fn test_create_job_invalid_escrow() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task 1"),
        amount: 100_000_000,
        is_released: false,
    });

    let mut skills = Vec::new(&env);
    skills.push_back(Symbol::new(&env, "RUST"));

    // Should fail with zero escrow
    let result = std::panic::catch_unwind(|| {
        client.create_job(
            &job_client,
            &String::from_str(&env, "Job"),
            &String::from_str(&env, "Description"),
            &token,
            &0, // Invalid: zero escrow
            &milestones,
            &skills,
        );
    });
    assert!(result.is_err());
}

#[test]
fn test_create_job_milestone_mismatch() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task 1"),
        amount: 300_000_000, // Doesn't match total_escrow
        is_released: false,
    });

    let mut skills = Vec::new(&env);
    skills.push_back(Symbol::new(&env, "RUST"));

    // Should fail because milestone sum != total_escrow
    let result = std::panic::catch_unwind(|| {
        client.create_job(
            &job_client,
            &String::from_str(&env, "Job"),
            &String::from_str(&env, "Description"),
            &token,
            &500_000_000, // Different from milestone sum
            &milestones,
            &skills,
        );
    });
    assert!(result.is_err());
}

#[test]
fn test_accept_job_success() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let freelancer = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    // Create a job without skill requirements for simplicity
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task"),
        amount: 1_000_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env); // No required skills

    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );

    // Accept job
    client.accept_job(&freelancer, &job_id);

    // Verify job status changed
    let job = client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::InProgress);
    assert_eq!(job.freelancer, Some(freelancer.clone()));
}

#[test]
fn test_accept_job_not_open() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let freelancer1 = create_test_account(&env);
    let freelancer2 = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task"),
        amount: 1_000_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env);

    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );

    // First freelancer accepts
    client.accept_job(&freelancer1, &job_id);

    // Second freelancer should fail
    let result = std::panic::catch_unwind(|| {
        client.accept_job(&freelancer2, &job_id);
    });
    assert!(result.is_err());
}

#[test]
fn test_release_milestone_success() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let freelancer = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Milestone 1"),
        amount: 500_000_000,
        is_released: false,
    });
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Milestone 2"),
        amount: 500_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env);

    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );

    client.accept_job(&freelancer, &job_id);

    // Release first milestone
    client.release_milestone(&job_client, &job_id, &0);

    let job = client.get_job(&job_id);
    assert_eq!(job.released_amount, 500_000_000);
    assert!(job.milestones.get(0).unwrap().is_released);
}

#[test]
fn test_cancel_job_success() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task"),
        amount: 1_000_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env);

    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );

    // Cancel job
    client.cancel_job(&job_client, &job_id);

    let job = client.get_job(&job_id);
    assert_eq!(job.status, JobStatus::Cancelled);
}

#[test]
fn test_pause_and_unpause() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let other_user = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    // Pause contract
    client.pause(&admin);
    assert!(client.is_contract_paused());

    // Creating job while paused should fail
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task"),
        amount: 1_000_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env);

    let result = std::panic::catch_unwind(|| {
        client.create_job(
            &other_user,
            &String::from_str(&env, "Job"),
            &String::from_str(&env, "Description"),
            &token,
            &1_000_000_000,
            &milestones,
            &skills,
        );
    });
    assert!(result.is_err());

    // Unpause
    client.unpause(&admin);
    assert!(!client.is_contract_paused());

    // Now creating job should succeed
    let job_id = client.create_job(
        &other_user,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );
    assert_eq!(job_id, 1);
}

#[test]
fn test_skill_verification() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let user = create_test_account(&env);

    client.initialize(&admin);

    // Verify skill
    client.verify_skill(
        &admin,
        &user,
        &Symbol::new(&env, "RUST"),
        &5,
    );

    // Get user skills
    let skills = client.get_user_skills(&user);
    assert_eq!(skills.len(), 1);
}

#[test]
fn test_dispute_resolution() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let freelancer = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task"),
        amount: 1_000_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env);

    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );

    client.accept_job(&freelancer, &job_id);

    // Raise dispute
    let dispute_id = client.raise_dispute(
        &job_client,
        &job_id,
        &String::from_str(&env, "Work not satisfactory"),
    );

    assert_eq!(dispute_id, 1);

    // Resolve dispute
    client.resolve_dispute(&admin, &dispute_id, &500_000_000, &500_000_000);

    let dispute = client.get_dispute(&dispute_id);
    assert!(dispute.resolved_at.is_some());
}

#[test]
fn test_event_emissions() {
    let env = Env::default();
    let contract_id = env.register(JobMarketplace, ());
    let client = JobMarketplaceClient::new(&env, &contract_id);
    let admin = create_test_account(&env);
    let job_client = create_test_account(&env);
    let token = create_test_token(&env);

    client.initialize(&admin);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        description: String::from_str(&env, "Task"),
        amount: 1_000_000_000,
        is_released: false,
    });

    let skills = Vec::new(&env);

    // Create job and verify event
    let job_id = client.create_job(
        &job_client,
        &String::from_str(&env, "Job"),
        &String::from_str(&env, "Description"),
        &token,
        &1_000_000_000,
        &milestones,
        &skills,
    );

    // Check events were emitted
    let events = env.events().all();
    assert!(!events.is_empty());
}
