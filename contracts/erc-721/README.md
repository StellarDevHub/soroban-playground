# ERC-721 NFT Standard Contract

An ERC-721 compliant NFT contract for Soroban with metadata and enumerable extensions.

## ERC-721 Interface Table

| Function | Signature | Description |
|----------|-----------|-------------|
| total_supply | `total_supply() -> u64` | Total number of tokens |
| balance_of | `balance_of(owner: Address) -> u64` | Tokens owned by address |
| owner_of | `owner_of(token_id: u64) -> Address` | Owner of token |
| transfer_from | `transfer_from(from, to, token_id)` | Transfer token |
| safe_transfer_from | `safe_transfer_from(from, to, token_id)` | Safe transfer (rejects zero address) |
| mint | `mint(to: Address, token_id: u64)` | Mint new token (admin only) |
| burn | `burn(caller: Address, token_id: u64)` | Burn token |
| approve | `approve(to: Address, token_id: u64)` | Approve single token |
| get_approved | `get_approved(token_id) -> Option<Address>` | Get approval |
| set_approval_for_all | `set_approval_for_all(operator, approved)` | Set operator approval |
| is_approved_for_all | `is_approved_for_all(owner, operator) -> bool` | Check operator approval |
| token_uri | `token_uri(token_id) -> String` | Get token metadata URI |
| set_token_uri | `set_token_uri(token_id, uri)` | Set token URI |
| token_by_index | `token_by_index(index) -> u64` | Enumerable: token by index |
| token_of_owner_by_index | `token_of_owner_by_index(owner, index) -> u64` | Enumerable: token by owner index |

## Events

| Event | Topics | Data |
|-------|--------|------|
| Transfer | (from, to, token_id) | from, to, token_id |
| Approval | (owner, approved, token_id) | owner, approved, token_id |
| ApprovalForAll | (owner, operator, approved) | owner, operator, approved |

## Soroban-Specific Notes

- Zero address is: `00000000000000000000000000000000000000000000000000000000000000000`
- Uses `env.invoker()` to get caller address
- Uses `env.current_contract_address()` for contract address
- All arithmetic uses `saturating_add/sub` for overflow safety

## Usage Examples

### Mint and Transfer

```rust
use erc_721::Erc721Client;

// Initialize (admin only)
client.initialize(&admin).unwrap();

// Mint token to address (admin only)
client.mint(&to, &1).unwrap();

// Check balance
assert_eq!(client.balance_of(&env, &to).unwrap(), 1);

// Approve token
client.approve(&spender, &1).unwrap();

// Transfer token
client.transfer_from(&from, &to, &1).unwrap();
```

### Burn Token

```rust
use erc_721::Erc721Client;

// Burn your own token
client.burn(&owner, &token_id).unwrap();

// Or burn if approved
// (caller must be owner or approved)
```

### Metadata

```rust
use erc_721::Erc721Client;

// Set token URI (owner or admin)
client.set_token_uri(&owner, &1, &String::from_str(&env, "https://example.com/token/1")).unwrap();

// Get token URI
let uri = client.token_uri(&env, &1).unwrap();
```

### Enumerable Extension

```rust
use erc_721::Erc721Client;

// Get token by global index
let token_id = client.token_by_index(&env, &0).unwrap();

// Get token by owner's index
let token_id = client.token_of_owner_by_index(&env, &owner, &0).unwrap();
```