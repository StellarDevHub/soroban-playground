use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use crate::db::{Database, Event, Quorum, AuditEntry};

#[derive(Debug, Serialize)]
pub struct QuorumUpdate {
    pub quorum_id: String,
    pub state: String,
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Maximum concurrent WebSocket connections.
const MAX_CONNECTIONS: usize = 200;

/// How many events the broadcast channel can buffer per lagging receiver
/// before it starts dropping messages to that receiver.
pub const BROADCAST_CAPACITY: usize = 1024;

/// Replay this many recent events to each newly-connected client.
const REPLAY_ON_CONNECT: usize = 20;

/// Interval between server-sent ping frames (seconds).
const PING_INTERVAL_SECS: u64 = 30;

// ── Shared application state ──────────────────────────────────────────────────

pub struct AppState {
    pub db: Arc<dyn Database>,
    pub broadcaster: broadcast::Sender<Event>,
    pub connection_count: AtomicUsize,
    pub quorum_manager: Arc<crate::quorum::QuorumManager>,
    pub audit_manager: Arc<crate::audit::AuditManager>,
}

impl AppState {
    pub async fn new(db: Arc<dyn Database>, broadcaster: broadcast::Sender<Event>) -> Result<Arc<Self>> {
        let quorum_manager = Arc::new(crate::quorum::QuorumManager::new(db.clone()));
        let audit_manager = Arc::new(crate::audit::AuditManager::new(db.clone()).await?);
        Ok(Arc::new(Self {
            db,
            broadcaster,
            connection_count: AtomicUsize::new(0),
            quorum_manager,
            audit_manager,
        }))
    }
}

// ── Wire protocol types ───────────────────────────────────────────────────────

/// Outbound message the server sends to WebSocket clients.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage<'a> {
    /// A newly indexed on-chain event.
    Event { payload: &'a Event },
    /// Quorum status update.
    QuorumUpdate { payload: &'a Quorum },
    /// Heartbeat — clients must respond with `{ "type": "pong" }`.
    Ping { ts: u64 },
    /// Sent when the server drops messages due to a lagging receiver.
    Lagged { count: u64 },
    /// Sent when the connection limit is reached.
    Error { message: &'a str },
}

/// Inbound message the client may send to the server.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Pong,
}

// ── Optional query params ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WsParams {
    /// Client-side hint — not enforced server-side; filtering is done in JS.
    #[allow(dead_code)]
    pub contract_id: Option<String>,
    #[allow(dead_code)]
    pub event_type: Option<String>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// GET /ws/events — upgrades the HTTP connection to a WebSocket.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(_params): Query<WsParams>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// GET /health — simple liveness probe that also reports connection count.
pub async fn health_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let connections = state.connection_count.load(Ordering::Relaxed);
    axum::Json(serde_json::json!({ "status": "ok", "connections": connections }))
}

// ── Quorum Handlers ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub oracle_id: String,
    pub choice: String,
    pub data: Option<String>,
}

pub async fn post_vote(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(quorum_id): axum::extract::Path<String>,
    axum::Json(payload): axum::Json<VoteRequest>,
) -> impl IntoResponse {
    match state.quorum_manager.process_vote(&quorum_id, &payload.oracle_id, &payload.choice, payload.data).await {
        Ok(quorum) => {
            // In a real app, we'd also broadcast this quorum update via WS
            // For now, return the updated quorum state
            (axum::http::StatusCode::OK, axum::Json(serde_json::json!({ "success": true, "data": quorum }))).into_response()
        }
        Err(e) => {
            (axum::http::StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response()
        }
    }
}

pub async fn get_quorum(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.db.get_quorum(&id).await {
        Ok(Some(q)) => axum::Json(serde_json::json!({ "success": true, "data": q })).into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, axum::Json(serde_json::json!({ "success": false, "error": "not found" }))).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response(),
    }
}

pub async fn get_oracles(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.db.get_all_oracles().await {
        Ok(oracles) => axum::Json(serde_json::json!({ "success": true, "data": oracles })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response(),
    }
}

// ── Audit Handlers ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AuditLogRequest {
    pub event_type: String,
    pub actor: String,
    pub payload: String,
}

