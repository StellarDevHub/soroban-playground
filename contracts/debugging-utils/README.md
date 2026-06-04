# Debugging Utilities Contract

A collection of debugging utilities for Soroban smart contracts.

## Overview

This contract provides five debugging utilities designed to help developers debug and analyze Soroban smart contract behavior:

1. **DebugLogger** - Log debug, warn, and error messages with sanitization
2. **StateInspector** - Snapshot and compare contract state
3. **ExecutionTracer** - Trace execution steps during function calls
4. **GasProfiler** - Profile function gas costs
5. **ErrorDebugger** - Capture and format error information

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
client.log_debug(&env, &String::from_str(&env, "Processing transfer")).unwrap();

// Log a warning
client.log_warn(&env, &String::from_str(&env, "Low balance warning")).unwrap();

// Log an error
client.log_error(&env, &String::from_str(&env, "Transfer failed")).unwrap();

// Retrieve all logs
let logs = client.get_logs(&env).unwrap();

// Clear logs
client.clear_logs(&env).unwrap();
```

### StateInspector

```rust
use debugging_utils::DebuggingUtilsClient;

let keys = vec![&env, String::from_str(&env, "balance"), String::from_str(&env, "allowance")];

// Snapshot state for multiple keys
let snapshot = client.snapshot_state(&env, &keys).unwrap();

// Compare two snapshots for differences
let diffs = client.compare_states(&env, &snapshot_a, &snapshot_b).unwrap();

// Validate a specific state key
let is_valid = client.validate_state(&env, &String::from_str(&env, "balance"), expected_value).unwrap();
```

### ExecutionTracer

```rust
use debugging_utils::DebuggingUtilsClient;

let trace_id = String::from_str(&env, "transfer_trace");

// Start tracing
client.start_trace(&env, &trace_id).unwrap();

// Record execution steps
client.record_step(&env, &trace_id, &String::from_str(&env, "step_1: validate")).unwrap();
client.record_step(&env, &trace_id, &String::from_str(&env, "step_2: transfer")).unwrap();

// Get the trace (also ends it)
let trace = client.end_trace(&env, &trace_id).unwrap();
```

### GasProfiler

```rust
use debugging_utils::DebuggingUtilsClient;

// Start profiling a function
client.start_profile(&env, &String::from_str(&env, "my_function")).unwrap();

// ... execute the function ...

// End profiling and get cost
let cost = client.end_profile(&env, &String::from_str(&env, "my_function")).unwrap();

// Get full profile report
let report = client.get_profile_report(&env).unwrap();

// Reset all profiles
client.reset_profiles(&env).unwrap();
```

### ErrorDebugger

```rust
use debugging_utils::DebuggingUtilsClient;

// Capture an error with formatting
let formatted = client.capture_error(&env, &123, &String::from_str(&env, "failed to transfer")).unwrap();
// Output: "[ERROR-123] failed to transfer @ ledger:42"

// Get error history (FIFO capped at 100)
let history = client.get_error_history(&env).unwrap();

// Format error without storing
let formatted = client.format_error(&env, &456, &String::from_str(&env, "context")).unwrap();

// Clear error history
client.clear_error_history(&env).unwrap();
```

## Security Notes

### Input Sanitization

**DebugLogger** sanitizes all log inputs:
- Rejects empty strings with `Error::InvalidInput`
- Truncates messages exceeding 512 characters
- Strips null bytes and non-printable characters (keeps only ASCII 32-126)
- If sanitization results in empty string, the operation fails

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

**GasProfiler** measurements:
- Simulated gas cost using `env.budget().cpu_instruction_count()`
- Differences are non-negative (saturating subtraction)