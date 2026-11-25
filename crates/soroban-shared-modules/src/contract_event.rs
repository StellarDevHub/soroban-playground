//! Canonical contract event envelope for #1946.
//!
//! Every event published through this module shares the same topic
//! shape, so a generic indexer can subscribe to the stream without
//! per-contract decoders:
//!
//! ```text
//! topics  = (EventName: Symbol, Actor: Address, Id: u64)
//! payload = ContractEventEnvelope {
//!     version: u32,     // schema version, currently 1
//!     seq: u64,         // monotonic counter, per-contract
//!     timestamp: u64,   // ledger().timestamp() at emission
//!     name: Symbol,     // same as topic[0], denormalised for consumers
//!     actor: Address,   // same as topic[1], denormalised
//!     id: u64,          // same as topic[2], denormalised
//! }
//! ```
//!
//! This augments the existing `event_schema::StandardEvent` (keeps
//! the legacy wire shape) with a tighter contract that matches the
//! `(Action, Primary Identity, Secondary Identity)` requirement called
//! out in the issue and SEP-0038. Both coexist until individual
//! contracts have been migrated across.

use soroban_sdk::{contracttype, Address, Env, Symbol};

/// Monotonic per-contract event sequence counter. Keyed under a
/// well-known instance-storage symbol so a freshly deployed contract
/// starts at `1`, and consecutive events never share a sequence number
/// within the same contract.
const EVENT_SEQ_KEY: Symbol = soroban_sdk::symbol_short!("EVT_SEQ");

/// Schema version of the envelope payload.
pub const CONTRACT_EVENT_VERSION: u32 = 1;

/// Canonical event envelope payload. Topic-indexed fields are
/// duplicated inside the payload so a consumer that reads events from
/// Horizon without building topic-aware filters still has every
/// relevant field.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractEventEnvelope {
    pub version: u32,
    pub seq: u64,
    pub timestamp: u64,
    pub name: Symbol,
    pub actor: Address,
    pub id: u64,
}

/// Read the next sequence number for `env` and persist the bump.
/// Returns the value assigned to this event (the pre-bump seq + 1).
fn next_seq(env: &Env) -> u64 {
    let storage = env.storage().instance();
    let current: u64 = storage.get(&EVENT_SEQ_KEY).unwrap_or(0);
    let next = current.saturating_add(1);
    storage.set(&EVENT_SEQ_KEY, &next);
    next
}

/// Emit a canonical contract event.
///
/// - `name` is the action identifier (`symbol_short!("mint")`,
///   `Symbol::new(&env, "proposal_executed")`, …). It appears in
///   topic position 0 so indexers can filter by action without
///   decoding the payload.
/// - `actor` is the primary actor whose authorization produced the
///   event (minter, proposer, pauser). Topic position 1.
/// - `id` is the secondary identifier that most closely identifies
///   the subject of the event (token id, proposal id, policy id, …).
///   Topic position 2.
/// - The published payload is a [`ContractEventEnvelope`] with a
///   monotonic per-contract sequence and the ledger timestamp.
///
/// Returns the envelope that was emitted so callers can assert on it
/// in tests.
pub fn emit(env: &Env, name: Symbol, actor: Address, id: u64) -> ContractEventEnvelope {
    let envelope = ContractEventEnvelope {
        version: CONTRACT_EVENT_VERSION,
        seq: next_seq(env),
        timestamp: env.ledger().timestamp(),
        name: name.clone(),
        actor: actor.clone(),
        id,
    };

    env.events().publish(
        (name, actor, id),
        envelope.clone(),
    );

    envelope
}

/// Peek at the sequence counter without incrementing. Primarily for
/// tests; contracts should treat the counter as opaque.
pub fn current_seq(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&EVENT_SEQ_KEY)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, contract, Env};

    #[contract]
    pub struct TestHarness;

    #[test]
    fn envelope_version_matches_constant() {
        let env = Env::default();
        let harness_id = env.register(TestHarness, ());
        env.as_contract(&harness_id, || {
            let actor = Address::generate(&env);
            let envelope = emit(&env, soroban_sdk::symbol_short!("mint"), actor, 42);
            assert_eq!(envelope.version, CONTRACT_EVENT_VERSION);
            assert_eq!(envelope.id, 42);
        });
    }

    #[test]
    fn sequence_counter_is_monotonic_per_contract() {
        let env = Env::default();
        let harness_id = env.register(TestHarness, ());
        env.as_contract(&harness_id, || {
            let actor = Address::generate(&env);
            let a = emit(&env, soroban_sdk::symbol_short!("mint"), actor.clone(), 1);
            let b = emit(&env, soroban_sdk::symbol_short!("burn"), actor.clone(), 2);
            let c = emit(&env, soroban_sdk::symbol_short!("mint"), actor, 3);
            assert_eq!(a.seq, 1);
            assert_eq!(b.seq, 2);
            assert_eq!(c.seq, 3);
            assert_eq!(current_seq(&env), 3);
        });
    }

    #[test]
    fn payload_carries_ledger_timestamp() {
        let env = Env::default();
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
        let harness_id = env.register(TestHarness, ());
        env.as_contract(&harness_id, || {
            let actor = Address::generate(&env);
            let envelope = emit(&env, soroban_sdk::symbol_short!("pause"), actor, 0);
            assert_eq!(envelope.timestamp, 1_700_000_000);
        });
    }

    #[test]
    fn topic_fields_are_denormalised_into_payload() {
        let env = Env::default();
        let harness_id = env.register(TestHarness, ());
        env.as_contract(&harness_id, || {
            let actor = Address::generate(&env);
            let name = soroban_sdk::symbol_short!("transfer");
            let envelope = emit(&env, name.clone(), actor.clone(), 7);
            assert_eq!(envelope.name, name);
            assert_eq!(envelope.actor, actor);
            assert_eq!(envelope.id, 7);
        });
    }
}
