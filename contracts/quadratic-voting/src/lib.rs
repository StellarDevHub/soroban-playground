#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec, String, BytesN};

// Custom errors for better error handling
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    NotWhitelisted = 2,
    VotingEnded = 3,
    ProposalNotFound = 4,
    ProposalNotActive = 5,
    InvalidCredits = 6,
    ContractPaused = 7,
    AlreadyVoted = 8,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    ProposalCount,
    Proposal(u64),
    UserVotes(Address, u64),
    UserCredits(Address, u64),
    Whitelisted(Address),
    Paused,
    VoteCommitment(Address, u64), // For privacy: commitment hash
    VoteRevealed(Address, u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub title: Symbol,
    pub description_hash: Symbol,
    pub start_time: u64,
    pub end_time: u64,
    pub active: bool,
    pub votes_for: u64,
    pub votes_against: u64,
    pub total_participants: u64,
    pub creator: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCommitment {
    pub commitment_hash: BytesN<32>,
    pub timestamp: u64,
}

#[contract]
pub struct QuadraticVoting;

#[contractimpl]
impl QuadraticVoting {
    // Initialize contract with admin
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);
        
        // Emit initialization event
        env.events().publish(
            (Symbol::new(&env, "init"),),
            (admin.clone(),)
        );
    }

    // Emergency pause mechanism
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        
        env.events().publish(
            (Symbol::new(&env, "paused"),),
            (admin,)
        );
        Ok(())
    }

    // Unpause contract
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        
        env.events().publish(
            (Symbol::new(&env, "unpaused"),),
            (admin,)
        );
        Ok(())
    }

    // Whitelist user with initial credits
    pub fn whitelist_user(env: Env, admin: Address, user: Address, initial_credits: u64) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        
        env.storage().persistent().set(&DataKey::Whitelisted(user.clone()), &true);
        
        env.events().publish(
            (Symbol::new(&env, "user_whitelisted"),),
            (user.clone(), initial_credits)
        );
        Ok(())
    }

    // Remove user from whitelist
    pub fn remove_whitelist(env: Env, admin: Address, user: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        
        env.storage().persistent().remove(&DataKey::Whitelisted(user.clone()));
        
        env.events().publish(
            (Symbol::new(&env, "user_removed"),),
            (user,)
        );
        Ok(())
    }

    // Create proposal with enhanced parameters
    pub fn create_proposal(
        env: Env,
        creator: Address,
        title: Symbol,
        description_hash: Symbol,
        duration: u64,
    ) -> Result<u64, Error> {
        creator.require_auth();
        Self::require_not_paused(&env)?;
        
        let is_whitelisted: bool = env.storage().persistent()
            .get(&DataKey::Whitelisted(creator.clone()))
            .unwrap_or(false);
        
        if !is_whitelisted {
            return Err(Error::NotWhitelisted);
        }

        let mut count: u64 = env.storage().instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        count += 1;

        let start_time = env.ledger().timestamp();
        let end_time = start_time + duration;

        let proposal = Proposal {
            id: count,
            title: title.clone(),
            description_hash: description_hash.clone(),
            start_time,
            end_time,
            active: true,
            votes_for: 0,
            votes_against: 0,
            total_participants: 0,
            creator: creator.clone(),
        };

        env.storage().persistent().set(&DataKey::Proposal(count), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &count);

        // Emit proposal created event
        env.events().publish(
            (Symbol::new(&env, "proposal_created"),),
            (count, creator, title, end_time)
        );

        Ok(count)
    }

    // Commit vote (privacy-preserving phase)
    pub fn commit_vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        commitment_hash: BytesN<32>,
    ) -> Result<(), Error> {
        voter.require_auth();
        Self::require_not_paused(&env)?;
        
        let is_whitelisted: bool = env.storage().persistent()
            .get(&DataKey::Whitelisted(voter.clone()))
            .unwrap_or(false);
        
        if !is_whitelisted {
            return Err(Error::NotWhitelisted);
        }

        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        
        if !proposal.active {
            return Err(Error::ProposalNotActive);
        }
        
        if env.ledger().timestamp() >= proposal.end_time {
            return Err(Error::VotingEnded);
        }

        let commitment = VoteCommitment {
            commitment_hash: commitment_hash.clone(),
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(
            &DataKey::VoteCommitment(voter.clone(), proposal_id),
            &commitment
        );

        env.events().publish(
            (Symbol::new(&env, "vote_committed"),),
            (voter, proposal_id)
        );

        Ok(())
    }

    // Reveal and cast vote (quadratic voting)
    pub fn reveal_vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        credits: u64,
        is_for: bool,
        salt: BytesN<32>,
    ) -> Result<u64, Error> {
        voter.require_auth();
        Self::require_not_paused(&env)?;

        // Verify commitment exists
        let _commitment: VoteCommitment = env.storage().persistent()
            .get(&DataKey::VoteCommitment(voter.clone(), proposal_id))
            .ok_or(Error::NotWhitelisted)?;

        // Check if already revealed
        let already_revealed: bool = env.storage().persistent()
            .get(&DataKey::VoteRevealed(voter.clone(), proposal_id))
            .unwrap_or(false);
        
        if already_revealed {
            return Err(Error::AlreadyVoted);
        }

        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        
        if env.ledger().timestamp() >= proposal.end_time {
            return Err(Error::VotingEnded);
        }

        if credits == 0 {
            return Err(Error::InvalidCredits);
        }

        // Calculate quadratic votes: votes = sqrt(credits)
        let votes = integer_sqrt(credits);

        // Update proposal votes
        if is_for {
            proposal.votes_for += votes;
        } else {
            proposal.votes_against += votes;
        }

        // Check if first time voting on this proposal
        let current_votes: u64 = env.storage().persistent()
            .get(&DataKey::UserVotes(voter.clone(), proposal_id))
            .unwrap_or(0);
        
        if current_votes == 0 {
            proposal.total_participants += 1;
        }

        env.storage().persistent().set(
            &DataKey::UserVotes(voter.clone(), proposal_id),
            &(current_votes + votes)
        );
        env.storage().persistent().set(
            &DataKey::UserCredits(voter.clone(), proposal_id),
            &credits
        );
        env.storage().persistent().set(
            &DataKey::VoteRevealed(voter.clone(), proposal_id),
            &true
        );
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit vote revealed event
        env.events().publish(
            (Symbol::new(&env, "vote_revealed"),),
            (voter, proposal_id, votes, is_for)
        );

        Ok(votes)
    }

    // Finalize proposal
    pub fn finalize_proposal(env: Env, proposal_id: u64) -> Result<bool, Error> {
        Self::require_not_paused(&env)?;
        
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        
        if env.ledger().timestamp() < proposal.end_time {
            return Err(Error::VotingEnded);
        }

        proposal.active = false;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let passed = proposal.votes_for > proposal.votes_against;

        env.events().publish(
            (Symbol::new(&env, "proposal_finalized"),),
            (proposal_id, passed, proposal.votes_for, proposal.votes_against)
        );

        Ok(passed)
    }

    // Get proposal details
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, Error> {
        env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)
    }

    // Get user votes for a proposal
    pub fn get_user_votes(env: Env, user: Address, proposal_id: u64) -> u64 {
        env.storage().persistent()
            .get(&DataKey::UserVotes(user, proposal_id))
            .unwrap_or(0)
    }

    // Get total proposal count
    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage().instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0)
    }

    // Check if user is whitelisted
    pub fn is_whitelisted(env: Env, user: Address) -> bool {
        env.storage().persistent()
            .get(&DataKey::Whitelisted(user))
            .unwrap_or(false)
    }

    // Internal helper functions
    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        
        if caller != &admin {
            return Err(Error::NotAuthorized);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        let paused: bool = env.storage().instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        
        if paused {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }
}

// Optimized integer square root for quadratic calculation
fn integer_sqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    if n < 4 {
        return 1;
    }
    
    let mut x = n;
    let mut y = (x + 1) / 2;
    
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
