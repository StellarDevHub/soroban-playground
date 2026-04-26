use crate::db::trait_::{Database, Event};
use async_trait::async_trait;
use anyhow::{Result, Context};
use sqlx::sqlite::SqlitePool;

pub struct SqliteDatabase {
    pool: SqlitePool,
}

impl SqliteDatabase {
    pub async fn new(url: &str) -> Result<Self> {
        let pool = SqlitePool::connect(url).await?;
        Ok(Self { pool })
    }
}

#[async_trait]
impl Database for SqliteDatabase {
    async fn save_event(&self, event: &Event) -> Result<()> {
        sqlx::query!(
            "INSERT INTO events (id, contract_id, ledger, ledger_closed_at, event_type, data) 
             VALUES (?, ?, ?, ?, ?, ?)",
            event.id, event.contract_id, event.ledger, event.ledger_closed_at, event.event_type, event.data
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn save_events_batch(&self, events: &[Event]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for event in events {
            sqlx::query!(
                "INSERT INTO events (id, contract_id, ledger, ledger_closed_at, event_type, data) 
                 VALUES (?, ?, ?, ?, ?, ?)",
                event.id, event.contract_id, event.ledger, event.ledger_closed_at, event.event_type, event.data
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_event(&self, id: &str) -> Result<Option<Event>> {
        let res = sqlx::query_as!(
            Event,
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data FROM events WHERE id = ?",
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(res)
    }

    async fn get_events_by_contract(&self, contract_id: &str, limit: usize) -> Result<Vec<Event>> {
        let limit = limit as i64;
        let res = sqlx::query_as!(
            Event,
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data FROM events 
             WHERE contract_id = ? ORDER BY ledger DESC LIMIT ?",
            contract_id, limit
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(res)
    }

    async fn health_check(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }
}
