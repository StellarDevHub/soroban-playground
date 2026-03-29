# Voting Soroban Example

This example implements a small but structured voting contract for Soroban. It
is designed to show how a contract can:

- initialize poll state
- restrict votes to registered options
- update existing votes safely
- expose clear read/query methods

## Contract at a glance

| Area | Purpose |
| --- | --- |
| `initialize(admin, options)` | Creates the poll and stores the allowed options |
| `vote(voter, option)` | Records a first vote or moves an existing vote |
| Read functions | Expose poll configuration and current results |
| Storage helpers | Keep persistence logic separate from contract entrypoints |
| Typed errors | Return clear failures for invalid states and inputs |

## How the contract works

### 1. Initialization

Before anyone can vote, the contract must be initialized:

```text
initialize(admin, [RUST, GO, JS])
```

This stores:

- the admin address
- the list of valid voting options
- a `total_voters` counter starting at `0`

If initialization is attempted twice, the contract returns `AlreadyInitialized`.

### 2. Voting flow

Each voter can have exactly one active vote at a time.

```text
First vote:
voter -> vote(RUST)
count[RUST] += 1
total_voters += 1

Vote update:
voter -> vote(GO)
count[RUST] -= 1
count[GO] += 1
total_voters stays the same
```

This means the contract demonstrates both:

- state creation on first interaction
- state update when a voter changes their choice

### 3. Read/query flow

After votes are recorded, the contract exposes several read helpers:

| Function | What it returns |
| --- | --- |
| `is_initialized()` | Whether the poll has been configured |
| `get_admin()` | The admin address |
| `get_options()` | The list of allowed options |
| `is_option_registered(option)` | Whether one option is valid |
| `get_vote(voter)` | The voter’s current selection |
| `has_voted(voter)` | Whether the voter has voted |
| `get_votes(option)` | The total votes for one option |
| `total_voters()` | The number of unique voters |

## On-chain state model

The contract keeps its state in two layers.

### Instance storage

```text
Admin        -> poll owner / initializer
Options      -> [RUST, GO, JS]
TotalVoters  -> 2
```

### Persistent storage

```text
Vote(Address_1) -> RUST
Vote(Address_2) -> GO

Count(RUST) -> 1
Count(GO)   -> 1
Count(JS)   -> 0
```

This split keeps configuration and aggregated counters easy to reason about.

## Error handling

The contract returns explicit errors for common invalid states:

| Error | Meaning |
| --- | --- |
| `AlreadyInitialized` | The poll was already created |
| `NotInitialized` | A read or vote was attempted before setup |
| `EmptyOptions` | The poll was initialized with no options |
| `DuplicateOption` | The options list contains duplicates |
| `UnknownOption` | A vote targeted an option that was not registered |

## Project structure

| File | Responsibility |
| --- | --- |
| `src/lib.rs` | Public contract API and voting flow |
| `src/storage.rs` | Storage access helpers |
| `src/types.rs` | Errors and storage key definitions |
| `src/test.rs` | Unit tests for initialization and voting behavior |
| `Makefile` | Local build and test commands |

## Local commands

```bash
make test
make build
make fmt
make check
```
