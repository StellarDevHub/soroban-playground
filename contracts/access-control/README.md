# Access Control Contract

Implements **flexible role-based access control patterns** for Soroban applications (Issue #594).

Provides ownership transfer, five built-in roles, custom `u32` roles, and an emergency pause — all in a single auditable contract.

## Roles

| Role | `u32` | Description |
|---|---|---|
| `Admin` | 0 | Can grant / revoke any role |
| `Minter` | 1 | Application-defined minting permission |
| `Burner` | 2 | Application-defined burning permission |
| `Pauser` | 3 | Can pause / unpause the contract |
| `Upgrader` | 4 | Application-defined upgrade permission |
| Custom | any `u32` | Any value not listed above |

The owner automatically holds `Admin`.

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(owner)` | Anyone (once) | Bootstrap with owner |
| `transfer_ownership(owner, new_owner)` | Owner | Transfer ownership |
| `grant_role(caller, grantee, role)` | Owner or Admin | Grant a role |
| `revoke_role(caller, target, role)` | Owner or Admin | Revoke a role |
| `pause(caller)` / `unpause(caller)` | Owner or Pauser | Emergency halt |
| `has_role(addr, role)` | Anyone | Check role membership |
| `get_owner()` | Anyone | Read current owner |
| `is_paused()` | Anyone | Check pause state |
| `is_initialized()` | Anyone | Check init state |

## Events

| Topic | Data |
|---|---|
| `init` | owner |
| `xfer` | (old_owner, new_owner) |
| `granted` | (grantee, role) |
| `revoked` | (target, role) |
| `paused` / `unpaused` | caller |

## Usage

```rust
// Initialize
client.initialize(&owner);

// Grant minting permission
client.grant_role(&owner, &minter_address, &(Role::Minter as u32));

// Check in your own contract
assert!(client.has_role(&caller, &(Role::Minter as u32)));

// Transfer ownership
client.transfer_ownership(&owner, &new_owner);
```

## Location

```
contracts/access-control/
├── Cargo.toml
└── src/
    ├── lib.rs      — contract logic
    ├── types.rs    — Role, Error, InstanceKey, DataKey
    ├── storage.rs  — typed storage helpers
    └── test.rs     — test suite
```
