use async_trait::async_trait;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Event {
    pub id: String,
    pub contract_id: String,
    pub ledger: u32,
    pub ledger_closed_at: String,
    pub event_type: String,
    pub data: String,
}

#[async_trait]
pub trait Database: Send + Sync {
    async fn save_event(&self, event: &Event) -> Result<()>;
    async fn save_events_batch(&self, events: &[Event]) -> Result<()>;
    async fn get_event(&self, id: &str) -> Result<Option<Event>>;
    async fn get_events_by_contract(&self, contract_id: &str, limit: usize) -> Result<Vec<Event>>;
    async fn health_check(&self) -> Result<()>;
}
