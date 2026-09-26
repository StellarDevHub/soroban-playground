# Soroban Playground Consolidation & Testing Strategy

**Epics:** #1543, #1544, #1545, #1546  
**Scope:** 15 untested contracts + 3 consolidation initiatives

## Executive Summary

| Epic | Issue | Focus | Contracts | Impact |
|------|-------|-------|-----------|--------|
| SC-EPIC-02 | #1543 | Unit Tests | 15 untested | Quality gate |
| SC-EPIC-03 | #1544 | Subscription | subscription(s) → 1 | ~20% code dedup |
| SC-EPIC-04 | #1545 | Vesting | vesting(s) → 1 | ~25% code dedup |
| SC-EPIC-05 | #1546 | Oracles | oracle pairs → 1 | ~30% code dedup |

## Epic #1543: Unit Test Suite for 15 Untested Contracts

### Contracts & Test Strategy

```
carbon-credit-oracle          → Unit tests + property tests
cartel                        → Unit tests + authorization tests
donation-tracker              → Unit tests + event tracking
gaming-crafting               → Unit tests + state machine
hello-world                   → Unit tests (baseline)
job-marketplace               → Unit tests + workflow
profile-registry              → Unit tests + schema validation
proxy-pattern                 → Unit tests + delegation
real-estate-oracle            → Unit tests + price feeds
simulation-engine             → Unit tests + determinism
sports-prediction             → Unit tests + outcome tracking
stablecoin                    → Unit tests + invariants
subscription_manager          → Unit tests + lifecycle
token-burn                    → Unit tests + supply tracking
vesting_pool                  → Unit tests + cliff/cliff tracking
```

### Test Coverage Targets

- **Line coverage:** ≥85% for all 15 contracts
- **Branch coverage:** ≥75% for critical paths
- **Property tests:** ≥3 per contract (state machines, invariants)
- **Integration tests:** ≥1 per contract (happy path)

### Implementation Path

**Week 1:** carbon-credit-oracle, real-estate-oracle, sports-prediction (oracles)
**Week 2:** stablecoin, token-burn, subscription_manager (core)
**Week 3:** job-marketplace, profile-registry, donation-tracker (registry/tracking)
**Week 4:** vesting_pool, gaming-crafting, simulation-engine, proxy-pattern, hello-world, cartel

---

## Epic #1544: Unified Subscription Architecture

### Current State

- `contracts/subscription/` — basic subscription logic
- `contracts/subscription-manager/` — subscription management
- `contracts/subscription_manager/` — duplicate (naming variation)

### Consolidation Plan

**Target:** Single `contracts/subscription/src/lib.rs`

**Features:**
```rust
pub fn subscribe(subscriber: Address, plan_id: u32, billing_cycle: u32) -> SubscriptionId;
pub fn renew(subscription_id: SubscriptionId) -> Result<(), Error>;
pub fn cancel(subscription_id: SubscriptionId) -> Result<(), Error>;
pub fn claim_grace_period(subscription_id: SubscriptionId) -> Result<u32, Error>;
pub fn get_subscription(subscription_id: SubscriptionId) -> Subscription;
pub fn add_plan(admin: Address, plan: Plan) -> PlanId;
```

**Storage:**
```rust
pub enum DataKey {
    Subscription(SubscriptionId),
    Plan(PlanId),
    SubscriptionCount,
    Admin,
    GracePeriodDays,
}
```

**Tiered Plans:**
```rust
pub struct Plan {
    id: PlanId,
    name: String,
    price: i128,
    billing_cycle_days: u32,
    grace_period_days: u32,
}
```

**Tests:**
- Subscribe flow (happy path)
- Auto-renewal with grace period
- Plan tier transitions
- Cancellation with refund
- Authorization checks (admin-only)

---

## Epic #1545: Universal Vesting Engine

### Current State

- `contracts/vesting/` — linear vesting
- `contracts/vesting_pool/` — pool-based vesting
- `contracts/token-vesting/` — token transfers
- `contracts/vc-vesting/` — venture capital vesting

### Consolidation Plan

**Target:** Single `contracts/vesting/src/lib.rs` with curves

**Curve Types:**
```rust
pub enum VestingCurve {
    Linear {
        total_amount: i128,
        start_time: u64,
        end_time: u64,
    },
    Exponential {
        initial_amount: i128,
        growth_rate: u32,
        cliff_time: u64,
    },
    Staged {
        stages: Vec<(u64, i128)>,
    },
}
```

