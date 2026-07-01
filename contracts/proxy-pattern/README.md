# Upgradeable Contract Proxy Pattern

A governance-aware proxy contract for Soroban that stores the current
implementation address on-chain and lets token-holders vote on upgrades
protected by a configurable time-delay guard.

## Functions

| Function | Access | Description |
|---|---|---|
| `init(admin, initial_impl, upgrade_delay)` | Anyone (once) | Bootstrap the proxy |
| `propose_upgrade(proposer, new_impl)` | Admin / authorised upgrader | Open an upgrade proposal |
| `vote_on_proposal(proposal_id, voter, vote_for)` | Anyone | Cast a vote |
| `execute_upgrade(proposal_id)` | Admin | Execute an approved proposal after the delay |
| `authorize_upgrader(upgrader)` | Admin | Grant proposal rights |
| `revoke_upgrader(upgrader)` | Admin | Revoke proposal rights |
| `update_upgrade_delay(new_delay)` | Admin | Change the time-delay |
| `emergency_pause()` | Admin | Freeze upgrades (sets delay to `u64::MAX`) |
| `resume_operations(normal_delay)` | Admin | Restore after a pause |
| `get_proxy_state()` | Anyone | Read full proxy state |
| `get_implementation()` | Anyone | Current implementation address |
| `get_proposal(id)` | Anyone | Proposal details |
| `get_current_version()` | Anyone | Latest version number |
| `get_implementation_version(v)` | Anyone | Historical implementation record |
| `is_authorized_upgrader(addr)` | Anyone | Check proposer authorisation |

## Events

| Topic | Data |
|---|---|
| `init` | admin address |
| `proposed` | proposal_id |
| `upgraded` | new implementation address |
| `paused` | () |
| `resumed` | () |

## Storage layout

| Key type | Payload | Stored value |
|---|---|---|
| `DataKey::ProxyState` | — | `ProxyState` |
| `DataKey::ProposalCounter` | — | `u32` |
| `DataKey::VersionCounter` | — | `u32` |
| `ProposalKey::Proposal(id)` | proposal id | `UpgradeProposal` |
| `VersionKey::ImplVersion(v)` | version number | `ImplementationVersion` |
| `AuthKey::Upgrader(addr)` | address | `bool` |

## Usage

```rust
// Deploy and initialise with a 3 600-second upgrade delay
client.init(&admin, &impl_addr, &3600u64);

// Propose an upgrade
let pid = client.propose_upgrade(&admin, &new_impl_addr);

// Community votes
client.vote_on_proposal(&pid, &voter1, &true);
client.vote_on_proposal(&pid, &voter2, &true);

// After the delay has elapsed, execute
client.execute_upgrade(&pid);
```

## Location

```
contracts/proxy-pattern/
├── Cargo.toml
└── src/
    └── lib.rs   — contract logic + tests
```