pub async fn post_audit_log(
    State(state): State<Arc<AppState>>,
    axum::Json(payload): axum::Json<AuditLogRequest>,
) -> impl IntoResponse {
    match state.audit_manager.log_event(&payload.event_type, &payload.actor, &payload.payload).await {
        Ok(entry) => axum::Json(serde_json::json!({ "success": true, "data": entry })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response(),
    }
}

pub async fn get_audit_trail(
    State(state): State<Arc<AppState>>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params.get("limit").and_then(|l| l.parse::<usize>().ok()).unwrap_or(50);
    let offset = params.get("offset").and_then(|o| o.parse::<usize>().ok()).unwrap_or(0);

    match state.db.get_audit_trail(limit, offset).await {
        Ok(trail) => axum::Json(serde_json::json!({ "success": true, "data": trail })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response(),
    }
}

pub async fn verify_audit(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.audit_manager.verify_integrity().await {
        Ok(is_valid) => axum::Json(serde_json::json!({ "success": true, "is_valid": is_valid })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({ "success": false, "error": e.to_string() }))).into_response(),
    }
}

// ── Socket driver ─────────────────────────────────────────────────────────────

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    // Enforce connection limit.
    let prev = state.connection_count.fetch_add(1, Ordering::Relaxed);
    if prev >= MAX_CONNECTIONS {
        state.connection_count.fetch_sub(1, Ordering::Relaxed);
        let msg = serde_json::to_string(&ServerMessage::Error {
            message: "max connections reached",
        })
        .unwrap_or_default();
        let _ = socket.send(Message::Text(msg.into())).await;
        let _ = socket.close().await;
        return;
    }

    debug!("WebSocket client connected (total: {})", prev + 1);

    // Subscribe to the broadcast channel *before* replaying history so we
    // don't miss events that arrive between the replay query and the subscribe.
    let mut rx = state.broadcaster.subscribe();

    // Replay recent events on connect so the client has immediate context.
    match state.db.get_recent_events(REPLAY_ON_CONNECT).await {
        Ok(recent) => {
            for event in recent.iter().rev() {
                let msg = serde_json::to_string(&ServerMessage::Event { payload: event })
                    .unwrap_or_default();
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    cleanup(&state);
                    return;
                }
            }
        }
        Err(e) => {
            warn!("Failed to replay recent events: {}", e);
        }
    }

    // Spawn ping task.
    let (ping_tx, mut ping_rx) = tokio::sync::mpsc::channel::<()>(1);
    let ping_interval = tokio::time::Duration::from_secs(PING_INTERVAL_SECS);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(ping_interval).await;
            if ping_tx.send(()).await.is_err() {
                break;
            }
        }
    });

    // Main event loop.
    loop {
        tokio::select! {
            // Inbound frame from client (pong, close, or unexpected text).
            client_msg = socket.recv() => {
                match client_msg {
                    Some(Ok(Message::Text(text))) => {
                        // We only expect pong frames; ignore anything else silently.
                        if let Ok(ClientMessage::Pong) = serde_json::from_str(&text) {
                            debug!("Received pong");
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        debug!("WebSocket client disconnected");
                        break;
                    }
                    Some(Err(e)) => {
                        warn!("WebSocket receive error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }

            // Outbound: new event from the broadcast channel.
            broadcast_result = rx.recv() => {
                match broadcast_result {
                    Ok(event) => {
                        let msg = serde_json::to_string(&ServerMessage::Event { payload: &event })
                            .unwrap_or_default();
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(count)) => {
                        warn!("Broadcast receiver lagged by {} messages", count);
                        let msg = serde_json::to_string(&ServerMessage::Lagged { count })
                            .unwrap_or_default();
                        let _ = socket.send(Message::Text(msg.into())).await;
                        // Stay connected — the client can request a REST sync.
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Sender dropped — server is shutting down.
                        break;
                    }
                }
            }

            // Outbound: heartbeat ping.
            Some(_) = ping_rx.recv() => {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let msg = serde_json::to_string(&ServerMessage::Ping { ts })
                    .unwrap_or_default();
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    cleanup(&state);
}

fn cleanup(state: &AppState) {
    let remaining = state.connection_count.fetch_sub(1, Ordering::Relaxed) - 1;
    debug!("WebSocket connection closed (remaining: {})", remaining);
}
