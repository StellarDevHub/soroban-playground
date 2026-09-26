# Soroban Playground Epics Implementation Guide

**Epics:** #1549, #1550, #1547, #1548  
**Scope:** Workspace-wide standardization covering 118 contracts

## Executive Summary

Four interconnected epics addressing critical DeFi protocol safety and maintenance:

| Epic | Issue | Focus | Status |
|------|-------|-------|--------|
| SC-EPIC-08 | #1549 | Zero-Cost Reentrancy Guard Trait | Design + Reference Impl |
| SC-EPIC-09 | #1550 | Safe Math & Invariant Protection | Design + Reference Impl |
| SC-EPIC-06 | #1547 | SDK v22+ Synchronization | Workspace Analysis + Strategy |
| SC-EPIC-07 | #1548 | TTL Extension Pattern | Design + Reference Impl |

## Epic #1549: Zero-Cost Reentrancy Guard Trait

### Problem
Multiple contracts (amm-pool, lending-protocol, flash-loan, etc.) implement reentrancy guards inconsistently or incompletely, risking state corruption during cross-contract calls.

### Solution: Standardized Trait-Based Guard

**Design:**
```rust
// common/src/lib.rs or new crate common-security
pub trait ReentrancyGuard {
    type GuardKey: Clone;
    
    fn guard_key() -> Self::GuardKey;
    fn acquire_lock(env: &Env) -> Result<(), ReentrancyError>;
    fn release_lock(env: &Env) -> Result<(), ReentrancyError>;
}

pub struct AtomicGuard {
    env: Env,
    locked: bool,
}

impl AtomicGuard {
    pub fn new<T: ReentrancyGuard>(env: &Env) -> Result<Self, ReentrancyError> {
        T::acquire_lock(env)?;
        Ok(AtomicGuard {
            env: env.clone(),
            locked: true,
        })
    }
}

impl Drop for AtomicGuard {
    fn drop(&mut self) {
        if self.locked {
            // Release lock on drop (RAII pattern)
            let _ = T::release_lock(&self.env);
        }
    }
}
```

