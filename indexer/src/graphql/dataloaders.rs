use async_graphql::{dataloader::Loader, async_trait};
use std::sync::Arc;
use std::collections::HashMap;
use anyhow::Result;
use crate::db::Database;
use super::types::{Event, Quorum};

pub struct ProjectEventsLoader {
    pub db: Arc<dyn Database>,
}

#[async_trait::async_trait]
impl Loader<String> for ProjectEventsLoader {
    type Value = Vec<Event>;
    type Error = Arc<anyhow::Error>;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, Self::Value>, Self::Error> {
        // N+1 mitigation: We fetch 50 events per contract for the requested contracts.
        // If there was a true batch SQL query, we would use it here.
        // For now, we simulate batch loading by making parallel DB calls or sequential ones.
        // Ideally the Database trait should have a get_events_for_contracts(keys) method.
        
        let mut map = HashMap::new();
        for contract_id in keys {
            match self.db.get_events_by_contract(contract_id, 50).await {
                Ok(events) => {
                    let gql_events = events.into_iter().map(|e| e.into()).collect();
                    map.insert(contract_id.clone(), gql_events);
                }
                Err(e) => {
                    // Just log and ignore for now, or fail
                    tracing::error!("Failed to fetch events for contract {}: {}", contract_id, e);
                }
            }
        }
        Ok(map)
    }
}

pub struct QuorumLoader {
    pub db: Arc<dyn Database>,
}

#[async_trait::async_trait]
impl Loader<String> for QuorumLoader {
    type Value = Quorum;
    type Error = Arc<anyhow::Error>;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, Self::Value>, Self::Error> {
        let mut map = HashMap::new();
        for id in keys {
            if let Ok(Some(quorum)) = self.db.get_quorum(id).await {
                map.insert(id.clone(), quorum.into());
            }
        }
        Ok(map)
    }
}

pub struct EventLoader {
    pub db: Arc<dyn Database>,
}

#[async_trait::async_trait]
impl Loader<String> for EventLoader {
    type Value = Event;
    type Error = Arc<anyhow::Error>;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, Self::Value>, Self::Error> {
        let mut map = HashMap::new();
        for id in keys {
            if let Ok(Some(event)) = self.db.get_event(id).await {
                map.insert(id.clone(), event.into());
            }
        }
        Ok(map)
    }
}
