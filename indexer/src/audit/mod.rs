pub mod merkle;

use crate::db::{Database, AuditEntry};
use anyhow::Result;
use std::sync::Arc;
use chrono::Utc;
use tokio::sync::Mutex;

pub struct AuditManager {
    db: Arc<dyn Database>,
    last_hash: Mutex<String>,
}

impl AuditManager {
    pub async fn new(db: Arc<dyn Database>) -> Result<Self> {
        let last_entry = db.get_last_audit_entry().await?;
        let last_hash = last_entry
            .map(|e| e.entry_hash)
            .unwrap_or_else(|| "0".repeat(64));

        Ok(Self {
            db,
            last_hash: Mutex::new(last_hash),
        })
    }

    pub async fn log_event(&self, event_type: &str, actor: &str, payload: &str) -> Result<AuditEntry> {
        let mut last_hash_guard = self.last_hash.lock().await;
        
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = Utc::now().to_rfc3339();
        
        // 1. Calculate the hash of this entry (Hash Chain)
        let entry_hash = merkle::calculate_entry_hash(&last_hash_guard, payload);
        
        // 2. In a real system, we might batch these to calculate a Merkle Root.
        // For simplicity, we'll use the entry_hash as the root for now, or implement batching.
        let merkle_root = entry_hash.clone(); 

        let entry = AuditEntry {
            id,
            event_type: event_type.to_string(),
            actor: actor.to_string(),
            payload: payload.to_string(),
            prev_hash: last_hash_guard.clone(),
            entry_hash: entry_hash.clone(),
            merkle_root,
            timestamp,
        };

        self.db.save_audit_entry(&entry).await?;
        
        // Update the chain head
        *last_hash_guard = entry_hash;

        Ok(entry)
    }

    pub async fn verify_integrity(&self) -> Result<bool> {
        let trail = self.db.get_audit_trail(1000, 0).await?;
        if trail.is_empty() {
            return Ok(true);
        }

        // Verify from oldest to newest (trail is DESC, so reverse it)
        let mut expected_prev_hash = trail.last().map(|e| e.prev_hash.clone()).unwrap_or_default();
        
        for entry in trail.iter().rev() {
            if entry.prev_hash != expected_prev_hash {
                return Ok(false);
            }
            
            let calculated_hash = merkle::calculate_entry_hash(&entry.prev_hash, &entry.payload);
            if entry.entry_hash != calculated_hash {
                return Ok(false);
            }
            
            expected_prev_hash = entry.entry_hash.clone();
        }

        Ok(true)
    }
}
