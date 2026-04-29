// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use crate::db::trait::{Database, Event};
use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;

pub struct SqliteDatabase {
    pub pool: SqlitePool,
}

#[async_trait]
impl Database for SqliteDatabase {
    async fn store_event(&self, event: &Event) -> Result<(), String> {
        sqlx::query!(
            "INSERT INTO events (id, contract_id, event_type, ledger, data) VALUES (?, ?, ?, ?, ?)",
            event.id, event.contract_id, event.event_type, event.ledger, event.data
        )
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    async fn get_event(&self, id: i64) -> Result<Option<Event>, String> {
        sqlx::query_as!(
            Event,
            "SELECT id, contract_id, event_type, ledger, data FROM events WHERE id = ?",
            id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())
    }
}