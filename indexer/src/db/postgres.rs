use crate::db::trait_::{Database, Event, Quorum, Vote, Oracle};
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
    // ── Event methods ─────────────────────────────────────────────────────────

    async fn save_event(&self, event: &Event) -> Result<()> {
        sqlx::query(
            "INSERT INTO events (id, contract_id, ledger, ledger_closed_at, event_type, data) 
             VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(&event.id)
        .bind(&event.contract_id)
        .bind(event.ledger as i32)
        .bind(&event.ledger_closed_at)
        .bind(&event.event_type)
        .bind(&event.data)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn save_events_batch(&self, events: &[Event]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for event in events {
            sqlx::query(
                "INSERT INTO events (id, contract_id, ledger, ledger_closed_at, event_type, data) 
                 VALUES ($1, $2, $3, $4, $5, $6)"
            )
            .bind(&event.id)
            .bind(&event.contract_id)
            .bind(event.ledger as i32)
            .bind(&event.ledger_closed_at)
            .bind(&event.event_type)
            .bind(&event.data)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_event(&self, id: &str) -> Result<Option<Event>> {
        let res = sqlx::query_as::<_, Event>(
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data FROM events WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(res)
    }

    async fn get_events_by_contract(&self, contract_id: &str, limit: usize) -> Result<Vec<Event>> {
        let limit = limit as i64;
        let res = sqlx::query_as::<_, Event>(
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data FROM events 
             WHERE contract_id = $1 ORDER BY ledger DESC LIMIT $2"
        )
        .bind(contract_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(res)
    }

    async fn health_check(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    async fn get_recent_events(&self, limit: usize) -> Result<Vec<Event>> {
        let limit = limit as i64;
        let res = sqlx::query_as::<_, Event>(
            "SELECT id, contract_id, ledger, ledger_closed_at, event_type, data \
             FROM events ORDER BY ledger DESC LIMIT $1"
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(res)
    }

    // ── Quorum methods ────────────────────────────────────────────────────────

    async fn save_quorum(&self, quorum: &Quorum) -> Result<()> {
        sqlx::query(
            "INSERT INTO quorums (id, quorum_type, state, strategy, threshold, target_id, created_at, expires_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
        )
        .bind(&quorum.id)
        .bind(&quorum.quorum_type)
        .bind(&quorum.state)
        .bind(&quorum.strategy)
        .bind(quorum.threshold)
        .bind(&quorum.target_id)
        .bind(&quorum.created_at)
        .bind(&quorum.expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_quorum(&self, id: &str) -> Result<Option<Quorum>> {
        let res = sqlx::query_as::<_, Quorum>(
            "SELECT id, quorum_type, state, strategy, threshold, target_id, created_at, expires_at FROM quorums WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(res)
    }

    async fn update_quorum_state(&self, id: &str, state: &str) -> Result<()> {
        sqlx::query("UPDATE quorums SET state = $1 WHERE id = $2")
            .bind(state)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_active_quorums(&self) -> Result<Vec<Quorum>> {
        let res = sqlx::query_as::<_, Quorum>(
            "SELECT id, quorum_type, state, strategy, threshold, target_id, created_at, expires_at 
             FROM quorums WHERE state IN ('collecting', 'threshold_reached')"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(res)
    }

    // ── Vote methods ──────────────────────────────────────────────────────────

    async fn save_vote(&self, vote: &Vote) -> Result<()> {
        sqlx::query(
            "INSERT INTO votes (id, quorum_id, oracle_id, choice, data, timestamp) 
             VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(&vote.id)
        .bind(&vote.quorum_id)
        .bind(&vote.oracle_id)
        .bind(&vote.choice)
        .bind(&vote.data)
        .bind(&vote.timestamp)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_votes_for_quorum(&self, quorum_id: &str) -> Result<Vec<Vote>> {
        let res = sqlx::query_as::<_, Vote>(
            "SELECT id, quorum_id, oracle_id, choice, data, timestamp FROM votes WHERE quorum_id = $1"
        )
        .bind(quorum_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(res)
    }

    // ── Oracle methods ────────────────────────────────────────────────────────

    async fn get_oracle(&self, id: &str) -> Result<Option<Oracle>> {
        let res = sqlx::query_as::<_, Oracle>(
            "SELECT id, name, reputation, active FROM oracles WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(res)
    }

    async fn update_oracle_reputation(&self, id: &str, change: i32) -> Result<()> {
        sqlx::query("UPDATE oracles SET reputation = reputation + $1 WHERE id = $2")
            .bind(change)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_all_oracles(&self) -> Result<Vec<Oracle>> {
        let res = sqlx::query_as::<_, Oracle>(
            "SELECT id, name, reputation, active FROM oracles"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(res)
    }
}

