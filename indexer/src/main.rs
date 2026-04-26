mod db;

use anyhow::Result;
use db::{create_db, DbType, Database, Event};
use std::sync::Arc;
use tokio;

pub struct DualWriter {
    primary: Arc<dyn Database>,
    secondary: Option<Arc<dyn Database>>,
}

impl DualWriter {
    pub fn new(primary: Arc<dyn Database>, secondary: Option<Arc<dyn Database>>) -> Self {
        Self { primary, secondary }
    }

    pub async fn save_event(&self, event: &Event) -> Result<()> {
        self.primary.save_event(event).await?;
        if let Some(ref sec) = self.secondary {
            // Log error but don't fail primary write
            if let Err(e) = sec.save_event(event).await {
                eprintln!("[DualWrite Error] Failed to write to secondary: {}", e);
            }
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Basic implementation of the migration tool and indexer
    println!("Soroban Indexer starting...");
    
    // In a real app, these would come from env vars
    let db_type = std::env::var("DB_TYPE").unwrap_or_else(|_| "sqlite".to_string());
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://indexer.db".to_string());
    
    let primary = create_db(
        if db_type == "postgres" { DbType::Postgres } else { DbType::Sqlite },
        &db_url
    ).await?;
    
    println!("Connected to primary database: {}", db_type);
    
    // Check for dual-write mode
    let secondary_url = std::env::var("SECONDARY_DATABASE_URL").ok();
    let secondary = if let Some(url) = secondary_url {
        println!("Dual-write mode enabled. Secondary: {}", url);
        Some(create_db(DbType::Postgres, &url).await?)
    } else {
        None
    };
    
    let _writer = DualWriter::new(primary, secondary);
    
    // ... rest of the indexer logic ...
    
    Ok(())
}
