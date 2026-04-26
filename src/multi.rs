// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use crate::db::trait::{Database, Event};
use crate::db::sqlite::SqliteDatabase;
use crate::db::postgres::PostgresDatabase;
use async_trait::async_trait;

pub struct MultiDatabase {
    pub sqlite: SqliteDatabase,
    pub postgres: PostgresDatabase,
}

#[async_trait]
impl Database for MultiDatabase {
    async fn store_event(&self, event: &Event) -> Result<(), String> {
        // Primary write (SQLite) - Must succeed
        self.sqlite.store_event(event).await?;

        // Secondary write (Postgres) - Fail-safe
        if let Err(e) = self.postgres.store_event(event).await {
            eprintln!("Postgres dual-write failed: {}, but SQLite succeeded.", e);
            // We do NOT return Err here; we keep the app running.
        }

        Ok(())
    }

    async fn get_event(&self, id: i64) -> Result<Option<Event>, String> {
        // Favor SQLite for reads during the migration phase
        self.sqlite.get_event(id).await
    }
}