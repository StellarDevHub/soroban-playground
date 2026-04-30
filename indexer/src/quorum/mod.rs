use crate::db::{Database, Quorum, Vote, Oracle};
use anyhow::{Result, anyhow};
use std::sync::Arc;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum QuorumState {
    Collecting,
    ThresholdReached,
    ConsensusAchieved,
    Failed,
}

impl From<&str> for QuorumState {
    fn from(s: &str) -> Self {
        match s {
            "threshold_reached" => QuorumState::ThresholdReached,
            "consensus_achieved" => QuorumState::ConsensusAchieved,
            "failed" => QuorumState::Failed,
            _ => QuorumState::Collecting,
        }
    }
}

impl AsRef<str> for QuorumState {
    fn as_ref(&self) -> &str {
        match self {
            QuorumState::Collecting => "collecting",
            QuorumState::ThresholdReached => "threshold_reached",
            QuorumState::ConsensusAchieved => "consensus_achieved",
            QuorumState::Failed => "failed",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ConsensusStrategy {
    SimpleMajority,
    SuperMajority,
    Unanimous,
}

impl From<&str> for ConsensusStrategy {
    fn from(s: &str) -> Self {
        match s {
            "super_majority" => ConsensusStrategy::SuperMajority,
            "unanimous" => ConsensusStrategy::Unanimous,
            _ => ConsensusStrategy::SimpleMajority,
        }
    }
}

pub struct QuorumManager {
    db: Arc<dyn Database>,
}

impl QuorumManager {
    pub fn new(db: Arc<dyn Database>) -> Self {
        Self { db }
    }

    pub async fn process_vote(&self, quorum_id: &str, oracle_id: &str, choice: &str, data: Option<String>) -> Result<Quorum> {
        let quorum = self.db.get_quorum(quorum_id).await?
            .ok_or_else(|| anyhow!("Quorum not found"))?;

        if QuorumState::from(quorum.state.as_str()) != QuorumState::Collecting && 
           QuorumState::from(quorum.state.as_str()) != QuorumState::ThresholdReached {
            return Err(anyhow!("Quorum is no longer accepting votes"));
        }

        // 1. Save the vote
        let vote = Vote {
            id: format!("{}-{}", quorum_id, oracle_id),
            quorum_id: quorum_id.to_string(),
            oracle_id: oracle_id.to_string(),
            choice: choice.to_string(),
            data,
            timestamp: Utc::now().to_rfc3339(),
        };
        self.db.save_vote(&vote).await?;

        // 2. Fetch all votes to check consensus
        let votes = self.db.get_votes_for_quorum(quorum_id).await?;
        let oracles = self.db.get_all_oracles().await?;
        let active_oracles_count = oracles.iter().filter(|o| o.active).count();

        let new_state = self.calculate_new_state(&quorum, &votes, active_oracles_count);
        
        if new_state.as_ref() != quorum.state {
            self.db.update_quorum_state(quorum_id, new_state.as_ref()).await?;
            
            // If achieved, update oracle reputations
            if new_state == QuorumState::ConsensusAchieved {
                self.update_reputations(quorum_id, &votes, choice).await?;
            }
        }

        let mut updated_quorum = quorum;
        updated_quorum.state = new_state.as_ref().to_string();
        Ok(updated_quorum)
    }

    fn calculate_new_state(&self, quorum: &Quorum, votes: &[Vote], total_oracles: usize) -> QuorumState {
        let vote_count = votes.len();
        let strategy = ConsensusStrategy::from(quorum.strategy.as_str());
        
        // Threshold check (minimum participants)
        if vote_count < quorum.threshold as usize {
            return QuorumState::Collecting;
        }

        // Group votes by choice
        let mut counts = std::collections::HashMap::new();
        for v in votes {
            *counts.entry(&v.choice).or_insert(0) += 1;
        }

        // Check if any choice meets the strategy requirement
        for (&choice, &count) in counts.iter() {
            let reached = match strategy {
                ConsensusStrategy::SimpleMajority => count > total_oracles / 2,
                ConsensusStrategy::SuperMajority => count >= (total_oracles * 2) / 3,
                ConsensusStrategy::Unanimous => count == total_oracles,
            };

            if reached {
                return QuorumState::ConsensusAchieved;
            }
        }

        // If we reached the participant threshold but haven't achieved consensus yet
        if vote_count >= quorum.threshold as usize {
            // Check if it's even possible to reach consensus with remaining oracles
            let remaining = total_oracles - vote_count;
            let can_still_reach = counts.values().any(|&count| {
                match strategy {
                    ConsensusStrategy::SimpleMajority => (count + remaining) > total_oracles / 2,
                    ConsensusStrategy::SuperMajority => (count + remaining) >= (total_oracles * 2) / 3,
                    ConsensusStrategy::Unanimous => (count + remaining) == total_oracles,
                }
            });

            if !can_still_reach {
                return QuorumState::Failed;
            }

            return QuorumState::ThresholdReached;
        }

        QuorumState::Collecting
    }

    async fn update_reputations(&self, _quorum_id: &str, votes: &[Vote], consensus_choice: &str) -> Result<()> {
        for vote in votes {
            let change = if vote.choice == consensus_choice { 10 } else { -20 };
            self.db.update_oracle_reputation(&vote.oracle_id, change).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
