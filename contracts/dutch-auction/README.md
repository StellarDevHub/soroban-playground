# Collateralized sealed-bid auction

This example keeps the `DutchAuction` contract/package name for discoverability,
but replaces the former immediate-purchase API with a **first-price sealed-bid**
auction. This is a breaking interface change: deploy a new instance and update
clients. It does not migrate deployed storage or outstanding assets.
The unrelated `contracts/cartel` staking/proposal DAO is unchanged.

## Lifecycle and API

One contract instance hosts one immutable auction.

| Method | Behavior |
| --- | --- |
| `initialize(config)` | Seller authenticates, fixes terms and schedule, and escrows the NFT. |
| `commit_bid(bidder, commitment)` | Bidder authenticates and pays fixed collateral. One commitment per address; no replacement/cancellation. |
| `reveal_bid(bidder, amount, salt)` | Bidder authenticates and opens its commitment during the reveal phase. |
| `settle()` | Anyone settles after the final deadline. Highest valid revealed bid pays its own bid and receives the NFT. No valid reveals returns the NFT to the seller. |
| `claim_bid(bidder)` | Anyone triggers one claim to its recorded recipient. Returns the bidder's refund amount. |
| `get_auction()` / `get_bid(bidder)` | Read configuration, deadlines, public results and claim state. Unrevealed stored amounts are zero. |

The unsafe `buy`/`buy_with_refund` shortcuts and price-decay getters are removed;
they cannot bypass sealed bidding. `initialize` now takes `AuctionConfig`:

- `seller`, `token`: seller and Soroban payment-token addresses.
- `nft`, `nft_id`: NFT contract and `u64` ID. The adapter uses the
  `contracts/erc-721` interface: `owner_of(token_id)` and
  `transfer_from(caller, from, to, token_id)`. Initialization verifies ownership
  and transfers from seller to auction. Settlement transfers as the auction's
  own address. Other NFT interfaces need an adapter.
- `reserve`: strictly positive minimum valid bid.
- `collateral`: uniform deposit, at least the reserve, and maximum bid. Choose
  this cap to cover expected bids. Equal deposits hide amounts in token transfers.
- `start`, `commit_duration`, `reveal_duration`: ledger timestamp in seconds and
  positive phase durations. Start may be now or at most 30 days ahead.
- `extension_window`, `extension_seconds`, `max_extensions`: closing window,
  increment and cap **per phase** (0 disables, at most 10). When enabled the
  window/increment must be positive and the window must fit both initial phases.
  Initial durations plus all possible extensions must fit 30 days. Deadline
  arithmetic is checked at initialization.

Commit is `[start, commit_end)`; reveal is `[commit_end, reveal_end)`; settlement
starts at `reveal_end`. A new fully paid commitment in the final window extends
**both** deadlines so reveals never overlap new commitments. A valid first
reveal near closing extends only the reveal deadline. Invalid, duplicate and
unfunded calls do not extend anything. Caps prevent unlimited late-bid lockup.
Ties follow earliest **commit** order, independent of reveal order. The seller
cannot bid, change terms, cancel bids, settle early or reclaim escrow early.

## Constructing a commitment

Generate a fresh unpredictable 32-byte salt and keep it secret until reveal.
Encode this tuple as a Soroban **XDR ScVal**, then SHA-256 its encoded bytes:

```text
(
  Symbol("bid_v1"),
  BytesN<32>(network_id),
  Address(auction_contract),
  Address(bidder),
  i128(amount),
  BytesN<32>(salt)
)
```

The tuple is an ScVal vector; addresses and integers use XDR ScVal types, not
strings or concatenated bytes. `network_id` is SHA-256 of the network passphrase.
`bid_commitment` in `src/lib.rs` is the native Rust reference helper, deliberately
not an on-chain entry point. Compute locally: publishing amount/salt in a
transaction before reveal defeats secrecy. Domains prevent copying another
bidder's hash or replaying it on another deployment/network.
Only amounts in `[reserve, collateral]` can be revealed. Wrong amount/salt leaves
the commitment unrevealed; a correct retry is possible before closing.

## Escrow and forfeiture

Collateral stays locked until settlement. Settlement pays the seller the winning
bid and transfers the NFT atomically; failed token/NFT calls roll back the whole
invocation. Claims are separate constant-size operations:

- Revealed loser: full collateral refunded.
- Winner: collateral minus winning bid refunded.
- No valid reveal: entire collateral forfeited to the seller.

Anyone can claim a non-revealer's deposit for the seller, so refusing to call
cannot avoid forfeiture. No claim accepts a caller-chosen destination; double
claims fail. A failing claim does not block others. Bids use persistent storage;
written state extends TTL to the network maximum. Operators must still maintain
or restore archived code/state for delayed claims. No refund expiry/admin sweep.

Payment tokens and NFT adapters are immutable seller-selected dependencies.
Inspect them before bidding; the example assumes documented transfer semantics.
Uniform collateral imposes capital costs and a bid cap. Addresses do not prove
distinct people, and anti-sniping may reach its cap.

## Bidder-ring model and limits

Secrecy prevents observing amounts before committing. Full collateral makes fake
or abandoned commitments costly. First-price settlement means withholding a
losing bid cannot lower another bidder's payment. The reserve bounds minimum
sale proceeds.

The exhaustive ring test enumerates all 36 profiles for two ring members bidding
in `{10,20,30}`, all reveal/withhold subsets, and a fixed honest bid of 20. It
executes the actual contract with token/NFT fixtures and checks:

1. Highest revealed bid wins; sale proceeds cannot fall below the honest bid.
2. Each unrevealed commitment forfeits exactly its 100-unit collateral.
3. Token value is conserved and NFT ownership matches the winner.
4. With transferable coalition asset value 50 and fixed committed bids,
   withholding cannot improve joint payoff over revealing.

These exhaustively check a **bounded strategy model**, not global collusion
resistance or a VCG mechanism. Bidders can still coordinate low bids before
committing, abstain together, split identities, censor transactions, or arrange
off-chain transfers. First-price bidding is not dominant-strategy truthful.
Reserve selection and participation assumptions remain economic choices.

## Verification

From the repository root with Rust and the WASM target installed:

```sh
cargo test --locked -p soroban-dutch-auction-contract
cargo fmt -p soroban-dutch-auction-contract -- --check
cargo clippy --locked -p soroban-dutch-auction-contract --all-targets -- -D warnings
cargo build --locked -p soroban-dutch-auction-contract --release --target wasm32-unknown-unknown
```

Tests also cover authorization, copied/domain-separated commitments, exact phase
boundaries, reserve/collateral bounds, duplicate calls, tie-breaking, extension
caps, no-bid settlement, penalties, and failed-transfer rollback.