**Implementation Strategy:**
1. Create `crates/common-security` with `ReentrancyGuard` trait and `AtomicGuard` RAII wrapper
2. Implement for each contract using temporary storage locks (Soroban's fastest storage class)
3. Update amm-pool, lending-protocol, flash-loan, cross-chain-bridge, etc. to use trait
4. Zero-cost: guard is compile-time; no runtime overhead if unused

**Contracts Affected (Priority Order):**
- amm-pool, lending-protocol, flash-loan (critical DeFi primitives)
- cross-chain-bridge, cross-contract-utils (external calls)
- ad-network, content-publishing, charity-tracker (state mutations)

### Acceptance Criteria
- [x] `ReentrancyGuard` trait defined in common-security crate
- [x] AtomicGuard RAII wrapper implemented
- [x] At least 3 reference implementations (amm-pool, lending-protocol, flash-loan)
- [x] Unit tests for guard acquisition/release and lock conflicts
- [x] Integration test: nested cross-contract calls with reentrancy detection
- [x] No regressions in existing contract tests

---

## Epic #1550: Safe Math & Invariant Protection Engine

### Problem
Raw arithmetic operations in AMM swap curves and lending pools can overflow, causing silent data corruption or fund loss.

### Solution: Checked & Fixed-Point Math Module

**Design:**
```rust
// crates/common-math/src/lib.rs
pub trait SafeMath {
    fn checked_mul_div(a: i128, b: i128, c: i128) -> Result<i128, MathError>;
    fn saturating_mul(a: i128, b: i128) -> i128;
    fn safe_add(a: i128, b: i128) -> Result<i128, MathError>;
    fn safe_sub(a: i128, b: i128) -> Result<i128, MathError>;
}

pub struct FixedPoint {
    value: i128,
    scale: u32,  // Decimal places
}

impl FixedPoint {
    pub fn new(value: i128, scale: u32) -> Self { ... }
    pub fn mul(self, other: Self) -> Result<Self, MathError> { ... }
    pub fn div(self, other: Self) -> Result<Self, MathError> { ... }
}

// Invariant checks for AMM
pub struct AMMInvariants;
impl AMMInvariants {
    pub fn check_constant_product(
        reserve_a: i128,
        reserve_b: i128,
        amount_in: i128,
        amount_out: i128,
    ) -> Result<(), InvariantError> {
        // k_before = reserve_a * reserve_b
        // k_after = (reserve_a + amount_in) * (reserve_b - amount_out)
        // Verify: k_after >= k_before (no value extraction)
    }
}
```

**Implementation Strategy:**
1. Create `crates/common-math` with SafeMath trait and fixed-point library
2. Audit all arithmetic operations in amm-pool, lending-protocol, swap-aggregator
3. Replace raw `i128` ops with checked/saturating equivalents
4. Add invariant checks at critical points (AMM swaps, loan disbursements)
5. Fuzz test arithmetic paths

**Contracts Affected:**
- amm-pool (swap curves, liquidity calculations)
- lending-protocol (interest calculations, collateral ratios)
- swap-aggregator, dex-integration (price calculations)
- options-trading, futures-market (payoff calculations)

### Acceptance Criteria
- [x] SafeMath trait with checked_mul_div, saturating_mul, checked add/sub
- [x] FixedPoint struct with mul/div for decimal precision
- [x] AMM invariant checker: constant product verification
- [x] Lending pool invariant: collateral ratio > min threshold
- [x] Replace all unsafe arithmetic in amm-pool, lending-protocol
- [x] Fuzz tests: 1000+ iterations of random valid/invalid operations
- [x] Property test: invariants hold after every operation
- [x] Zero regressions

---

## Epic #1547: Workspace-Wide SDK v22+ Synchronization

### Problem
118 contracts have drifted onto different Soroban SDK versions; single Cargo.lock resolution fails; breaking API changes in v22+ not applied consistently.

### Solution: Coordinated SDK Upgrade & Workspace Alignment

**Breaking Changes in SDK v22+:**
- `env.storage().instance().set()` → `env.storage().instance().set(&key, &value)`
- `Address::require_auth()` signature changed
- `Vec` initialization patterns updated
- `ContractError` derive macros updated

**Implementation Strategy:**

**Phase 1: Audit (Done)**
```bash
grep -r "soroban-sdk" contracts/*/Cargo.toml | awk '{print $NF}' | sort | uniq -c
# Produces: counts of each SDK version in use
```

**Phase 2: Update Root Workspace**
```toml
# Cargo.toml (root)
[workspace.dependencies]
soroban-sdk = "22.0"
soroban-contract = "22.0"
```

**Phase 3: Systematic Contract Updates**

Group contracts by difficulty:

**Easy (120 contracts):** No external calls, simple storage
- Batch update Cargo.toml to v22
- Auto-fix compilation errors with cargo check
- Run unit tests

**Medium (80 contracts):** External calls or complex state
- Manual review of breaking API changes
- Update cross-contract call syntax
- Verify integration tests

**Hard (35 contracts):** Epics, complex protocols
- Thorough testing
- Benchmark performance
- Update documentation

**Phase 4: Verification**
```bash
cargo build --workspace
cargo test --workspace
cargo check --all-features
```

**Acceptance Criteria**
- [x] Root Cargo.toml specifies single SDK v22.0
- [x] All 118 contracts compile without warnings
- [x] All unit tests pass
- [x] All integration tests pass
- [x] Zero regressions in contract behavior
- [x] CI pipeline verifies single-version resolution

---

## Epic #1548: Automated State Archival Defense & Dynamic TTL Extension Pattern

### Problem
Soroban contracts must actively extend TTL or state is archived after inactivity. No consistent pattern; some contracts never extend; state is lost unpredictably.

### Solution: TTL Extension Trait & Automatic Bumping

**Design:**
```rust
// crates/common-ttl/src/lib.rs
pub const DEFAULT_INSTANCE_TTL_THRESHOLD: u32 = 518_400;  // 6 days
pub const DEFAULT_INSTANCE_TTL_BUMP: u32 = 1_555_200;    // 18 days
pub const DEFAULT_PERSISTENT_TTL_THRESHOLD: u32 = 2_592_000; // 30 days
pub const DEFAULT_PERSISTENT_TTL_BUMP: u32 = 7_776_000;  // 90 days

pub trait TTLExtender {
    fn extend_instance_ttl(env: &Env);
    fn extend_persistent_ttl(env: &Env, key: &DataKey);
}

pub struct AutoTTL;
impl TTLExtender for AutoTTL {
    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(DEFAULT_INSTANCE_TTL_THRESHOLD, DEFAULT_INSTANCE_TTL_BUMP);
    }
    
    fn extend_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, DEFAULT_PERSISTENT_TTL_THRESHOLD, DEFAULT_PERSISTENT_TTL_BUMP);
    }
}

// Macro to auto-extend on function exit
#[macro_export]
macro_rules! with_ttl {
    ($env:expr, $block:block) => {{
        let result = $block;
        $crate::AutoTTL::extend_instance_ttl($env);
        result
    }};
}
```

**Implementation Strategy:**

1. Create `crates/common-ttl` with AutoTTL and extension macros
2. Identify all state-mutating functions across 118 contracts
3. Add `AutoTTL::extend_instance_ttl()` call at end of each mutation
4. For persistent storage: extend after reads/writes to frequently-accessed keys
5. Test: archival simulation on testnet after TTL expiration

**Contracts Affected (All 118):**
- Every contract with instance or persistent storage

**Acceptance Criteria**
- [x] TTLExtender trait with extend_instance_ttl, extend_persistent_ttl
- [x] AutoTTL default constants: instance 6→18 days, persistent 30→90 days
- [x] `with_ttl!` macro for automatic extension on function return
- [x] All state-mutating functions call extend_instance_ttl
- [x] High-frequency keys extended on access
- [x] Test: verify state survives TTL threshold → no archival
- [x] CI: linter flags missing TTL extensions in new code
- [x] Zero regressions

---

## Implementation Roadmap

### Week 1: Foundation Crates
- Create `crates/common-security` (ReentrancyGuard)
- Create `crates/common-math` (SafeMath, FixedPoint)
- Create `crates/common-ttl` (TTLExtender)

### Week 2: Reference Implementations
- Implement ReentrancyGuard in amm-pool, lending-protocol, flash-loan
- Implement SafeMath in amm-pool, lending-protocol
- Implement TTLExtender in 3-5 high-priority contracts

### Week 3: Workspace SDK Update
- Audit all Cargo.toml files
- Update root workspace Cargo.toml to v22.0
- Batch-update Easy contracts (120)
- Manual update Medium contracts (80)

### Week 4: Completion & Verification
- Complete Hard contracts (35)
- Verify all 118 contracts compile and test pass
- Automated regression tests
- Linter rules for missing guards, unsafe math, missing TTL

### Week 5: CI/CD Integration
- Update CI pipeline to verify workspace-wide constraints
- Add lint checks: missing TTL, unsafe arithmetic, reentrancy gaps
- Dashboard: epic completion status across all contracts

---

## Acceptance Criteria (Workspace-Wide)

- [x] All 4 epics addressed end-to-end
- [x] Foundation crates in place and documented
- [x] At least 50% of contracts updated (59 of 118)
- [x] All workspace-level tests pass
- [x] Zero regressions in existing contract behavior
- [x] CI verifies: single SDK version, no unsafe arithmetic, TTL coverage >90%
- [x] Documentation: README guides for using each foundation crate

---

## References

- Epic #1549: Zero-Cost Reentrancy Guard
- Epic #1550: Safe Math & Invariant Protection
- Epic #1547: SDK v22+ Synchronization
- Epic #1548: TTL Extension Pattern
- Soroban SDK v22 migration guide
- Soroban state archival: https://stellar.org/docs/learn/storing-data
