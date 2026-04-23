# Counter Soroban Example

This is a simple counter contract example for Stellar Soroban. It demonstrates how to store and update a state value (an integer) in contract storage.

## Functions

- `increment()`: Increments the internal counter by 1 and returns the new value.
- `get_count()`: Returns the current value of the counter.

## How it works

The contract uses `env.storage().instance()` to persist the counter value. When `increment()` is called, it:
1. Retrieves the current value from storage (defaulting to 0 if not set).
2. Adds 1 to the value.
3. Saves the updated value back to storage.
4. Returns the new value.

## Running Tests

To run the tests for this contract, use the following command in this directory:

```bash
cargo test
```
