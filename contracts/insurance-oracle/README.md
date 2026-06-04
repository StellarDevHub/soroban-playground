# Insurance Oracle Contract

An oracle for insurance risk data with source management and circuit breaker protection.

## Architecture Overview

The Insurance Oracle contract allows authorized data sources to submit risk data for various insurance types. It includes:

- **Risk Data Management** - Submit and retrieve risk data
- **Source Management** - Add/remove authorized data sources (max 20)
- **Circuit Breaker** - Emergency stop mechanism
- **Outlier Detection** - Auto-reject values deviating >3 standard deviations
- **Historical Claims** - Query risk data by timestamp range

## Events

| Event | Topics | Data |
|-------|--------|------|
| RiskDataSubmitted | (risk_type, value) | risk_type, value |
| RiskDataVerified | (risk_type, count) | risk_type, verification count |
| CircuitBreakerActivated | () | - |
| CircuitBreakerDeactivated | () | - |
| OutlierDetected | () | risk_type, value |

## Function Signatures

### Risk Data Management

```rust
// Submit risk data
submit_risk_data(data: RiskData) -> Result<(), Error>

// Get all risk data for a type
get_risk_data(risk_type: String) -> Vec<RiskData>

// Get historical claims in timestamp range
get_historical_claims(risk_type: String, from: u64, to: u64) -> Vec<RiskData>
```

### Source Management

```rust
// Add data source (admin only)
add_data_source(admin: Address, source: Address) -> Result<(), Error>

// Remove data source (admin only)
remove_data_source(admin: Address, source: Address) -> Result<(), Error>
```

### Verification Threshold

```rust
// Set threshold (admin only, must be 1-20)
set_verification_threshold(admin: Address, threshold: u32) -> Result<(), Error>
```

### Circuit Breaker

```rust
// Activate circuit breaker (admin only)
activate_circuit_breaker(admin: Address) -> Result<(), Error>

// Deactivate circuit breaker (admin only)
deactivate_circuit_breaker(admin: Address) -> Result<(), Error>
```

### Read-only

```rust
is_circuit_open() -> bool
get_threshold() -> u32
get_sources() -> Vec<Address>
```

## Security Model

- Only registered data sources can submit risk data
- Confidence values must be 0-100
- Risk type limited to 64 characters
- Metadata limited to 256 characters
- Circuit breaker blocks all submissions when active
- Outlier detection with 3+ existing values triggers rejection