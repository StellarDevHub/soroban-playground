// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use sqlx::{SqlitePool, PgPool};
use sha2::{Sha256, Digest};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sqlite_pool = SqlitePool::connect("sqlite:events.db").await?;
    let pg_pool = PgPool::connect("postgres://user:pass@localhost/db").await?;

    println!("Starting batch migration from SQLite to Postgres...");

    let mut rows = sqlx::query!("SELECT id, contract_id, event_type, ledger, data FROM events")
        .fetch_all(&sqlite_pool)
        .await?;

    for row in rows {
        // Checksum verification
        let mut hasher = Sha256::new();
        hasher.update(format!("{}{}{}", row.id, row.contract_id, row.ledger));
        let checksum = format!("{:x}", hasher.finalize());

        // Insert into Postgres
        sqlx::query!(
            "INSERT INTO events (id, contract_id, event_type, ledger, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
            row.id, row.contract_id, row.event_type, row.ledger, row.data
        )
        .execute(&pg_pool)
        .await?;
        
        println!("Migrated Event ID: {} (Checksum: {})", row.id, &checksum[..8]);
    }

    println!("Migration completed successfully.");
    Ok(())
}