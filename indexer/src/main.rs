mod db;
mod ws;
mod quorum;

use anyhow::Result;
use axum::{routing::get, Router};
use db::{create_db, Database, DbType, Event};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::info;
use ws::{health_handler, ws_handler, post_vote, get_quorum, get_oracles, AppState, BROADCAST_CAPACITY};

// ── DualWriter ────────────────────────────────────────────────────────────────

pub struct DualWriter {
    primary: Arc<dyn Database>,
    secondary: Option<Arc<dyn Database>>,
    /// Broadcast sender — fires after every successful primary write.
    /// `send` is non-blocking and returns `SendError` when there are zero
    /// receivers; we intentionally discard that error.
    broadcaster: broadcast::Sender<Event>,
}

impl DualWriter {
    pub fn new(
        primary: Arc<dyn Database>,
        secondary: Option<Arc<dyn Database>>,
        broadcaster: broadcast::Sender<Event>,
    ) -> Self {
        Self {
            primary,
            secondary,
            broadcaster,
        }
    }

    pub async fn save_event(&self, event: &Event) -> Result<()> {
        self.primary.save_event(event).await?;

        if let Some(ref sec) = self.secondary {
            // Log error but don't fail the primary write.
            if let Err(e) = sec.save_event(event).await {
                tracing::error!("DualWrite secondary write failed: {}", e);
            }
        }

        // Best-effort broadcast. SendError fires when zero clients are connected
        // — that is expected and not an error condition.
        let _ = self.broadcaster.send(event.clone());

        Ok(())
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Structured logging — level controlled by RUST_LOG env var.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    dotenv::dotenv().ok();

    info!("Soroban Indexer starting…");

    // ── Database setup ────────────────────────────────────────────────────────

    let db_type = std::env::var("DB_TYPE").unwrap_or_else(|_| "sqlite".to_string());
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://indexer.db".to_string());

    let primary = create_db(
        if db_type == "postgres" {
            DbType::Postgres
        } else {
            DbType::Sqlite
        },
        &db_url,
    )
    .await?;

    info!("Connected to primary database: {}", db_type);

    let secondary_url = std::env::var("SECONDARY_DATABASE_URL").ok();
    let secondary = if let Some(url) = secondary_url {
        info!("Dual-write mode enabled.");
        Some(create_db(DbType::Postgres, &url).await?)
    } else {
        None
    };

    // ── Broadcast channel ─────────────────────────────────────────────────────

    // The channel is created here and threaded into both DualWriter (sender)
    // and AppState (sender clone for the WS handler to subscribe from).
    let (tx, _) = broadcast::channel::<Event>(BROADCAST_CAPACITY);

    let writer = Arc::new(DualWriter::new(primary.clone(), secondary, tx.clone()));

    // ── WebSocket / HTTP server ───────────────────────────────────────────────

    let ws_port = std::env::var("WS_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .unwrap_or(3001);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], ws_port));
    let app_state = AppState::new(primary.clone(), tx.clone());

    let app = Router::new()
        .route("/ws/events", get(ws_handler))
        .route("/health", get(health_handler))
        .route("/api/quorums/:id", get(get_quorum))
        .route("/api/quorums/:id/vote", axum::routing::post(post_vote))
        .route("/api/oracles", get(get_oracles))
        .layer(CorsLayer::permissive()) // tighten to specific origins in production
        .with_state(app_state);

    info!("WebSocket server listening on ws://0.0.0.0:{}/ws/events", ws_port);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    // Run the HTTP server concurrently with the indexer loop.
    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result {
                tracing::error!("HTTP server error: {}", e);
            }
        }
        result = indexer_loop(writer) => {
            if let Err(e) = result {
                tracing::error!("Indexer loop error: {}", e);
            }
        }
    }

    Ok(())
}

// ── Indexer loop ──────────────────────────────────────────────────────────────

/// Placeholder for the real event-fetching loop.
/// Replace this with Stellar Horizon / Soroban RPC polling logic.
async fn indexer_loop(writer: Arc<DualWriter>) -> Result<()> {
    info!("Indexer loop started (awaiting events from Stellar network)…");

    // In production this loop polls Soroban RPC / Horizon for new contract
    // events, maps them to `Event` structs, and calls writer.save_event().
    // The broadcast fires automatically inside save_event().
    //
    // Example:
    //   let event = fetch_next_event_from_rpc().await?;
    //   writer.save_event(&event).await?;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        info!("Indexer loop heartbeat — waiting for RPC integration");
    }
}
