# Quadratic Voting Governance Contract

A Soroban smart contract implementing quadratic voting for DAO governance where voting power scales with the square root of token balance.

## Overview

Quadratic voting is a voting mechanism designed to ensure fair governance by making it increasingly expensive for large token holders to dominate voting outcomes. In this implementation:

- **Voting Power** = floor(sqrt(token_balance))
- A voter with 100 tokens has 10 votes (sqrt(100) = 10)
- A voter with 9 tokens has 3 votes (sqrt(9) = 3)
- This prevents whale dominance while still respecting token ownership

## Features

- **Token-based Governance**: Admin can mint governance tokens to voters
- **Quadratic Voting Power**: Voting power calculated as square root of token balance
- **Whitelist System**: Only whitelisted addresses can vote
- **Proposal Management**: Admin creates proposals with configurable voting periods
- **Quorum Requirements**: Configurable quorum in basis points (default 4%)
- **Pause Mechanism**: Admin can pause/unpause contract operations
- **Event Logging**: All state changes emit events for transparency

## Contract Functions

### Initialization

- `initialize(admin, voting_period, quorum_bps)` - Initialize the contract

### Token Management

- `mint(admin, recipient, amount)` - Mint governance tokens (admin only)

### Admin Functions

- `pause(admin)` - Pause all state-changing operations
- `unpause(admin)` - Resume operations
- `whitelist(admin, voter, allow)` - Add/remove voter from whitelist
- `create_proposal(admin, title, description, duration)` - Create new proposal
- `cancel_proposal(admin, proposal_id)` - Cancel active proposal

### Voting

- `vote(voter, proposal_id, is_for)` - Cast quadratic vote (whitelisted only)

### Finalization

- `finalize(proposal_id)` - Finalize proposal after voting ends (anyone)

### Read-only Functions

- `get_proposal(id)` - Get proposal details
- `get_proposal_count()` - Get total number of proposals
- `get_balance(addr)` - Get token balance for address
- `get_total_supply()` - Get total token supply
- `is_whitelisted(voter)` - Check if voter is whitelisted
- `is_paused()` - Check if contract is paused
- `get_admin()` - Get admin address
- `balance_to_voting_power(balance)` - Calculate voting power from balance (off-chain helper)

## Key Mechanics

### Quadratic Voting Formula

```
voting_power = floor(sqrt(token_balance))
```

Examples:
- 1 token → 1 vote
- 4 tokens → 2 votes
- 9 tokens → 3 votes
- 16 tokens → 4 votes
- 100 tokens → 10 votes

### Quorum Calculation

```
quorum_needed = (total_supply_snapshot * quorum_bps) / 10_000
```

Default quorum is 400 basis points (4%).

### Proposal Lifecycle

1. **Active** - Voting is open
2. **Passed** - Quorum reached and votes_for > votes_against
3. **Defeated** - Quorum not reached or votes_against >= votes_for
4. **Cancelled** - Cancelled by admin or proposer

## Testing

Run tests with:

```bash
cargo test
```

The test suite includes:
- Initialization tests
- Token minting and balance tracking
- Pause/unpause functionality
- Whitelist management
- Proposal creation and cancellation
- Quadratic voting math verification
- Multiple voter scenarios
- Quorum enforcement
- Whale dominance prevention tests

## Security Considerations

- Admin has significant control (minting, whitelisting, pausing)
- Consider implementing timelocks for admin actions in production
- Whitelist prevents Sybil attacks but requires careful management
- Quorum ensures minimum participation for proposals to pass

## License

MIT
