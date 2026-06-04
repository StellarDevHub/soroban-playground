## Summary

This PR implements four new Soroban smart-contract modules as requested in the linked issues.

---

### Contracts Added

| Contract | Location | Issue |
|---|---|---|
| **Upgradeable** | `contracts/upgradeable/` | #587 |
| **Versioned** | `contracts/versioned/` | #588 |
| **Access Control** | `contracts/access-control/` | #594 |
| **Analysis Utils** | `contracts/analysis-utils/` | #595 |

---

### contracts/upgradeable (#587)

Upgradeable contract pattern with admin-gated code-hash upgrades and an optional ledger timelock.

**Key functions:** `initialize`, `propose_upgrade`, `execute_upgrade`, `upgrade_to`, `pause`/`unpause`

**Security:** double-init guard, admin-only upgrade gate, configurable timelock, pause guard.

---

### contracts/versioned (#588)

Versioned contract pattern that tracks semantic versions on-chain, supports forward migrations and rollbacks, and persists an immutable migration audit log.

**Key functions:** `initialize`, `register_version`, `migrate_to_version`, `rollback_to_version`, `get_version`, `get_migration`

---

### contracts/access-control (#594)

Flexible role-based access control with five built-in roles (`Admin`, `Minter`, `Burner`, `Pauser`, `Upgrader`), arbitrary custom `u32` roles, ownership transfer, and an emergency pause.

**Key functions:** `initialize`, `grant_role`, `revoke_role`, `transfer_ownership`, `pause`/`unpause`, `has_role`

---

### contracts/analysis-utils (#595)

On-chain audit ledger for off-chain contract analysis tooling: security vulnerability scans, gas-usage analyses, code-quality checks, and formal-property verification results.

**Key functions:** `record_security`, `record_gas`, `record_quality`, `record_verification`, and corresponding `get_*_report` / `get_*_count` readers.

---

### Testing

Each contract ships with a dedicated `src/test.rs` (15-25 test cases per contract) covering:
- Happy-path flows
- Double-initialisation guard
- Unauthorized callers
- Contract-paused guards
- Invalid / out-of-range inputs
- Not-found / empty state conditions

---

### Closes

Closes #587
Closes #588
Closes #594
Closes #595
