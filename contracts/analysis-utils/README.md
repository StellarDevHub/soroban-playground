# Analysis Utils Contract

Implements **Soroban contract analysis and verification utilities** (Issue #595).

An on-chain audit ledger that stores results from off-chain analysis tooling: security vulnerability scans, gas-usage analyses, code-quality checks, and formal-property verifications.

## Analysis Types

| Type | Record function | Read function |
|---|---|---|
| Security scan | `record_security` | `get_security_report` |
| Gas analysis | `record_gas` | `get_gas_report` |
| Code quality | `record_quality` | `get_quality_report` |
| Property verification | `record_verification` | `get_verification_result` |

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin)` | Anyone (once) | Bootstrap the contract |
| `record_security(admin, hash, severity, findings)` | Admin | Store a security scan result |
| `record_gas(admin, hash, avg, max, score)` | Admin | Store a gas analysis result |
| `record_quality(admin, hash, score, warnings)` | Admin | Store a quality check result |
| `record_verification(admin, hash, property, holds)` | Admin | Store a verification result |
| `get_security_report(id)` | Anyone | Read security report by ID |
| `get_gas_report(id)` | Anyone | Read gas report by ID |
| `get_quality_report(id)` | Anyone | Read quality report by ID |
| `get_verification_result(id)` | Anyone | Read verification result by ID |
| `get_*_count()` | Anyone | Number of stored reports per type |
| `get_admin()` | Anyone | Current admin |

## Severity Levels

`None → Info → Low → Medium → High → Critical`

## Events

| Topic | Data |
|---|---|
| `init` | admin |
| `sec` | (id, severity, finding_count) |
| `gas` | (id, avg_gas, optimisation_score) |
| `qual` | (id, score, warning_count) |
| `verify` | (id, holds) |

## Usage

```rust
// Initialise
client.initialize(&admin);

// Off-chain analyser submits a security scan
let id = client.record_security(
    &admin, &contract_wasm_hash,
    &SeverityLevel::Medium, &2,
);

// Anyone reads the report
let report = client.get_security_report(&id);
```

## Location

```
contracts/analysis-utils/
├── Cargo.toml
└── src/
    ├── lib.rs      — contract logic
    ├── types.rs    — report structs, SeverityLevel, Error, keys
    ├── storage.rs  — typed storage helpers
    └── test.rs     — test suite
```
