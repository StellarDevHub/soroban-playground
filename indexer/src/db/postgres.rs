use crate::db::trait_::{Database, Event};
use async_trait::async_trait;
use anyhow::{Result, Context};
use sqlx::postgres::PgPool;

pub struct PostgresDatabase {
    pool: PgPool,
}

impl PostgresDatabase {
    pub async fn new(url: &str) -> Result<Self> {
        let pool = PgPool::connect(url).await?;
        Ok(Self { pool })
    }
}

#[async_trait]
impl Database for PostgresDatabase {
    async fn save_event(&self, event: &Event) -> Result<()> {
        sqlx::query!(
            "INSERT INTO events (id, contract_id, ledger, ledger_closed_at, event_type, data) 
             VALUES ($1, $2, $3, $4, $5, $6)",
            event.id, event.contract_id, event.ledger as i32, event.ledger_closed_at, event.event_type, event.data
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn save_events_batch(&self, events: &[Event]) -> Result<()> {
        // Using COPY or unnest for performance in production, but here simple batch for clarity
        let mut tx = self.pool.begin().await?;
        for event in events {
            sqlx::query!(
                "INSERT INTO events (id, contract_id, ledger, ledger_closed_at, event_type, data) 
                 VALUES ($1, $2, $3, $4, $5, $6)",
                event.id, event.contract_id, event.ledger as i32, event.ledger_closed_at, event.event_type, event.data
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_event(&self, id: &str) -> Result<Option<Event>> {
        // In PG, ledger might be i32/i64, we handle conversion
        let row = sqlx::query!(
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data FROM events WHERE id = $1",
            id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| Event {
            id: r.id,
            contract_id: r.contract_id,
            ledger: r.ledger as u32,
            ledger_closed_at: r.ledger_closed_at,
            event_type: r.event_type,
            data: r.data,
        }))
    }

    async fn get_events_by_contract(&self, contract_id: &str, limit: usize) -> Result<Vec<Event>> {
        let limit = limit as i64;
        let rows = sqlx::query!(
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data FROM events 
             WHERE contract_id = $1 ORDER BY ledger DESC LIMIT $2",
            contract_id, limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| Event {
            id: r.id,
            contract_id: r.contract_id,
            ledger: r.ledger as u32,
            ledger_closed_at: r.ledger_closed_at,
            event_type: r.event_type,
            data: r.data,
        }).collect())
    }

    async fn health_check(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }
}
