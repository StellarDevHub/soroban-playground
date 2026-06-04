# Property-Based Testing Utilities for Soroban Contracts

A comprehensive set of property-based testing utilities for Soroban smart contracts, including:
- **PropertyTester**: Secure wrapper for property-based contract testing
- **InvariantChecker**: Utility for checking contract invariants during testing
- **BoundaryTester**: Utility for testing contract boundary conditions
- **FuzzGenerator**: Utility for generating fuzz test inputs
- **PropertyValidator**: Utility for validating contract properties and behaviors

## Features

- Soroban-optimized property-based testing patterns
- Comprehensive security validation (property validation, invariant checking)
- Gas-efficient operations
- Comprehensive test coverage
- Documentation and usage examples

## Installation

Add to your Soroban project's Cargo.toml as a dependency.

## Usage

### Initialization

```rust
use property_testing::PropertyTestingUtilsClient;
use soroban_sdk::{Env, Address, testutils::Address as _};

let env = Env::default();
let contract_id = env.register(PropertyTestingUtils, ());
let client = PropertyTestingUtilsClient::new(&env, &contract_id);

let admin = Address::generate(&env);
client.initialize(&admin);
```

### PropertyTester

```rust
client.run_property(
    &String::from_str(&env, "test_commutativity"),
    &100,
    &true,
);
```

### InvariantChecker

```rust
client.check_invariant(
    &String::from_str(&env, "balance_non_negative"),
    &true,
);
```

### BoundaryTester

```rust
let boundaries = client.test_u32_boundaries(&42);
```

### FuzzGenerator

```rust
let fuzz_values = client.generate_u32s(&100, &12345);
```

### PropertyValidator

```rust
client.validate_range(&50, &0, &100, &String::from_str(&env, "in_range"));
```

## Testing

Run tests with:
```bash
cd contracts/property-testing
cargo test
```
