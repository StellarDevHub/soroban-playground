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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Quorum {
    pub id: String,
    pub quorum_type: String,
    pub state: String,
    pub strategy: String,
    pub threshold: i32,
    pub target_id: Option<String>,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Vote {
    pub id: String,
    pub quorum_id: String,
    pub oracle_id: String,
    pub choice: String,
    pub data: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Oracle {
    pub id: String,
    pub name: String,
    pub reputation: i32,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditEntry {
    pub id: String,
    pub event_type: String,
    pub actor: String,
    pub payload: String,
    pub prev_hash: String,
    pub entry_hash: String,
    pub merkle_root: String,
    pub timestamp: String,
}

#[async_trait]
pub trait Database: Send + Sync {
    // Event methods
    async fn save_event(&self, event: &Event) -> Result<()>;
    async fn save_events_batch(&self, events: &[Event]) -> Result<()>;
    async fn get_event(&self, id: &str) -> Result<Option<Event>>;
    async fn get_events_by_contract(&self, contract_id: &str, limit: usize) -> Result<Vec<Event>>;
    async fn health_check(&self) -> Result<()>;
    async fn get_recent_events(&self, limit: usize) -> Result<Vec<Event>>;

    // Quorum methods
    async fn save_quorum(&self, quorum: &Quorum) -> Result<()>;
    async fn get_quorum(&self, id: &str) -> Result<Option<Quorum>>;
    async fn update_quorum_state(&self, id: &str, state: &str) -> Result<()>;
    async fn get_active_quorums(&self) -> Result<Vec<Quorum>>;

    // Vote methods
    async fn save_vote(&self, vote: &Vote) -> Result<()>;
    async fn get_votes_for_quorum(&self, quorum_id: &str) -> Result<Vec<Vote>>;

    // Oracle methods
    async fn get_oracle(&self, id: &str) -> Result<Option<Oracle>>;
    async fn update_oracle_reputation(&self, id: &str, change: i32) -> Result<()>;
    async fn get_all_oracles(&self) -> Result<Vec<Oracle>>;

    // Audit methods
    async fn save_audit_entry(&self, entry: &AuditEntry) -> Result<()>;
    async fn get_audit_trail(&self, limit: usize, offset: usize) -> Result<Vec<AuditEntry>>;
    async fn get_last_audit_entry(&self) -> Result<Option<AuditEntry>>;
    async fn get_audit_entry(&self, id: &str) -> Result<Option<AuditEntry>>;
}


