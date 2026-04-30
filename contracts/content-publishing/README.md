# Content Publishing

Soroban smart contract for the Decentralized Content Publishing Platform — authors register channels, publish articles (referenced by content hash), collect tips, and sell time-bounded subscriptions. Per-author analytics and a bounded "latest" feed are maintained on-chain so a frontend can render a creator dashboard without an indexer.

## Build

```bash
cargo check --target wasm32-unknown-unknown
cargo test
```

## Public functions

| Function | Caller | Purpose |
| --- | --- | --- |
| `initialize(admin)` | deployer | one-time admin bootstrap |
| `set_paused(caller, paused)` | admin | emergency stop |
| `register_author(author, name, bio, sub_price, period_seconds)` | author | create channel |
| `update_author(author, name, bio, sub_price, period_seconds)` | author | edit channel |
| `publish(author, title, content_hash, premium)` | author | publish article |
| `record_view(reader, id)` | reader | bump view counter; gated for premium |
| `like(reader, id)` | reader | like (idempotent per reader) |
| `tip(from, article_id, amount)` | reader | record a tip |
| `subscribe(subscriber, author, periods)` | subscriber | buy / extend a subscription |
| `get_*` | anyone | read profile / article / stats / feed |

## Errors

`AlreadyInitialized`, `NotInitialized`, `Unauthorized`, `Paused`, `AuthorNotFound`, `AuthorAlreadyRegistered`, `ArticleNotFound`, `InvalidAmount`, `SelfTipForbidden`, `SelfSubscribeForbidden`, `SubscriptionNotFound`, `PremiumRequiresSubscription`, `AlreadyLiked`.

## Events

* `("publish", author) → article_id`
* `("tip", author, article_id) → (from, amount)`
* `("subscribe", author, subscriber) → (cost, expires_at)`
* `("like", author, article_id) → reader`
* `("pause", caller) → bool`

## Security notes

* `require_auth` is enforced on every state mutation.
* All errors are typed; no raw `panic!` strings are used.
* Authors cannot tip their own articles or subscribe to themselves (prevents wash metrics).
* The contract is asset-agnostic — token transfers are settled by the wrapping client (e.g. classic Stellar payment, or a token-contract `transfer` invocation in the same transaction). The on-chain bookkeeping in `tip` / `subscribe` only records the amounts that should have been paid; pair them with a token transfer in the same auth bundle in production.
* Admin can pause the contract; while paused, all mutations short-circuit with `Error::Paused`.
