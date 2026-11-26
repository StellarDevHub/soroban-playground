# Canonical Contract Event Envelope

Reference specification for [CONTRACT-176](https://github.com/StellarDevHub/soroban-playground/issues/1946).

## Why

Event publication across playground contracts uses ad-hoc tuple
signatures. Indexers and RPC consumers can't build generic
subscriptions or audit trails because topic shape and payload schema
differ per contract. The envelope defined here gives every emitted
event the same topic signature and the same minimal payload, so one
subscription filter and one decoder work everywhere.

## Topic shape

```text
topics = (EventName: Symbol, Actor: Address, Id: u64)
```

| Position | Field       | Purpose |
|----------|-------------|---------|
| 0        | `name`      | Action identifier. `symbol_short!` for short actions, `Symbol::new` for longer ones. |
| 1        | `actor`     | Primary identity: the address whose authorization produced the event (minter, proposer, pauser). |
| 2        | `id`        | Secondary identity: the `u64` that most tightly identifies the subject (token id, proposal id, policy id, …). Use `0` when the event has no natural id. |

Topic positions are **always** `(Symbol, Address, u64)` so indexers can
build type-stable filters without peeking at the payload.

## Payload shape

The published payload is a single `#[contracttype]` struct,
[`ContractEventEnvelope`](../crates/soroban-shared-modules/src/contract_event.rs):

```rust
pub struct ContractEventEnvelope {
    pub version: u32,     // schema version, currently 1
    pub seq: u64,         // monotonic per-contract counter
    pub timestamp: u64,   // env.ledger().timestamp() at emission
    pub name: Symbol,     // mirrors topic[0] for consumers that only read payload
    pub actor: Address,   // mirrors topic[1]
    pub id: u64,          // mirrors topic[2]
}
```

Why the topic fields are duplicated into the payload: some consumers
(dashboards reading through Horizon's REST endpoint, archive indexers
that do not keep topic indexes) read only payloads. Having the full
record in one place removes a class of "I saw the topic but not the
name" bugs.

## Emission

Contracts should call the shared helper rather than open-coding
`env.events().publish(...)`:

```rust
use soroban_shared_modules::emit_contract_event;

emit_contract_event(
    &env,
    soroban_sdk::symbol_short!("mint"),
    minter,
    token_id,
);
```

The helper reads and increments a per-contract instance-storage
counter under the symbol `EVT_SEQ`, so every event from a single
contract has a strictly increasing `seq`. Across contracts seq numbers
are **not** globally ordered; use `(contract_id, seq)` as the primary
key in an indexer.

## Versioning

- `CONTRACT_EVENT_VERSION` starts at `1`.
- The constant is bumped **only** when the payload layout changes in a
  way that a `v1` consumer cannot decode. Adding a new optional
  payload field does not qualify (soroban-sdk's `#[contracttype]`
  tolerates trailing fields the reader does not know about if read as
  `Val`; readers that want the new field upgrade).
- Topic shape never changes under this spec. A hypothetical wider
  topic would ship as a separate envelope type.

## SEP-0038 alignment

- Action + primary identity + secondary identity ordering matches
  SEP-0038 section 3.
- The payload envelope is a superset of the SEP-0038 "event header"
  — `seq` and `timestamp` are additional; `version` is the SEP
  `schema_version` field under a different name.

## Migration plan

1. **This PR.** Add the envelope, helper and unit tests to
   `soroban-shared-modules`. Existing `event_schema::StandardEvent`
   stays as-is so no in-flight callers break.
2. **Per-contract follow-ups.** For each contract that publishes
   ad-hoc events (`crop-insurance` is the example cited in the
   issue), replace its `env.events().publish(...)` sites with
   `emit_contract_event` and update its snapshot tests. One PR per
   contract so snapshot diffs stay reviewable.
3. **Retire `StandardEvent`.** Once every caller is on
   `ContractEventEnvelope`, mark `event_schema::StandardEvent` as
   `#[deprecated]` and remove it in the next breaking release.

## Tests

`contract_event::tests` covers:

- `envelope_version_matches_constant`
- `sequence_counter_is_monotonic_per_contract`
- `payload_carries_ledger_timestamp`
- `topic_fields_are_denormalised_into_payload`

Per-contract snapshot tests land with each migration PR so each
contract's new event topics and payloads are review-visible.
