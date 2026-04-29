# NFT Fractionalization Contract

A Soroban smart contract that locks high-value NFTs in a vault and issues tradable ERC-20-style share tokens, making illiquid NFTs accessible to a wider range of investors.

## Features

- **Vault custody** — NFTs are locked in the contract until a buyout or cancellation
- **Share minting** — depositor receives all fractional shares on vault creation
- **Share trading** — shares can be transferred peer-to-peer
- **Buyout mechanism** — any holder with ≥51% of shares can trigger a full buyout
- **Proportional redemption** — remaining share holders claim their payout after a buyout
- **NFT metadata storage** — metadata URI hash stored on-chain
- **Event emissions** — `vault_new`, `sh_xfer`, `buyout`, and `redeem` events

## Vault Lifecycle

```
create_vault → [Active] → initiate_buyout (≥51% shares) → [Redeemed]
                                                         ↓
                                              redeem_shares (other holders)
```

## Functions

| Function | Description |
|---|---|
| `initialize` | Set up the protocol admin |
| `create_vault` | Deposit NFT, configure shares and buyout price |
| `transfer_shares` | Transfer fractional shares to another address |
| `initiate_buyout` | Pay buyout price and claim NFT (requires ≥51% shares) |
| `redeem_shares` | Claim proportional payout after buyout |
| `get_vault` | Read vault details |
| `get_shares` | Read share balance for a holder |
| `get_vault_count` | Total vaults created |
| `get_vault_list` | Recent vault IDs (up to 20) |

## Build

```bash
cd contracts/nft-fractionalization
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
cargo test
```
