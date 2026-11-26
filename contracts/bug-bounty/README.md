# Bug Bounty Contract

A decentralised vulnerability disclosure and reward distribution programme built on Soroban.

## Overview

This contract manages the full lifecycle of a bug bounty programme:

1. **Admin initialises** the contract with configurable reward tiers per severity.
2. **Sponsors fund** the bounty pool by depositing XLM tokens.
3. **Researchers submit** vulnerability reports (title + IPFS CID of disclosure + severity).
4. **Admin triages** reports: Pending → UnderReview → Accepted (with reward) or Rejected.
5. **Researchers claim** their reward using the pull-over-push pattern.
6. **Admin can pause** the contract for emergency situations.

## Contract Functions

### Initialisation

| Function                                                                         | Description              |
| -------------------------------------------------------------------------------- | ------------------------ |
| `initialize(admin, reward_low?, reward_medium?, reward_high?, reward_critical?)` | Initialise the programme |

### Pool Management

| Function                                   | Description                        |
| ------------------------------------------ | ---------------------------------- |
| `fund_pool(funder, token, amount)`         | Deposit XLM into the bounty pool   |
| `pool_balance()`                           | Query current pool balance         |
| `emergency_withdraw(admin, token, amount)` | Admin-only emergency fund recovery |

### Report Lifecycle

| Function                                                     | Description                                 |
| ------------------------------------------------------------ | ------------------------------------------- |
| `submit_report(reporter, title, description_hash, severity)` | Submit a vulnerability report               |
| `start_review(admin, report_id)`                             | Move report to UnderReview                  |
| `accept_report(admin, report_id, reward?)`                   | Accept report and reserve reward            |
| `reject_report(admin, report_id)`                            | Reject a report                             |
| `withdraw_report(reporter, report_id)`                       | Reporter withdraws their own Pending report |
| `claim_reward(reporter, report_id, token)`                   | Reporter claims accepted reward             |

### Admin Controls

| Function                                   | Description                       |
| ------------------------------------------ | --------------------------------- |
| `set_paused(admin, paused)`                | Pause or unpause the contract     |
| `transfer_admin(admin, new_admin)`         | Transfer admin role               |
| `set_reward_tier(admin, severity, amount)` | Update reward for a severity tier |

### Read-only Queries

| Function                        | Description                         |
| ------------------------------- | ----------------------------------- |
| `get_report(id)`                | Get a report by ID                  |
| `report_count()`                | Total reports submitted             |
| `is_paused()`                   | Whether contract is paused          |
| `get_admin()`                   | Admin address                       |
| `reward_for_severity(severity)` | Configured reward for a tier        |
| `has_open_report(reporter)`     | Whether reporter has an open report |

## Researcher Protections

These guard against a sponsor cancelling or under-paying while valid reports are awaiting triage.

> The contract keeps one shared reward pool (an accounting counter) rather than per-bounty escrows, so the protections apply to the program as a whole. There is no per-bounty `cancel_bounty`.

### Escrow tier locks
- `submit_report` escrows the report's severity tier out of the *available* pool (`pool_balance - locked_balance`). If the unlocked pool cannot cover the tier, submission fails with `InsufficientPool`, so every accepted report is payable.
- The tier is a snapshot (`Report.locked_reward`): later `set_reward` calls cannot shrink or inflate the payout.
- The lock is released when the report is accepted (paid from the pool), rejected or withdrawn. `locked_balance`, `available_balance` and `active_report_count` expose the state.

### 30-day cancellation notice
| Function | Who | Effect |
|----------|-----|--------|
| `request_cancellation` | admin | Starts the notice clock. Submissions stay open and still lock their tier. |
| `abort_cancellation` | admin | Cancels the request; the clock resets. |
| `execute_cancellation` | admin | After `CANCELLATION_NOTICE_SECS` (30 days) **and** with zero open reports, marks the program cancelled and releases the unlocked pool. Fails with `NoticePeriodActive` or `ActiveSubmissionsLocked` otherwise. |

A cancelled program refuses new reports and funding (`ProgramCancelled`).

### Triager arbitration of severity
1. Admin sets a third-party triager with `set_triager`.
2. For an open report the admin may `propose_severity` with a different severity. The report cannot be accepted (`SeverityProposalPending`) until the reporter answers.
3. The reporter either `accept_proposal` (escrow re-locked to the new tier) or `dispute_severity` (needs a triager).
4. While disputed, the admin can neither accept nor reject the report (`DisputeOpen`). Only the triager can `resolve_dispute` with a final severity, which re-locks the escrow; raising it needs unlocked pool funds.

### Proof of prior art
`attach_prior_art(reporter, report_id, commitment)` records a write-once 32-byte commitment (e.g. SHA-256 of the **encrypted** write-up) and the ledger timestamp. The plaintext and key never touch the chain. A second call fails with `PriorArtAlreadySet`; read it with `get_prior_art`.

## Security Patterns

- **Checks-Effects-Interactions**: State is updated before any token transfer.
- **Pull-over-push**: Reporters initiate their own reward claims.
- **Access control**: All admin functions require `require_auth()`.
- **Spam prevention**: One open report per reporter at a time.
- **Emergency pause**: Admin can halt new submissions and triage.
- **Replay protection**: Each report has a unique ID; rewards are zeroed after claim.

## Severity Tiers & Default Rewards

| Severity | Default Reward                  |
| -------- | ------------------------------- |
| Low      | 1 XLM (10,000,000 stroops)      |
| Medium   | 5 XLM (50,000,000 stroops)      |
| High     | 20 XLM (200,000,000 stroops)    |
| Critical | 100 XLM (1,000,000,000 stroops) |

## Building

```bash
cd contracts/bug-bounty
cargo build --target wasm32-unknown-unknown --release
```

## Testing

```bash
cd contracts/bug-bounty
cargo test
```
