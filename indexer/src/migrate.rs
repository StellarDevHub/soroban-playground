use crate::db::{Database, Event};
use anyhow::Result;
use std::sync::Arc;

pub async fn migrate_data(source: Arc<dyn Database>, target: Arc<dyn Database>) -> Result<()> {
    println!("Starting data migration...");
    
    // Simple batch migration logic
    // In a real app we'd paginate through all events
    let contract_ids = vec!["C..."]; // This would be dynamic
    
    for cid in contract_ids {
        let events = source.get_events_by_contract(cid, 1000).await?;
        if !events.is_empty() {
            println!("Migrating {} events for contract {}", events.length(), cid);
            target.save_events_batch(&events).await?;
        }
    }
    
    println!("Migration completed successfully.");
    Ok(())
}
