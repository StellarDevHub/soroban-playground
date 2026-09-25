# Governance Contract — Module Responsibilities

This document records the single, clear responsibility of each source file in
`contracts/governance/src/`.  It was created as part of issue #1719 to ensure
that mixed-concern modules are identified and split before the governance
feature grows further.

---

## Module inventory

### `lib.rs` — Public contract interface (business logic only)

**Responsibility:** Expose all public contract entry points and implement the
governance business rules.

Specifically:
- `initialize` — one-time setup, writes initial config via `storage`.
- `mint` — admin-only token issuance (uses `storage`).
- `propose` — create a new governance proposal (validates rules, writes via `storage`).
- `vote` — record a voter's choice on an active proposal.
- `finalise` — evaluate quorum / majority after voting ends.
- `execute` — apply a passed proposal after the timelock.
- `cancel` — abort an active proposal (proposer or admin).
- `schedule_upgrade / execute_upgrade / cancel_upgrade` — two-step WASM upgrade flow.
- `delegate / get_delegate` — voting power delegation management.
- Read-only query helpers (`get_proposal`, `get_proposal_count`, etc.).

**Does NOT:** touch raw storage keys directly; all persistence goes through
`storage.rs` helpers.  Contains no type definitions (those live in `types.rs`).

---

### `storage.rs` — Persistence layer (storage access only)

**Responsibility:** Provide the complete, exclusive interface between contract
logic and Soroban storage (`instance` and `persistent`).

Specifically:
- Admin read/write (`get_admin`, `set_admin`, `is_initialized`).
- Config scalars via the `inst!` macro (`get/set_proposal_count`,
  `get/set_total_supply`, `get/set_quorum_bps`, `get/set_voting_period`,
  `get/set_exec_delay`, `get/set_deposit`).
- Proposal persistence (`get_proposal`, `set_proposal`).
- Token balance persistence (`get_balance`, `set_balance`).
- Delegation chain persistence (`resolve_delegate`, `set_delegate`,
  `remove_delegate`).
- Vote tracking (`has_voted`, `record_vote`).
- Pending upgrade persistence (`get_pending_upgrade`, `set_pending_upgrade`,
  `clear_pending_upgrade`).

**Does NOT:** implement any business rules, validation, or event emission.
All functions are thin wrappers around Soroban storage primitives.

---

### `types.rs` — Data model (type definitions only)

**Responsibility:** Define all shared data types, enumerations, storage keys,
and error codes used by the contract.

Specifically:
- `UpgradePending` struct — pending WASM upgrade state.
- `ProposalStatus` enum — Draft / Active / Passed / Defeated / Executed / Cancelled.
- `VoteChoice` enum — For / Against / Abstain.
- `Proposal` struct — full proposal data model.
- `InstanceKey` enum — keys for instance storage entries.
- `DataKey` enum — keys for persistent storage entries.
- `Error` enum — all contract error codes.

**Does NOT:** implement any logic, perform any storage access, or import `Env`.
Pure data definitions only.

---

### `test.rs` — Unit test suite (tests only)

**Responsibility:** Exercise the public contract interface and verify all
business rules, edge cases, and error conditions.

Specifically:
- Helper functions `setup()` and `mint_and_propose()` to reduce boilerplate.
- Tests grouped by feature: init, mint, propose, vote, finalise, execute,
  cancel, upgrade, delegation, read-only queries.

**Does NOT:** contain any production logic.  All code in this file is
`#[cfg(test)]`-gated and is compiled only during `cargo test`.

---

## Concern separation assessment (issue #1719)

| Concern | File | Mixed? |
|---|---|---|
| Public API / business rules | `lib.rs` | No — clean |
| Storage access | `storage.rs` | No — clean |
| Types, errors, storage keys | `types.rs` | No — clean |
| Test helpers and assertions | `test.rs` | No — clean |

**Result:** No mixed-concern files were found.  The governance module already
has a clear single-responsibility structure.  No file splits are required.

The voting logic and storage/persistence concerns are already separated:
`lib.rs` holds voting rules; `storage.rs` holds all persistence primitives.

---

## Future guidance

As the governance feature grows, maintain these rules:

1. New business rules → `lib.rs`.
2. New storage keys or data structures → `types.rs` (keys) + `storage.rs` (accessors).
3. New data types shared across modules → `types.rs`.
4. Tests for new features → `test.rs`.
5. If `lib.rs` grows beyond ~500 LOC, consider extracting logical sub-modules
   (e.g. `upgrade.rs`, `delegation.rs`) — but keep storage access in `storage.rs`.
