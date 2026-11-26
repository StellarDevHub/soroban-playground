# Debugging Utilities Contract

A collection of debugging utilities for Soroban smart contracts.

## Overview

This contract provides five debugging utilities designed to help developers debug, profile, and analyze Soroban smart contract behavior:

1. **DebugLogger** - Log debug, warn, and error messages with sanitization and host diagnostic events
2. **StateInspector** - Snapshot, compare, and validate contract state
3. **ExecutionTracer** - Trace multi-step execution paths with structured host diagnostic logging
4. **GasProfiler** - Profile function execution with non-intrusive timers compatible across environments
5. **ErrorDebugger** - Capture, format, and store structured error information with ledger context

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
debugging-utils = { path = "../debugging-utils" }
```

## Usage Examples

### DebugLogger

```rust
use debugging_utils::DebuggingUtilsClient;

// Log a debug message
client.log_debug(&String::from_str(&env, "Processing transfer"));

// Log a warning
client.log_warn(&String::from_str(&env, "Low balance warning"));

// Log an error
client.log_error(&String::from_str(&env, "Transfer failed"));

// Retrieve all logs
let logs = client.get_logs();

// Clear logs
client.clear_logs();
```

### StateInspector

```rust
use debugging_utils::DebuggingUtilsClient;
use soroban_sdk::vec;

let keys = vec![&env, String::from_str(&env, "balance"), String::from_str(&env, "allowance")];

// Snapshot state for multiple keys
let snapshot = client.snapshot_state(&keys);

// Compare two snapshots for differences
let diffs = client.compare_states(&snapshot_a, &snapshot_b);

// Validate a specific state key against expected value
let is_valid = client.validate_state(&String::from_str(&env, "balance"), &expected_value);
```

### ExecutionTracer

```rust
use debugging_utils::DebuggingUtilsClient;

let trace_id = String::from_str(&env, "transfer_trace");

// Start tracing (emits diagnostic log "trace_start")
client.start_trace(&trace_id);

// Record execution steps (emits diagnostic log "trace_step")
client.record_step(&trace_id, &String::from_str(&env, "step_1: validate"));
client.record_step(&trace_id, &String::from_str(&env, "step_2: transfer"));

// End trace and retrieve recorded steps (emits diagnostic log "trace_end")
let trace = client.end_trace(&trace_id);
```

### GasProfiler

```rust
use debugging_utils::DebuggingUtilsClient;

let fn_name = String::from_str(&env, "my_function");

// Start profiling (records execution timer & emits host diagnostic log)
client.start_profile(&fn_name);

// ... execute contract function ...

// End profiling and get elapsed execution time / cost
let elapsed = client.end_profile(&fn_name);

// Get full profile report across all profiled functions
let report = client.get_profile_report();

// Reset all profile counters
client.reset_profiles();
```

### ErrorDebugger

```rust
use debugging_utils::DebuggingUtilsClient;

// Capture an error with formatting and store in history (FIFO capped at 100)
let formatted = client.capture_error(&123, &String::from_str(&env, "failed to transfer"));
// Output: "[ERROR-123] failed to transfer @ ledger:42"

// Get error history
let history = client.get_error_history();

// Format error without storing
let formatted = client.format_error(&456, &String::from_str(&env, "context"));

// Clear error history
client.clear_error_history();
```

## Profiling Instrumentation Patterns for Playground Users

### 1. Non-Intrusive Execution Timers
Soroban smart contracts execute in a deterministic WebAssembly runtime where wall-clock system time is unavailable. This contract uses non-intrusive execution timers based on `env.ledger().timestamp()` and `env.ledger().sequence()`, which:
- Are fully deterministic and compatible across both live testnet/mainnet and local mock/testing environments.
- Introduce zero side-effects to the contract call-stack.
- Provide saturating subtraction to guarantee non-negative elapsed execution units.

### 2. Host Diagnostic Event Logging (`env.logs().add(...)`)
Rather than attempting to intercept low-level panics or unhandled reverts on-chain (which rolls back all contract state), the contract emits structured host diagnostic events using standard Soroban host diagnostic logging interfaces (`env.logs().add(...)`):
- Diagnostic events are recorded in the host's diagnostic stream without mutating on-chain consensus state.
- In playground and local mock tests, inspect all diagnostic events using `env.logs().all()`.
- Structured event topics emitted by this contract include:
  - `"init"`: admin address on initialization
  - `"debug_log"`, `"warn_log"`, `"error_log"`: sanitized log messages
  - `"trace_start"`, `"trace_step"`, `"trace_end"`: execution trace transitions
  - `"profile_start"`, `"profile_end"`: function profiling measurements
  - `"error_captured"`: formatted error codes and context strings

### 3. Recommended Instrumentation Pattern
To profile complex playground contracts without intrusive modifications:
```rust
// 1. Start profile before target logic
client.start_profile(&String::from_str(&env, "mint_nft"));

// 2. Trace execution milestones
client.record_step(&trace_id, &String::from_str(&env, "check_permissions"));
// ... [subroutine 1] ...
client.record_step(&trace_id, &String::from_str(&env, "mint_token"));
// ... [subroutine 2] ...

// 3. End profile and inspect report
let elapsed = client.end_profile(&String::from_str(&env, "mint_nft"));
let report = client.get_profile_report();
```

## Security Notes

### Input Sanitization

**DebugLogger** sanitizes all log inputs:

- Rejects empty strings with `Error::InvalidInput`
- Truncates messages exceeding 512 characters
- Strips null bytes and non-printable characters (keeps only ASCII 32-126)
- If sanitization results in an empty string, the operation fails with `Error::InvalidInput`

**StateInspector** validates keys:

- Keys must be non-empty
- Keys must not exceed 128 characters
- Invalid keys return `Error::InvalidInput`

**ExecutionTracer** capabilities:

- Maximum 200 steps per trace
- Additional steps return `Error::CapExceeded`

**ErrorDebugger** limitations:

- Error history capped at 100 entries (FIFO eviction)
- New entries evict oldest when cap is reached
