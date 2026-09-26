# Soroban Standardization Epics Implementation Guide

**Epics:** #1551, #1552, #1554, #1553

## Overview

This document outlines the implementation of 4 standardization epics for the soroban-playground:

1. **#1551** — Standardized Timelock Upgradeability & Multi-Sig Proxy
2. **#1552** — Universal Emergency Pause & Role-Based Access Control (RBAC)
3. **#1554** — Complete Multi-Party Authorization Audit
4. **#1553** — Standardized Event Schema & Indexed Topic Architecture

---

## Epic #1551: Standardized Timelock Upgradeability & Multi-Sig Proxy

### What's Implemented

**Timelock Proposal Framework** (`timelock.rs`):
- Proposal states: Pending → Ready → Executed (with Cancelled)
- Time-based execution gates (delay_seconds)
- Multi-sig queuing and execution tracking
- Rollback safeguards via state transitions

### Usage Pattern

```rust
use soroban_shared_modules::timelock::*;

// Propose an upgrade (requires multisig)
queue::queue(env, Proposal {
    proposer: caller,
    target: contract_address,
    operation: "upgrade".to_string(),
    args: new_wasm_hash,
    proposed_at: env.ledger().timestamp(),
    delay_seconds: 86400, // 1 day
    state: ProposalState::Pending,
});

// Check if ready (after delay)
if proposals::is_ready(env, &proposal) {
    proposals::mark_executed(env, proposal_id)?;
    // Execute upgrade
}
```

### Key Features

- ✅ Time-locked execution gates
- ✅ Proposal cancellation (requires admin)
- ✅ Multisig proposal queuing
- ✅ State machine enforcement (no double-execution)
- ✅ Event emission (proposal queued, executed, cancelled)

### Integration Checklist

- [ ] Add `soroban-shared-modules` to workspace Cargo.toml
- [ ] Import `timelock` module in upgrade-enabled contracts
- [ ] Replace ad-hoc upgrade paths with `queue` → `execute`
- [ ] Add tests for proposal lifecycle
- [ ] Document delay parameter in ADR

---

## Epic #1552: Universal Emergency Pause & Role-Based Access Control

### What's Implemented

**RBAC Framework** (`rbac.rs`):
- Three roles: Admin (0) > Operator (1) > Guardian (2)
- Role-based permission checks
- Emergency pause circuit breaker

### Usage Pattern

```rust
use soroban_shared_modules::rbac::*;

// Check role before operation
roles::require_role(env, &caller, Role::Operator)?;

// Guard state-mutating functions
pause::require_not_paused(env)?;

// Emergency pause (Guardian role)
roles::require_role(env, &caller, Role::Guardian)?;
pause::set_paused(env, true);
```

### Role Hierarchy

| Role | Permissions | Use Case |
|------|-------------|----------|
| Admin (0) | Everything | Governance, upgrades, role management |
| Operator (1) | State mutations | Mint, transfer, burn, approve |
| Guardian (2) | Emergency pause only | Circuit breaker trigger |

### Key Features

- ✅ Hierarchical role model
- ✅ Pause guard on all state mutations
- ✅ Role assignment/revocation
- ✅ Singe-check `require_role()` function
- ✅ Pause state in persistent storage

### Integration Checklist

- [ ] Add `rbac` module to all state-mutating contracts
- [ ] Wrap mutation functions with `pause::require_not_paused()`
- [ ] Initialize admin + guardian roles in contract init
- [ ] Add tests for pause/unpause behavior
- [ ] Document role assignment process

---

## Epic #1554: Complete Multi-Party Authorization Audit

### What's Implemented

**Authorization Framework** (`auth.rs`):
- Caller verification (`require_auth_for_caller`)
- Target matching (`require_auth_for_target`)
- Transfer authorization (`require_auth_for_transfer`)
- Resource ownership checks (`require_auth_for_resource`)
- Audit checklist for entry points

### Usage Pattern

```rust
use soroban_shared_modules::auth::*;

// Verify sender authorization
require_auth_for_caller(env, &caller)?;

// Verify sender can operate on target
require_auth_for_target(env, &caller, &target)?;

// Verify transfer authorization (prevents self-transfer tricks)
require_auth_for_transfer(env, &sender, &recipient)?;

// Verify resource ownership (for admin functions)
require_auth_for_resource(env, &caller, &resource_owner)?;
```

### Audit Checklist

**All entry points must satisfy ONE of:**

1. **Query-only** (no require_auth needed):
   - `get_balance(address)`
   - `total_supply()`
   - `get_admin()`

2. **Caller-only** (require_auth for caller):
   - `set_admin(new_admin)` — caller must authenticate
   - `initialize()` — caller must authenticate

3. **Target-matching** (caller must match target):
   - `transfer(from, to, amount)` — caller must be `from`
   - `approve(spender, amount)` — caller must be owner
   - `burn(amount)` — caller must own tokens

### Impersonation Risks Prevented

| Risk | Prevention |
|------|-----------|
| Admin impersonation | require_auth_for_target(caller, admin) |
| Token owner impersonation | require_auth_for_transfer(sender, recipient) |
| Unauthorized mint/burn | require_auth_for_resource(caller, owner) |
| Delegation without consent | require_auth_for_transfer with delegation checks |

### Integration Checklist

- [ ] Audit all public entry points using checklist
- [ ] Add appropriate require_auth guards
- [ ] Document authorization model in ADR
- [ ] Add integration tests for auth paths
- [ ] Run formal verification on critical paths

---

## Epic #1553: Standardized Event Schema & Indexed Topic Architecture

### What's Implemented

