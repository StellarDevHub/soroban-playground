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
    GrantNotFound = 4,
    MilestoneNotFound = 5,
    InvalidMilestoneStatus = 6,
    VotingStillActive = 7,
    VotingEnded = 8,
    AlreadyVoted = 9,
    InsufficientEndowment = 10,
    VoteRejected = 11,
    InvalidParameters = 12,
    NoFundsToRecycle = 13,
    MathOverflow = 14,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MilestoneStatus {
    Pending = 0,
    Attested = 1,
    Approved = 2,
    Rejected = 3,
    Disbursed = 4,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GrantStatus {
    Active = 0,
    Completed = 1,
    Closed = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneProposal {
    pub index: u32,
    pub deliverable_criteria: String,
    pub requested_amount: i128,
    pub status: MilestoneStatus,
    pub yes_votes: i128,
    pub no_votes: i128,
    pub voting_deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantProposal {
    pub id: u64,
    pub team: Address,
    pub title: String,
    pub description: String,
    pub asset: Address,
    pub total_budget: i128,
    pub segregated_balance: i128,
    pub disbursed_amount: i128,
    pub milestone_count: u32,
    pub status: GrantStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    pub admin: Address,
    pub governance_token: Address,
    pub voting_duration: u64, // e.g. 86400 (1 day)
    pub min_quorum: i128,
    pub total_endowment: i128,
}

#[contracttype]
enum DataKey {
    Config,
    GrantCount,
    Grant(u64),
    Milestone(u64, u32),
    Voted(u64, u32, Address),
}

#[contract]
pub struct PublicGoodsBounty;

#[contractimpl]
impl PublicGoodsBounty {
    /// Initialize the public goods endowment fund and DAO matching pool
    pub fn initialize(
        env: Env,
        admin: Address,
        governance_token: Address,
        voting_duration: u64,
        min_quorum: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        if voting_duration == 0 || min_quorum <= 0 {
            return Err(Error::InvalidParameters);
        }

        let config = VaultConfig {
            admin: admin.clone(),
            governance_token,
            voting_duration,
            min_quorum,
            total_endowment: 0,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::GrantCount, &0u64);

        env.events().publish(
            (symbol_short!("init"),),
            (admin, voting_duration, min_quorum),
        );
        Ok(())
    }

    /// Pool foundation matching grants and community micro-contributions
    pub fn contribute_endowment(
        env: Env,
        donor: Address,
        amount: i128,
    ) -> Result<i128, Error> {
        donor.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidParameters);
        }

        let mut config = Self::load_config(&env)?;
        config.total_endowment = config
            .total_endowment
            .checked_add(amount)
            .ok_or(Error::MathOverflow)?;

        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("contrib"),),
            (donor, amount, config.total_endowment),
        );

        Ok(config.total_endowment)
    }

    /// Project team creates milestone proposal; reserves segregated capital from matching pool
    pub fn create_grant(
        env: Env,
        team: Address,
        title: String,
        description: String,
        asset: Address,
        deliverable_criterias: Vec<String>,
        milestone_amounts: Vec<i128>,
    ) -> Result<u64, Error> {
        team.require_auth();

        let milestone_count = deliverable_criterias.len();
        if milestone_count == 0 || milestone_count != milestone_amounts.len() {
            return Err(Error::InvalidParameters);
        }

        let mut total_requested: i128 = 0;
        for i in 0..milestone_count {
            let amt = milestone_amounts.get(i).unwrap();
            if amt <= 0 {
                return Err(Error::InvalidParameters);
            }
            total_requested = total_requested
                .checked_add(amt)
                .ok_or(Error::MathOverflow)?;
        }

        let mut config = Self::load_config(&env)?;
        if config.total_endowment < total_requested {
            return Err(Error::InsufficientEndowment);
        }

        // Segregate capital safely from general endowment pool to this grant
        config.total_endowment = config
            .total_endowment
            .checked_sub(total_requested)
            .ok_or(Error::MathOverflow)?;
        env.storage().instance().set(&DataKey::Config, &config);

        let mut grant_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::GrantCount)
            .unwrap_or(0);
        grant_id = grant_id.checked_add(1).ok_or(Error::MathOverflow)?;

        let grant = GrantProposal {
            id: grant_id,
            team: team.clone(),
            title,
            description,
            asset: asset.clone(),
            total_budget: total_requested,
            segregated_balance: total_requested,
            disbursed_amount: 0,
            milestone_count,
            status: GrantStatus::Active,
        };

        // Initialize segregated milestones
        for idx in 0..milestone_count {
            let criteria = deliverable_criterias.get(idx).unwrap();
            let amount = milestone_amounts.get(idx).unwrap();
            let milestone = MilestoneProposal {
                index: idx,
                deliverable_criteria: criteria,
                requested_amount: amount,
                status: MilestoneStatus::Pending,
                yes_votes: 0,
                no_votes: 0,
                voting_deadline: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Milestone(grant_id, idx), &milestone);
        }

        env.storage().persistent().set(&DataKey::Grant(grant_id), &grant);
        env.storage().instance().set(&DataKey::GrantCount, &grant_id);

        env.events().publish(
            (symbol_short!("grt_crt"),),
            (grant_id, team, total_requested, milestone_count),
        );

        Ok(grant_id)
    }

    /// Project team submits milestone completion attestation, opening DAO vote
    pub fn attest_milestone(
        env: Env,
        team: Address,
        grant_id: u64,
        milestone_index: u32,
    ) -> Result<(), Error> {
        team.require_auth();

        let grant: GrantProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .ok_or(Error::GrantNotFound)?;

        if grant.team != team {
            return Err(Error::Unauthorized);
        }
        if grant.status != GrantStatus::Active {
            return Err(Error::InvalidParameters);
        }

        let mut milestone: MilestoneProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Milestone(grant_id, milestone_index))
            .ok_or(Error::MilestoneNotFound)?;

        if milestone.status != MilestoneStatus::Pending {
            return Err(Error::InvalidMilestoneStatus);
        }

        let config = Self::load_config(&env)?;
        milestone.status = MilestoneStatus::Attested;
        milestone.voting_deadline = env
            .ledger()
            .timestamp()
            .checked_add(config.voting_duration)
            .ok_or(Error::MathOverflow)?;

        env.storage()
            .persistent()
            .set(&DataKey::Milestone(grant_id, milestone_index), &milestone);

        env.events().publish(
            (symbol_short!("attest"),),
            (grant_id, milestone_index, milestone.voting_deadline),
        );

        Ok(())
    }

    /// DAO community token holders cast vote on milestone completion
    pub fn vote_milestone(
        env: Env,
        voter: Address,
        grant_id: u64,
        milestone_index: u32,
        support: bool,
        voting_power: i128,
    ) -> Result<(), Error> {
        voter.require_auth();

        if voting_power <= 0 {
            return Err(Error::InvalidParameters);
        }

        let mut milestone: MilestoneProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Milestone(grant_id, milestone_index))
            .ok_or(Error::MilestoneNotFound)?;

        if milestone.status != MilestoneStatus::Attested {
            return Err(Error::InvalidMilestoneStatus);
        }

        if env.ledger().timestamp() > milestone.voting_deadline {
            return Err(Error::VotingEnded);
        }

        // Prevent double voting
        if env
            .storage()
            .persistent()
            .has(&DataKey::Voted(grant_id, milestone_index, voter.clone()))
        {
            return Err(Error::AlreadyVoted);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Voted(grant_id, milestone_index, voter.clone()), &true);

        if support {
            milestone.yes_votes = milestone
                .yes_votes
                .checked_add(voting_power)
                .ok_or(Error::MathOverflow)?;
        } else {
            milestone.no_votes = milestone
                .no_votes
                .checked_add(voting_power)
                .ok_or(Error::MathOverflow)?;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Milestone(grant_id, milestone_index), &milestone);

        env.events().publish(
            (symbol_short!("vote"),),
            (grant_id, milestone_index, voter, support, voting_power),
        );

        Ok(())
    }

    /// Disburse grant tranche strictly upon verified DAO vote approval
    pub fn disburse_milestone(
        env: Env,
        caller: Address,
        grant_id: u64,
        milestone_index: u32,
    ) -> Result<i128, Error> {
        caller.require_auth();

        let mut grant: GrantProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .ok_or(Error::GrantNotFound)?;

        let mut milestone: MilestoneProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Milestone(grant_id, milestone_index))
            .ok_or(Error::MilestoneNotFound)?;

        if milestone.status != MilestoneStatus::Attested {
            return Err(Error::InvalidMilestoneStatus);
        }

        // Voting duration must have concluded
        if env.ledger().timestamp() < milestone.voting_deadline {
            return Err(Error::VotingStillActive);
        }

        let config = Self::load_config(&env)?;
        let total_votes = milestone
            .yes_votes
            .checked_add(milestone.no_votes)
            .ok_or(Error::MathOverflow)?;

        // Verify quorum and majority approval
        let passed = total_votes >= config.min_quorum && milestone.yes_votes > milestone.no_votes;

        if !passed {
            milestone.status = MilestoneStatus::Rejected;
            env.storage()
                .persistent()
                .set(&DataKey::Milestone(grant_id, milestone_index), &milestone);

            env.events().publish(
                (symbol_short!("rejected"),),
                (grant_id, milestone_index, milestone.yes_votes, milestone.no_votes),
            );
            return Err(Error::VoteRejected);
        }

        milestone.status = MilestoneStatus::Disbursed;
        let payout = milestone.requested_amount;

        grant.segregated_balance = grant
            .segregated_balance
            .checked_sub(payout)
            .ok_or(Error::MathOverflow)?;
        grant.disbursed_amount = grant
            .disbursed_amount
            .checked_add(payout)
            .ok_or(Error::MathOverflow)?;

        if grant.disbursed_amount == grant.total_budget {
            grant.status = GrantStatus::Completed;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Milestone(grant_id, milestone_index), &milestone);
        env.storage().persistent().set(&DataKey::Grant(grant_id), &grant);

        env.events().publish(
            (symbol_short!("disbursed"),),
            (grant_id, milestone_index, grant.team.clone(), payout),
        );

        Ok(payout)
    }

    /// Recycle unused or rejected grant allocations back to the central public goods endowment fund
    pub fn recycle_unused_funds(
        env: Env,
        caller: Address,
        grant_id: u64,
    ) -> Result<i128, Error> {
        caller.require_auth();

        let mut grant: GrantProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .ok_or(Error::GrantNotFound)?;

        let unspent = grant.segregated_balance;
        if unspent <= 0 {
            return Err(Error::NoFundsToRecycle);
        }

        let mut config = Self::load_config(&env)?;
        config.total_endowment = config
            .total_endowment
            .checked_add(unspent)
            .ok_or(Error::MathOverflow)?;

        grant.segregated_balance = 0;
        grant.status = GrantStatus::Closed;

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().persistent().set(&DataKey::Grant(grant_id), &grant);

        env.events().publish(
            (symbol_short!("recycled"),),
            (grant_id, unspent, config.total_endowment),
        );

        Ok(unspent)
    }

    /// Read general endowment fund config
    pub fn get_config(env: Env) -> Result<VaultConfig, Error> {
        Self::load_config(&env)
    }

    /// Read grant proposal
    pub fn get_grant(env: Env, grant_id: u64) -> Result<GrantProposal, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .ok_or(Error::GrantNotFound)
    }

    /// Read milestone proposal
    pub fn get_milestone(
        env: Env,
        grant_id: u64,
        milestone_index: u32,
    ) -> Result<MilestoneProposal, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(grant_id, milestone_index))
            .ok_or(Error::MilestoneNotFound)
    }

    fn load_config(env: &Env) -> Result<VaultConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, String, Vec, Env};

    #[test]
    fn test_initialization_and_endowment_pooling() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let gov_token = Address::generate(&env);
        let donor = Address::generate(&env);

        env.mock_all_auths();
        PublicGoodsBounty::initialize(
            env.clone(),
            admin.clone(),
            gov_token,
            86_400, // 1 day voting window
            100,    // min quorum
        ).unwrap();

        let total = PublicGoodsBounty::contribute_endowment(env.clone(), donor, 50_000).unwrap();
        assert_eq!(total, 50_000);

        let config = PublicGoodsBounty::get_config(env.clone()).unwrap();
        assert_eq!(config.total_endowment, 50_000);
        assert_eq!(config.admin, admin);
    }

    #[test]
    fn test_grant_creation_and_reserve_segregation() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let gov_token = Address::generate(&env);
        let donor = Address::generate(&env);
        let team = Address::generate(&env);
        let asset = Address::generate(&env);

        env.mock_all_auths();
        PublicGoodsBounty::initialize(env.clone(), admin, gov_token, 86_400, 100).unwrap();
        PublicGoodsBounty::contribute_endowment(env.clone(), donor, 20_000).unwrap();

        let mut deliverables = Vec::new(&env);
        deliverables.push_back(String::from_str(&env, "Architecture Spec & Prototype"));
        deliverables.push_back(String::from_str(&env, "Mainnet Deployment & Audit"));

        let mut amounts = Vec::new(&env);
        amounts.push_back(4_000);
        amounts.push_back(6_000);

        let grant_id = PublicGoodsBounty::create_grant(
            env.clone(),
            team.clone(),
            String::from_str(&env, "Open Soroban SDK Tools"),
            String::from_str(&env, "Developer tooling grant"),
            asset,
            deliverables,
            amounts,
        ).unwrap();

        assert_eq!(grant_id, 1);

        // General endowment safely decreased by total requested budget
        let config = PublicGoodsBounty::get_config(env.clone()).unwrap();
        assert_eq!(config.total_endowment, 10_000); // 20,000 - 10,000

        // Grant balance safely segregated
        let grant = PublicGoodsBounty::get_grant(env.clone(), grant_id).unwrap();
        assert_eq!(grant.segregated_balance, 10_000);
        assert_eq!(grant.total_budget, 10_000);
    }

    #[test]
    fn test_attestation_voting_and_milestone_disbursement() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let gov_token = Address::generate(&env);
        let donor = Address::generate(&env);
        let team = Address::generate(&env);
        let asset = Address::generate(&env);
        let voter1 = Address::generate(&env);
        let voter2 = Address::generate(&env);

        env.mock_all_auths();
        PublicGoodsBounty::initialize(env.clone(), admin, gov_token, 1_000, 100).unwrap();
        PublicGoodsBounty::contribute_endowment(env.clone(), donor, 30_000).unwrap();

        let mut deliverables = Vec::new(&env);
        deliverables.push_back(String::from_str(&env, "Deliverable 1"));
        let mut amounts = Vec::new(&env);
        amounts.push_back(5_000);

        let grant_id = PublicGoodsBounty::create_grant(
            env.clone(),
            team.clone(),
            String::from_str(&env, "Public Good Project"),
            String::from_str(&env, "Desc"),
            asset,
            deliverables,
            amounts,
        ).unwrap();

        // Team attests milestone completion
        let start_time = 1_000;
        env.ledger().set_timestamp(start_time);
        PublicGoodsBounty::attest_milestone(env.clone(), team.clone(), grant_id, 0).unwrap();

        // DAO members vote
        PublicGoodsBounty::vote_milestone(env.clone(), voter1, grant_id, 0, true, 80).unwrap();
        PublicGoodsBounty::vote_milestone(env.clone(), voter2, grant_id, 0, true, 40).unwrap();

        // Cannot disburse while voting is still active
        let err = PublicGoodsBounty::disburse_milestone(env.clone(), team.clone(), grant_id, 0);
        assert_eq!(err, Err(Error::VotingStillActive));

        // Advance ledger past deadline
        env.ledger().set_timestamp(start_time + 1_001);

        // Disburse milestone strictly upon verified DAO passage (120 yes votes >= 100 quorum)
        let paid = PublicGoodsBounty::disburse_milestone(env.clone(), team, grant_id, 0).unwrap();
        assert_eq!(paid, 5_000);

        let milestone = PublicGoodsBounty::get_milestone(env.clone(), grant_id, 0).unwrap();
        assert_eq!(milestone.status, MilestoneStatus::Disbursed);

        let grant = PublicGoodsBounty::get_grant(env.clone(), grant_id).unwrap();
        assert_eq!(grant.disbursed_amount, 5_000);
        assert_eq!(grant.segregated_balance, 0);
        assert_eq!(grant.status, GrantStatus::Completed);
    }

    #[test]
    fn test_rejected_milestone_and_capital_recycling() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let gov_token = Address::generate(&env);
        let donor = Address::generate(&env);
        let team = Address::generate(&env);
        let asset = Address::generate(&env);
        let voter_against = Address::generate(&env);

        env.mock_all_auths();
        PublicGoodsBounty::initialize(env.clone(), admin, gov_token, 500, 50).unwrap();
        PublicGoodsBounty::contribute_endowment(env.clone(), donor, 15_000).unwrap();

        let mut deliverables = Vec::new(&env);
        deliverables.push_back(String::from_str(&env, "Deliverable"));
        let mut amounts = Vec::new(&env);
        amounts.push_back(8_000);

        let grant_id = PublicGoodsBounty::create_grant(
            env.clone(),
            team.clone(),
            String::from_str(&env, "Failing Grant"),
            String::from_str(&env, "Desc"),
            asset,
            deliverables,
            amounts,
        ).unwrap();

        let start_time = 1_000;
        env.ledger().set_timestamp(start_time);
        PublicGoodsBounty::attest_milestone(env.clone(), team, grant_id, 0).unwrap();

        // DAO votes against
        PublicGoodsBounty::vote_milestone(env.clone(), voter_against, grant_id, 0, false, 100).unwrap();

        // Advance time
        env.ledger().set_timestamp(start_time + 501);

        // Attempting disbursement fails due to rejection
        let res = PublicGoodsBounty::disburse_milestone(env.clone(), admin.clone(), grant_id, 0);
        assert_eq!(res, Err(Error::VoteRejected));

        // Recycle unused capital back cleanly into the general endowment fund
        let recycled = PublicGoodsBounty::recycle_unused_funds(env.clone(), admin, grant_id).unwrap();
        assert_eq!(recycled, 8_000);

        let config = PublicGoodsBounty::get_config(env.clone()).unwrap();
        assert_eq!(config.total_endowment, 15_000); // 7,000 + 8,000 recycled = 15,000 fully returned

        let grant = PublicGoodsBounty::get_grant(env.clone(), grant_id).unwrap();
        assert_eq!(grant.segregated_balance, 0);
        assert_eq!(grant.status, GrantStatus::Closed);
    }
}
