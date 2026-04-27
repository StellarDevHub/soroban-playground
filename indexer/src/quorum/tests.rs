#[cfg(test)]
mod tests {
    use crate::db::{Quorum, Vote, Database, Oracle, Event};
    use crate::quorum::{QuorumManager, QuorumState};
    use std::sync::Arc;
    use async_trait::async_trait;
    use anyhow::Result;

    struct MockDb;

    #[async_trait]
    impl Database for MockDb {
        async fn save_event(&self, _: &Event) -> Result<()> { Ok(()) }
        async fn save_events_batch(&self, _: &[Event]) -> Result<()> { Ok(()) }
        async fn get_event(&self, _: &str) -> Result<Option<Event>> { Ok(None) }
        async fn get_events_by_contract(&self, _: &str, _: usize) -> Result<Vec<Event>> { Ok(vec![]) }
        async fn health_check(&self) -> Result<()> { Ok(()) }
        async fn get_recent_events(&self, _: usize) -> Result<Vec<Event>> { Ok(vec![]) }
        async fn save_quorum(&self, _: &Quorum) -> Result<()> { Ok(()) }
        async fn get_quorum(&self, _: &str) -> Result<Option<Quorum>> { Ok(None) }
        async fn update_quorum_state(&self, _: &str, _: &str) -> Result<()> { Ok(()) }
        async fn get_active_quorums(&self) -> Result<Vec<Quorum>> { Ok(vec![]) }
        async fn save_vote(&self, _: &Vote) -> Result<()> { Ok(()) }
        async fn get_votes_for_quorum(&self, _: &str) -> Result<Vec<Vote>> { Ok(vec![]) }
        async fn get_oracle(&self, _: &str) -> Result<Option<Oracle>> { Ok(None) }
        async fn update_oracle_reputation(&self, _: &str, _: i32) -> Result<()> { Ok(()) }
        async fn get_all_oracles(&self) -> Result<Vec<Oracle>> { Ok(vec![]) }
    }

    #[test]
    fn test_calculate_new_state_simple_majority() {
        let db = Arc::new(MockDb);
        let manager = QuorumManager::new(db);
        
        let quorum = Quorum {
            id: "1".into(),
            quorum_type: "bridge".into(),
            state: "collecting".into(),
            strategy: "simple_majority".into(),
            threshold: 2,
            target_id: None,
            created_at: "".into(),
            expires_at: "".into(),
        };

        let votes = vec![
            Vote { id: "1".into(), quorum_id: "1".into(), oracle_id: "o1".into(), choice: "yes".into(), data: None, timestamp: "".into() },
            Vote { id: "2".into(), quorum_id: "1".into(), oracle_id: "o2".into(), choice: "yes".into(), data: None, timestamp: "".into() },
        ];

        // 3 total oracles, 2 voted yes -> simple majority achieved
        let state = manager.calculate_new_state(&quorum, &votes, 3);
        assert_eq!(state, QuorumState::ConsensusAchieved);

        // 5 total oracles, 2 voted yes -> threshold reached but not consensus
        let state = manager.calculate_new_state(&quorum, &votes, 5);
        assert_eq!(state, QuorumState::ThresholdReached);
    }

    #[test]
    fn test_calculate_new_state_unanimous() {
        let db = Arc::new(MockDb);
        let manager = QuorumManager::new(db);
        
        let quorum = Quorum {
            id: "1".into(),
            quorum_type: "bridge".into(),
            state: "collecting".into(),
            strategy: "unanimous".into(),
            threshold: 3,
            target_id: None,
            created_at: "".into(),
            expires_at: "".into(),
        };

        let votes = vec![
            Vote { id: "1".into(), quorum_id: "1".into(), oracle_id: "o1".into(), choice: "yes".into(), data: None, timestamp: "".into() },
            Vote { id: "2".into(), quorum_id: "1".into(), oracle_id: "o2".into(), choice: "no".into(), data: None, timestamp: "".into() },
        ];

        // 3 total oracles, 2 voted (yes, no) -> unanimous failed (since 1 'no' makes it impossible)
        let state = manager.calculate_new_state(&quorum, &votes, 3);
        assert_eq!(state, QuorumState::Failed);
    }
}
