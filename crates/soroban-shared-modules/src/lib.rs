#![no_std]

//! Shared standardized modules for Soroban contracts
//!
//! Implements:
//! - Epic #1551: Standardized Timelock Upgradeability & Multi-Sig Proxy
//! - Epic #1552: Universal Emergency Pause & Role-Based Access Control
//! - Epic #1553: Standardized Event Schema & Indexed Topic Architecture
//! - Epic #1554: Complete Multi-Party Authorization Audit

pub mod rbac;
pub mod timelock;
pub mod event_schema;
pub mod auth;

// Re-export commonly used types
pub use rbac::{Role, RBACError, roles, pause};
pub use timelock::{Proposal, ProposalState, TimelockError, proposals, queue};
pub use event_schema::{EventCategory, StandardEvent, EVENT_SCHEMA_VERSION, topics, emitters};
pub use auth::{AuthError, require_auth_for_caller, require_auth_for_target, require_auth_for_transfer, require_auth_for_resource};
