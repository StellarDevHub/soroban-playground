use async_graphql::*;
use serde::{Deserialize, Serialize};

/// A Project represents a high-level contract or workspace.
/// It groups together related events and manages their lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// The unique identifier of the project (usually the contract ID).
    pub id: String,
}

#[Object]
impl Project {
    /// Retrieve the unique identifier of the project.
    async fn id(&self) -> &str {
        &self.id
    }

    /// Retrieve a paginated list of events associated with this project.
    /// Uses Relay cursor-based pagination.
    #[graphql(complexity = "5")]
    async fn events(
        &self,
        ctx: &Context<'_>,
        first: Option<i32>,
        after: Option<String>,
    ) -> Result<connection::Connection<String, Event, connection::EmptyFields, connection::EmptyFields>> {
        use crate::graphql::dataloaders::ProjectEventsLoader;
        
        let loader = ctx.data_unchecked::<dataloader::DataLoader<ProjectEventsLoader>>();
        let events = loader.load_one(self.id.clone()).await?.unwrap_or_default();

        let mut connection = connection::Connection::new(false, false);
        let start = match after {
            Some(cursor) => events.iter().position(|e| e.id == cursor).map(|i| i + 1).unwrap_or(0),
            None => 0,
        };
        let limit = first.unwrap_or(50) as usize;
        let end = std::cmp::min(start + limit, events.len());

        let mut edges = Vec::new();
        for event in &events[start..end] {
            edges.push(connection::Edge::new(event.id.clone(), event.clone()));
        }
        
        connection.has_previous_page = start > 0;
        connection.has_next_page = end < events.len();
        connection.edges.extend(edges);

        Ok(connection)
    }
}

/// An Event represents a significant action or state change within a Project.
#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct Event {
    /// The unique identifier of the event.
    pub id: String,
    /// The ID of the contract that emitted this event.
    pub contract_id: String,
    /// The ledger sequence number when this event was recorded.
    pub ledger: u32,
    /// The timestamp when the ledger was closed.
    pub ledger_closed_at: String,
    /// The type of the event (e.g., 'transfer', 'mint').
    pub event_type: String,
    
    /// The raw data payload of the event.
    /// This field is restricted to admins only.
    #[graphql(guard = "crate::graphql::auth::RoleGuard::new(\"admin\")")]
    pub data: String,
}

#[ComplexObject]
impl Event {
    #[graphql(complexity = "2")]
    async fn project(&self) -> Project {
        Project {
            id: self.contract_id.clone(),
        }
    }
}

impl From<crate::db::Event> for Event {
    fn from(db_event: crate::db::Event) -> Self {
        Self {
            id: db_event.id,
            contract_id: db_event.contract_id,
            ledger: db_event.ledger,
            ledger_closed_at: db_event.ledger_closed_at,
            event_type: db_event.event_type,
            data: db_event.data,
        }
    }
}

/// A Quorum represents a multi-party consensus mechanism.
/// It tracks the progress of votes towards a specific threshold.
#[derive(Debug, Clone, SimpleObject)]
pub struct Quorum {
    /// The unique identifier of the quorum.
    pub id: String,
    /// The type of quorum being formed.
    pub quorum_type: String,
    /// The current state of the quorum (e.g., 'collecting', 'failed').
    pub state: String,
    /// The consensus strategy required (e.g., 'super_majority').
    pub strategy: String,
    /// The number of votes required to reach consensus.
    pub threshold: i32,
    /// The target entity this quorum affects.
    pub target_id: Option<String>,
    /// When the quorum was created.
    pub created_at: String,
    /// When the quorum will expire and stop accepting votes.
    pub expires_at: String,
}

impl From<crate::db::Quorum> for Quorum {
    fn from(db_quorum: crate::db::Quorum) -> Self {
        Self {
            id: db_quorum.id,
            quorum_type: db_quorum.quorum_type,
            state: db_quorum.state,
            strategy: db_quorum.strategy,
            threshold: db_quorum.threshold,
            target_id: db_quorum.target_id,
            created_at: db_quorum.created_at,
            expires_at: db_quorum.expires_at,
        }
    }
}
