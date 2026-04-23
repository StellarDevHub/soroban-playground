# Hello World Soroban Contract

This folder contains a minimal Soroban contract example for the playground.

## What it does

The contract exposes one function:

- `hello() -> String`: returns `"Hello, Soroban!"`

## Files

- `Cargo.toml`: Rust package configuration for building the contract to WASM.
- `src/lib.rs`: the contract implementation.

## Build

```bash
cargo build --target wasm32-unknown-unknown --release
```
