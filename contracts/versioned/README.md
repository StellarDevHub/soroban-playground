# Versioned Contract

Implements the **versioned contract pattern** for Soroban applications (Issue #588).

Tracks the semantic version history on-chain, supports forward migrations and rollbacks, and maintains an immutable audit log of every transition.

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin, major, minor, patch, label)` | Anyone (once) | Bootstrap with the initial version |
| `register_version(admin, major, minor, patch, label)` | Admin | Append a new version to the registry |
| `migrate_to_version(admin, to_index)` | Admin | Move to a registered version; logs the transition |
| `rollback_to_version(admin, to_index)` | Admin | Revert to a prior version; also logged |
| `get_version()` | Anyone | Current version struct |
| `get_version_at(idx)` | Anyone | Version struct at a history index |
| `get_version_count()` | Anyone | Total registered versions |
| `get_current_index()` | Anyone | Index of the current version |
| `get_migration(idx)` | Anyone | Migration log entry |
| `get_migration_count()` | Anyone | Total migration log entries |
| `get_admin()` | Anyone | Current admin |

## Events

| Topic | Data |
|---|---|
| `init` | (admin, major, minor, patch) |
| `regver` | (index, major, minor, patch) |
| `migrated` | (from_index, to_index) |

## Usage

```rust
// Initialise at v1.0.0
client.initialize(&admin, &1, &0, &0, &String::from_str(&env, "stable"));

// Register v2.0.0
let idx = client.register_version(&admin, &2, &0, &0, &String::from_str(&env, "next"));

// Migrate
client.migrate_to_version(&admin, &idx);

// Rollback to v1
client.rollback_to_version(&admin, &0);
```

## Location

```
contracts/versioned/
├── Cargo.toml
└── src/
    ├── lib.rs      — contract logic
    ├── types.rs    — Version, MigrationRecord, Error, keys
    ├── storage.rs  — typed storage helpers
    └── test.rs     — test suite
```