**Features:**
```rust
pub fn create_schedule(
    beneficiary: Address,
    curve: VestingCurve,
    clawback_admin: Option<Address>,
) -> ScheduleId;

pub fn claim(schedule_id: ScheduleId) -> Result<i128, Error>;
pub fn clawback(schedule_id: ScheduleId, amount: i128) -> Result<(), Error>;
pub fn get_vested_amount(schedule_id: ScheduleId) -> i128;
```

**Storage:**
```rust
pub enum DataKey {
    Schedule(ScheduleId),
    ScheduleCount,
    ClaimedAmount(ScheduleId),
}
```

**Tests:**
- Linear vesting (1-year unlock)
- Cliff + linear (6-month cliff, then linear)
- Exponential backloading (startup token vesting)
- Clawback with authorization
- Concurrent claims
- Property test: claimed ≤ vested at any time

---

## Epic #1546: Resilient Oracle Aggregator

### Current State

**Weather:**
- `contracts/weather-oracle/` — single reporter
- `contracts/weather-data-oracle/` — alternate implementation

**Supply Chain:**
- `contracts/supply-chain-oracle/` — logistics data
- `contracts/supply-chain-data-oracle/` — alternate implementation

### Consolidation Plan

**Target:** Single `contracts/oracle-aggregator/src/lib.rs`

**Features:**
```rust
pub fn submit_price(
    reporter: Address,
    asset_id: Symbol,
    price: i128,
    timestamp: u64,
) -> Result<(), Error>;

pub fn get_price(asset_id: Symbol) -> Result<OraclePrice, Error>;
pub fn add_reporter(admin: Address, reporter: Address, asset_ids: Vec<Symbol>) -> Result<(), Error>;
```

**Aggregation Logic:**
```rust
pub struct OraclePrice {
    median: i128,
    deviation: i128,
    age_seconds: u64,
    reporter_count: u32,
}

fn aggregate_prices(prices: Vec<i128>) -> i128 {
    // Median of 3+ reporters
    prices.sort();
    prices[prices.len() / 2]
}

fn check_staleness(timestamp: u64, max_age: u64) -> Result<(), Error> {
    if env.ledger().timestamp() - timestamp > max_age {
        return Err(Error::StalePrice);
    }
    Ok(())
}
```

**Storage:**
```rust
pub enum DataKey {
    Price(Symbol),
    Reporters,
    ReporterAssets(Address),
    Admin,
    MaxPriceAge,
    MinReporterQuorum,
}
```

**Tests:**
- Submit prices from multiple reporters
- Median calculation (3, 5, 7 reporters)
- Staleness detection (1h threshold)
- Deviation alerting (>10% from median)
- Reporter authorization
- Price feed consistency

---

## Implementation Roadmap

### Phase 1: Consolidation (Weeks 1-2)

1. **Oracle Aggregator** (#1546)
   - Merge weather-oracle, weather-data-oracle
   - Merge supply-chain-oracle, supply-chain-data-oracle
   - Single contract with multi-asset support

2. **Subscription** (#1544)
   - Consolidate 3 subscription contracts
   - Add tiered plans, grace periods
   - Implement auto-renewal

### Phase 2: Vesting & Advanced Features (Weeks 3-4)

3. **Vesting Engine** (#1545)
   - Consolidate 4 vesting contracts
   - Support linear, exponential, staged curves
   - Implement clawback with safeguards

4. **Unit Tests** (#1543)
   - Add tests to 15 untested contracts
   - Target ≥85% line coverage
   - Property tests for invariants

### Phase 3: Verification & CI (Week 5)

- Mutation testing on consolidated contracts
- Differential testing (old vs new contracts)
- Budget regression gates
- Contract size optimization

---

## Expected Outcomes

| Metric | Target |
|--------|--------|
| Code reduction | 40-50% across consolidated contracts |
| Test coverage | ≥85% line, ≥75% branch |
| WASM size | <100KB per consolidated contract |
| Gas optimization | 10-20% per-operation improvement |
| Time to implement | 5 weeks (3 devs) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| State migration on consolidation | Dual-contract period with data export/import |
| Breaking changes | Versioned event tags; soft-deprecation period |
| Regression in behavior | Differential testing (old vs new) |
| Increased contract size | Modular storage; lazy loading strategies |

---

## References

- Epic #1543: Unit Test Suite
- Epic #1544: Subscription Consolidation
- Epic #1545: Vesting Consolidation
- Epic #1546: Oracle Aggregator
