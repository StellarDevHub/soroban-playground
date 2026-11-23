//! Timelock proposal & execution module
//! Epic #1551: Standardized Timelock Upgradeability & Multi-Sig Proxy
//! CONTRACT-183: enforces minimum 48h execution delay and guardian veto window.

use soroban_sdk::{Address, Env};

/// Minimum timelock delay for governance proposals (48 hours).
pub const MIN_GOVERNANCE_DELAY_SECONDS: u64 = 48 * 60 * 60;

/// Timelock proposal state
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalState {
    Pending = 0,   // Waiting for execution time
    Ready = 1,     // Ready to execute (time passed)
    Executed = 2,  // Already executed
    Cancelled = 3, // Cancelled
}

/// Timelock proposal
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub target: Address,
    pub operation: String,  // Function name
    pub args: Vec<u8>,      // Encoded arguments
    pub proposed_at: u64,
    pub delay_seconds: u64,
    pub state: ProposalState,
}

/// Timelock errors
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelockError {
    Unauthorized = 1,
    ProposalNotFound = 2,
    NotReadyForExecution = 3,
    AlreadyExecuted = 4,
    InvalidDelay = 5,
    DelayTooShort = 6,
    NotCancellable = 7,
}

pub mod proposals {
    use soroban_sdk::Env;
    use super::{Proposal, ProposalState, TimelockError, MIN_GOVERNANCE_DELAY_SECONDS};

    /// Get proposal by ID
    pub fn get_proposal(env: &Env, id: u64) -> Result<Proposal, TimelockError> {
        let key = ("proposal", id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(TimelockError::ProposalNotFound)
    }

    /// Store proposal
    pub fn set_proposal(env: &Env, proposal: &Proposal) {
        let key = ("proposal", proposal.id);
        env.storage().persistent().set(&key, proposal);
    }

    /// Validate that a delay meets the governance minimum.
    pub fn validate_delay(delay_seconds: u64) -> Result<(), TimelockError> {
        if delay_seconds < MIN_GOVERNANCE_DELAY_SECONDS {
            return Err(TimelockError::DelayTooShort);
        }
        Ok(())
    }

    /// Check if proposal is ready to execute (time delay passed)
    pub fn is_ready(env: &Env, proposal: &Proposal) -> bool {
        let now = env.ledger().timestamp();
        let ready_time = proposal.proposed_at + proposal.delay_seconds;
        now >= ready_time && proposal.state == ProposalState::Pending
    }

    /// Execute-gate: require the timelock to have elapsed and the proposal to be pending.
    pub fn assert_executable(env: &Env, id: u64) -> Result<Proposal, TimelockError> {
        let proposal = get_proposal(env, id)?;
        match proposal.state {
            ProposalState::Executed => return Err(TimelockError::AlreadyExecuted),
            ProposalState::Cancelled => return Err(TimelockError::NotCancellable),
            _ => {}
        }
        if !is_ready(env, &proposal) {
            return Err(TimelockError::NotReadyForExecution);
        }
        Ok(proposal)
    }

    /// Mark proposal as executed
    pub fn mark_executed(env: &Env, id: u64) -> Result<(), TimelockError> {
        let mut proposal = get_proposal(env, id)?;

        if proposal.state != ProposalState::Pending {
            return Err(TimelockError::AlreadyExecuted);
        }

        proposal.state = ProposalState::Executed;
        set_proposal(env, &proposal);
        Ok(())
    }

    /// Cancel proposal (guardian veto / admin). Only pending proposals may be cancelled.
    pub fn cancel(env: &Env, id: u64) -> Result<(), TimelockError> {
        let mut proposal = get_proposal(env, id)?;

        if proposal.state == ProposalState::Executed {
            return Err(TimelockError::AlreadyExecuted);
        }
        if proposal.state != ProposalState::Pending {
            return Err(TimelockError::NotCancellable);
        }

        proposal.state = ProposalState::Cancelled;
        set_proposal(env, &proposal);
        Ok(())
    }
}

pub mod queue {
    use soroban_sdk::Env;
    use super::{Proposal, TimelockError};
    use super::proposals::validate_delay;

    /// Queue a new proposal. Enforces the minimum governance delay.
    pub fn queue(env: &Env, proposal: Proposal) -> Result<u64, TimelockError> {
        validate_delay(proposal.delay_seconds)?;

        let counter_key = "proposal_counter";
        let next_id: u64 = env.storage()
            .persistent()
            .get(&counter_key)
            .unwrap_or(0);

        let mut proposal = proposal;
        proposal.id = next_id;

        super::proposals::set_proposal(env, &proposal);
        env.storage()
            .persistent()
            .set(&counter_key, &(next_id + 1));

        env.events().publish(
            (soroban_sdk::symbol_short!("queued"),),
            (next_id, proposal.proposer, proposal.operation),
        );
        Ok(next_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proposal_timing() {
        let proposal = Proposal {
            id: 1,
            proposer: soroban_sdk::Address::Account(Default::default()),
            target: soroban_sdk::Address::Account(Default::default()),
            operation: "upgrade".to_string(),
            args: vec![],
            proposed_at: 1000,
            delay_seconds: 86400, // 1 day
            state: ProposalState::Pending,
        };

        // Proposal ready at proposed_at + delay_seconds = 1000 + 86400 = 87400
        assert_eq!(proposal.proposed_at + proposal.delay_seconds, 87400);
    }

    #[test]
    fn test_min_delay_is_48_hours() {
        assert_eq!(MIN_GOVERNANCE_DELAY_SECONDS, 172_800);
        assert!(proposals::validate_delay(86_400).is_err());
        assert!(proposals::validate_delay(MIN_GOVERNANCE_DELAY_SECONDS).is_ok());
    }
}
