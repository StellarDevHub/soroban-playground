use async_graphql::*;
use async_graphql::extensions::{Analyzer, ApolloPersistedQueries};
use crate::db::{Database, Event as DbEvent};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;
use std::collections::HashMap;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tokio_stream::StreamExt;

use super::types::{Event, Project, Quorum};

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Retrieve a project by its ID.
    #[graphql(complexity = "1")]
    #[graphql(cache_control(max_age = 60))]
    async fn project(&self, id: String) -> Project {
        Project { id }
    }

    /// Retrieve an event by its ID.
    #[graphql(complexity = "2")]
    #[graphql(cache_control(max_age = 60))]
    async fn event(&self, ctx: &Context<'_>, id: String) -> Result<Option<Event>> {
        use super::dataloaders::EventLoader;
        let loader = ctx.data_unchecked::<dataloader::DataLoader<EventLoader>>();
        loader.load_one(id).await.map_err(|e| e.into())
    }

    /// Retrieve a quorum by its ID.
    #[graphql(complexity = "2")]
    #[graphql(cache_control(max_age = 60))]
    async fn quorum(&self, ctx: &Context<'_>, id: String) -> Result<Option<Quorum>> {
        use super::dataloaders::QuorumLoader;
        let loader = ctx.data_unchecked::<dataloader::DataLoader<QuorumLoader>>();
        loader.load_one(id).await.map_err(|e| e.into())
    }
    
    /// Retrieve the most recent events, limited by the provided parameter.
    #[graphql(complexity = "5")]
    #[graphql(cache_control(max_age = 30))]
    async fn recent_events(
        &self,
        ctx: &Context<'_>,
        limit: Option<usize>,
    ) -> Result<Vec<Event>> {
        let db = ctx.data_unchecked::<Arc<dyn Database>>();
        let limit = limit.unwrap_or(20);
        let events = db.get_recent_events(limit).await?;
        Ok(events.into_iter().map(|e| e.into()).collect())
    }
}

pub struct EmptyMutationRoot;

#[Object]
impl EmptyMutationRoot {
    /// A placeholder mutation. In a real system, mutations would invalidate the cache.
    async fn invalidate_cache(&self) -> bool {
        // Trigger cache invalidation logic here
        true
    }
}

pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    async fn event_created(
        &self,
        ctx: &Context<'_>
    ) -> impl tokio_stream::Stream<Item = Event> {
        let sender = ctx.data_unchecked::<broadcast::Sender<DbEvent>>();
        let receiver = sender.subscribe();
        
        BroadcastStream::new(receiver)
            .filter_map(|msg| match msg {
                Ok(event) => Some(event.into()),
                Err(_) => None,
            })
    }
    
    async fn project_status_changed(
        &self,
        ctx: &Context<'_>,
        contract_id: String
    ) -> impl tokio_stream::Stream<Item = Event> {
        let sender = ctx.data_unchecked::<broadcast::Sender<DbEvent>>();
        let receiver = sender.subscribe();
        
        BroadcastStream::new(receiver)
            .filter_map(move |msg| match msg {
                Ok(event) if event.contract_id == contract_id => Some(event.into()),
                _ => None,
            })
    }
}

pub type AppSchema = Schema<QueryRoot, EmptyMutationRoot, SubscriptionRoot>;

// A simple in-memory cache for Persisted Queries
#[derive(Clone)]
pub struct MemoryCache(Arc<Mutex<HashMap<String, String>>>);

#[async_trait::async_trait]
impl CacheStorage for MemoryCache {
    async fn get(&self, key: String) -> Option<String> {
        self.0.lock().await.get(&key).cloned()
    }
    async fn set(&self, key: String, query: String) {
        self.0.lock().await.insert(key, query);
    }
}

pub fn build_schema(
    db: Arc<dyn Database>,
    broadcaster: broadcast::Sender<DbEvent>
) -> SchemaBuilder<QueryRoot, EmptyMutationRoot, SubscriptionRoot> {
    use super::dataloaders::{EventLoader, ProjectEventsLoader, QuorumLoader};

    let event_loader = dataloader::DataLoader::new(EventLoader { db: db.clone() }, tokio::spawn);
    let project_events_loader = dataloader::DataLoader::new(ProjectEventsLoader { db: db.clone() }, tokio::spawn);
    let quorum_loader = dataloader::DataLoader::new(QuorumLoader { db: db.clone() }, tokio::spawn);

    let persisted_query_cache = MemoryCache(Arc::new(Mutex::new(HashMap::new())));

    Schema::build(QueryRoot, EmptyMutationRoot, SubscriptionRoot)
        .data(db)
        .data(broadcaster)
        .data(event_loader)
        .data(project_events_loader)
        .data(quorum_loader)
        .limit_complexity(100) // limit max query complexity
        .extension(Analyzer) // Returns complexity score in response extensions
        .extension(ApolloPersistedQueries::new(persisted_query_cache)) // Enables persisted queries
}
