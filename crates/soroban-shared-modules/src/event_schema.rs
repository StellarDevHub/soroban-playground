//! Standardized event schema module
//! Epic #1553: Standardized Event Schema & Indexed Topic Architecture

use soroban_sdk::{Address, Env};

/// Versioned event schema base
pub const EVENT_SCHEMA_VERSION: u32 = 1;

/// Standard event categories
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventCategory {
    StateChange = 0,  // Mint, burn, transfer, etc.
    Authorization = 1, // Role change, permission grant
    Governance = 2,   // Proposal, vote, execution
    Security = 3,     // Pause, unpause, emergency
}

/// Indexed topics for event filtering
pub mod topics {
    /// Standard indexed topics for contract events
    pub const TOPIC_CATEGORY: &str = "category";     // EventCategory
    pub const TOPIC_ACTOR: &str = "actor";           // Address of caller/proposer
    pub const TOPIC_TARGET: &str = "target";         // Address affected by operation
    pub const TOPIC_OPERATION: &str = "operation";   // Operation name (mint, transfer, etc.)
    pub const TOPIC_TIMESTAMP: &str = "timestamp";   // When event occurred
}

/// Standard event schema
pub struct StandardEvent {
    pub version: u32,
    pub category: EventCategory,
    pub actor: Address,
    pub target: Option<Address>,
    pub operation: String,
    pub details: String,
    pub timestamp: u64,
}

impl StandardEvent {
    pub fn new(category: EventCategory, actor: Address, operation: String) -> Self {
        Self {
            version: EVENT_SCHEMA_VERSION,
            category,
            actor,
            target: None,
            operation,
            details: String::new(),
            timestamp: 0,
        }
    }

    pub fn with_target(mut self, target: Address) -> Self {
        self.target = Some(target);
        self
    }

    pub fn with_details(mut self, details: String) -> Self {
        self.details = details;
        self
    }

    pub fn emit(self, env: &Env) {
        let now = env.ledger().timestamp();
        let mut event = self;
        event.timestamp = now;

        // Publish with indexed topics for backend filtering
        env.events().publish(
            (
                soroban_sdk::symbol_short!("event"),
                soroban_sdk::symbol_short!(topics::TOPIC_CATEGORY),
                soroban_sdk::symbol_short!(topics::TOPIC_ACTOR),
                soroban_sdk::symbol_short!(topics::TOPIC_OPERATION),
            ),
            (
                event.version,
                event.category as u32,
                event.actor.clone(),
                event.operation.clone(),
                event.target.clone(),
                event.details.clone(),
                event.timestamp,
            ),
        );
    }
}

/// Event emitter helpers
pub mod emitters {
    use soroban_sdk::{Address, Env, symbol_short};
    use super::{EventCategory, StandardEvent, EVENT_SCHEMA_VERSION};

    /// Emit state change event (mint, burn, transfer)
    pub fn emit_state_change(
        env: &Env,
        actor: Address,
        target: Address,
        operation: &str,
        amount: i128,
    ) {
        let event = StandardEvent::new(EventCategory::StateChange, actor, operation.to_string())
            .with_target(target)
            .with_details(format!("amount={}", amount));
        event.emit(env);
    }

    /// Emit authorization event (role grant, revoke)
    pub fn emit_auth_event(
        env: &Env,
        actor: Address,
        target: Address,
        operation: &str,
    ) {
        let event = StandardEvent::new(EventCategory::Authorization, actor, operation.to_string())
            .with_target(target);
        event.emit(env);
    }

    /// Emit governance event (proposal, execution)
    pub fn emit_governance_event(
        env: &Env,
        actor: Address,
        operation: &str,
        proposal_id: u64,
    ) {
        let event = StandardEvent::new(EventCategory::Governance, actor, operation.to_string())
            .with_details(format!("proposal_id={}", proposal_id));
        event.emit(env);
    }

    /// Emit security event (pause, unpause, emergency)
    pub fn emit_security_event(
        env: &Env,
        actor: Address,
        operation: &str,
    ) {
        let event = StandardEvent::new(EventCategory::Security, actor, operation.to_string());
        event.emit(env);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_schema_version() {
        assert_eq!(EVENT_SCHEMA_VERSION, 1);
    }

    #[test]
    fn test_event_categories() {
        assert_eq!(EventCategory::StateChange as u32, 0);
        assert_eq!(EventCategory::Authorization as u32, 1);
        assert_eq!(EventCategory::Governance as u32, 2);
        assert_eq!(EventCategory::Security as u32, 3);
    }

    #[test]
    fn test_standard_event_construction() {
        let address = soroban_sdk::Address::Account(Default::default());
        let event = StandardEvent::new(EventCategory::StateChange, address.clone(), "mint".to_string())
            .with_target(address.clone())
            .with_details("amount=1000".to_string());

        assert_eq!(event.version, 1);
        assert_eq!(event.category, EventCategory::StateChange);
        assert_eq!(event.operation, "mint");
        assert_eq!(event.details, "amount=1000");
    }
}
