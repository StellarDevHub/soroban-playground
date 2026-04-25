#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    ProposalCount,
    Proposal(u64),
    UserVotes(Address, u64), // User, ProposalId -> votes cast
    Whitelisted(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub title: Symbol,
    pub description_hash: Symbol,
    pub end_time: u64,
    pub active: bool,
    pub votes_for: u64,
    pub votes_against: u64,
}

#[contract]
pub struct QuadraticVoting;

#[contractimpl]
impl QuadraticVoting {
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
    }

    pub fn whitelist_user(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != current_admin {
            panic!("Not admin");
        }
        env.storage().persistent().set(&DataKey::Whitelisted(user), &true);
    }

    pub fn create_proposal(
        env: Env,
        admin: Address,
        title: Symbol,
        description_hash: Symbol,
        duration: u64,
    ) -> u64 {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != current_admin {
            panic!("Not admin");
        }

        let mut count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        count += 1;

        let end_time = env.ledger().timestamp() + duration;

        let proposal = Proposal {
            id: count,
            title,
            description_hash,
            end_time,
            active: true,
            votes_for: 0,
            votes_against: 0,
        };

        env.storage().persistent().set(&DataKey::Proposal(count), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &count);

        count
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, credits: u64, is_for: bool) {
        voter.require_auth();

        let is_whitelisted: bool = env.storage().persistent().get(&DataKey::Whitelisted(voter.clone())).unwrap_or(false);
        if !is_whitelisted {
            panic!("Voter not whitelisted");
        }

        let mut proposal: Proposal = env.storage().persistent().get(&DataKey::Proposal(proposal_id)).unwrap();
        if env.ledger().timestamp() >= proposal.end_time {
            panic!("Voting ended");
        }

        // Quadratic cost: 1 vote = 1 credit, 2 votes = 4 credits, 3 votes = 9 credits...
        // votes = sqrt(credits)
        // Here we just accept the number of votes and deduct credits accordingly if there was a token, 
        // but since we are demonstrating the quadratic math, we calculate votes from credits.
        let votes = integer_sqrt(credits);

        if is_for {
            proposal.votes_for += votes;
        } else {
            proposal.votes_against += votes;
        }

        let current_votes: u64 = env.storage().persistent().get(&DataKey::UserVotes(voter.clone(), proposal_id)).unwrap_or(0);
        env.storage().persistent().set(&DataKey::UserVotes(voter.clone(), proposal_id), &(current_votes + votes));
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
    }
}

fn integer_sqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
