// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use crate::db::trait::{Database, Event};
use async_trait::async_trait;
use sqlx::postgres::PgPool;

pub struct PostgresDatabase {
    pub pool: PgPool,
}

#[async_trait]
impl Database for PostgresDatabase {
    async fn store_event(&self, event: &Event) -> Result<(), String> {
        sqlx::query!(
            "INSERT INTO events (id, contract_id, event_type, ledger, data) VALUES ($1, $2, $3, $4, $5)",
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
            "SELECT id, contract_id, event_type, ledger, data FROM events WHERE id = $1",
            id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())
    }
}