**Event Schema Framework** (`event_schema.rs`):
- Versioned event structure (v1)
- 4 event categories: StateChange, Authorization, Governance, Security
- Indexed topics for backend filtering
- Event emitter helpers

### Usage Pattern

```rust
use soroban_shared_modules::event_schema::*;

// Emit state change event
emitters::emit_state_change(env, caller, recipient, "transfer", 1000);

// Emit authorization event
emitters::emit_auth_event(env, caller, new_admin, "set_admin");

// Emit governance event
emitters::emit_governance_event(env, caller, "execute_proposal", proposal_id);

// Emit security event
emitters::emit_security_event(env, caller, "contract_paused");
```

### Event Categories

| Category | Events | Indexed By |
|----------|--------|-----------|
| StateChange (0) | mint, burn, transfer, approve | actor, target, amount |
| Authorization (1) | set_admin, add_role, revoke_role | actor, target, role |
| Governance (2) | propose, execute, cancel | actor, proposal_id |
| Security (3) | pause, unpause, emergency | actor, timestamp |

### Indexed Topics

- `category` — Event type filter
- `actor` — Who triggered the event
- `target` — Who/what is affected
- `operation` — Function name
- `timestamp` — When it occurred

### Backend Integration

Indexers can efficiently query:

```sql
-- Get all transfers from user X
SELECT * FROM events WHERE category=0 AND actor=X AND operation='transfer'

-- Get all admin changes
SELECT * FROM events WHERE category=1 AND operation='set_admin'

-- Get all pause events
SELECT * FROM events WHERE category=3 AND operation='pause'
```

### Integration Checklist

- [ ] Replace ad-hoc event emissions with StandardEvent
- [ ] Ensure all state mutations emit events
- [ ] Update indexer schema for versioned events
- [ ] Document indexed topics for backend team
- [ ] Add integration tests for event emission

---

## Contract Integration Pattern

### Complete Example: Token Contract

```rust
use soroban_shared_modules::{rbac, timelock, event_schema, auth};

#[contract]
pub struct Token;

#[contractimpl]
impl Token {
    pub fn initialize(env: Env, admin: Address) -> Result<(), String> {
        admin.require_auth();
        
        // Initialize RBAC
        rbac::roles::set_role(&env, &admin, rbac::Role::Admin);
        
        // Initialize timelock
        env.storage().instance().set(&("initialized",), &true);
        
        // Emit event
        event_schema::emitters::emit_auth_event(&env, admin.clone(), admin, "initialize");
        
        Ok(())
    }
    
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), String> {
        // Authorization: sender must authenticate and match 'from'
        auth::require_auth_for_transfer(&env, &from, &to)?;
        
        // Guard: contract must not be paused
        rbac::pause::require_not_paused(&env)?;
        
        // Authorization: check roles
        rbac::roles::require_role(&env, &from, rbac::Role::Operator)?;
        
        // [Perform transfer logic]
        
        // Emit event
        event_schema::emitters::emit_state_change(&env, from, to, "transfer", amount);
        
        Ok(())
    }
    
    pub fn upgrade(env: Env, admin: Address, new_wasm: Vec<u8>) -> Result<(), String> {
        // Authorization: admin role required
        rbac::roles::require_role(&env, &admin, rbac::Role::Admin)?;
        
        // Timelock: queue proposal
        let proposal = timelock::Proposal {
            proposer: admin.clone(),
            target: env.current_contract_address(),
            operation: "upgrade".to_string(),
            args: new_wasm,
            proposed_at: env.ledger().timestamp(),
            delay_seconds: 86400, // 1 day
            state: timelock::ProposalState::Pending,
            id: 0, // Assigned by queue
        };
        
        timelock::queue::queue(&env, proposal);
        
        // Emit event
        event_schema::emitters::emit_governance_event(&env, admin, "propose_upgrade", 0);
        
        Ok(())
    }
    
    pub fn pause(env: Env, guardian: Address) -> Result<(), String> {
        // Authorization: guardian role required
        rbac::roles::require_role(&env, &guardian, rbac::Role::Guardian)?;
        
        rbac::pause::set_paused(&env, true);
        
        // Emit event
        event_schema::emitters::emit_security_event(&env, guardian, "contract_paused");
        
        Ok(())
    }
}
```

---

## Deployment Checklist

- [ ] Create `soroban-shared-modules` crate
- [ ] Add to workspace Cargo.toml
- [ ] Add dependency to contract Cargo.tomls: `soroban-shared-modules = { path = "../../crates/soroban-shared-modules" }`
- [ ] Implement RBAC in initialize()
- [ ] Guard all mutations with `pause::require_not_paused()`
- [ ] Add `require_auth` guards per audit checklist
- [ ] Replace event emissions with `emitters::*`
- [ ] Add timelock to upgrade() for admin functions
- [ ] Write integration tests
- [ ] Run CI/CD

---

## Testing Strategy

### Unit Tests (in shared-modules)

- ✅ Role hierarchy enforcement
- ✅ Pause guard behavior
- ✅ Proposal state transitions
- ✅ Event schema versioning
- ✅ Auth error conditions

### Integration Tests (in contract tests)

- ✅ Full lifecycle (initialize → transfer → pause → unpause)
- ✅ Multi-party authorization (sender + recipient signatures)
- ✅ Timelock delays and execution
- ✅ Event emissions with correct topics
- ✅ Authorization audit checklist

---

## References

- [RBAC Module](crates/soroban-shared-modules/src/rbac.rs)
- [Timelock Module](crates/soroban-shared-modules/src/timelock.rs)
- [Event Schema Module](crates/soroban-shared-modules/src/event_schema.rs)
- [Auth Audit Module](crates/soroban-shared-modules/src/auth.rs)
