# Cross-Contract Call Utilities Contract

Utilities for cross-contract calls in Soroban smart contracts.

## Overview

This contract provides five utilities for cross-contract interactions:

1. **CrossContractCaller** - Make contract calls with validation
2. **ContractRegistry** - Register and lookup contract addresses by name
3. **CallValidator** - Validate addresses, function signatures, and return types
4. **BatchCaller** - Execute multiple calls in batch or atomically
5. **FallbackHandler** - Call with automatic fallback on failure

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
cross-contract-utils = { path = "../cross-contract-utils" }
```

## Usage Examples

### CrossContractCaller

```rust
use cross_contract_utils::CrossContractUtilsClient;

let contract = Address::generate(&env);
let args: Vec<Val> = vec![&env];

// Simple call
let result = client.call(&env, &contract, &String::from_str(&env, "function"), &args).unwrap();

// Call with retry (max 3 retries)
let result = client.call_with_retry(&env, &contract, &String::from_str(&env, "function"), &args, &3).unwrap();

// Readonly call
let result = client.call_readonly(&env, &contract, &String::from_str(&env, "view"), &args).unwrap();
```

### ContractRegistry

```rust
use cross_contract_utils::CrossContractUtilsClient;

// Register a contract
client.register(&admin, &String::from_str(&env, "token"), &token_address).unwrap();

// Lookup a contract
let found = client.lookup(&env, &String::from_str(&env, "token")).unwrap();

// Verify interface
let fn_names: Vec<String> = vec![&env, String::from_str(&env, "balance"), String::from_str(&env, "transfer")];
let valid = client.verify_interface(&env, &contract, &fn_names).unwrap();
```

### CallValidator

```rust
use cross_contract_utils::CrossContractUtilsClient;

// Validate address (not zero)
let valid = client.validate_address(&env, &address).unwrap();

// Validate function signature
let valid = client.validate_function_signature(&env, &String::from_str(&env, "transfer"), &3).unwrap();

// Validate return type
let valid = client.validate_return_type_fn(&env, value, &String::from_str(&env, "u64")).unwrap();
```

### BatchCaller

```rust
use cross_contract_utils::CrossContractUtilsClient;

// Batch call - continues on errors
let calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
let results = client.batch_call(&env, &calls).unwrap();

// Atomic batch call - all succeed or all revert
let results = client.atomic_batch_call(&env, &calls).unwrap();
```

### FallbackHandler

```rust
use cross_contract_utils::CrossContractUtilsClient;

// Register fallback for a contract
client.register_fallback(&admin, &primary, &fallback).unwrap();

// Call with fallback - uses fallback if primary fails
let result = client.call_with_fallback(&env, &primary, &fallback, &String::from_str(&env, "function"), &args).unwrap();
```

## Security Model

- All validations return `false` on failure, not panics
- Function names limited to 64 characters
- Arguments limited to 20 items
- Retries limited to 5 attempts
- Batch size limited to 10 calls
- Registry capped at 100 entries
- Name validation: alphanumeric + hyphens only