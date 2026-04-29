# Content Publishing Contract

A Soroban smart contract for a decentralized content publishing platform with a tip jar and subscriber analytics. Authors publish content on-chain (via content hashes), readers can tip authors directly, and subscribers receive on-chain tracking.

## Features

- **Content publishing** — store title and body hashes (IPFS CIDs) on-chain
- **Tip jar** — readers send XLM/token tips directly to authors
- **Subscriber tracking** — on-chain subscription records with analytics
- **Access control** — authors can remove their own content; admin can remove any
- **Emergency pause** — admin can pause all write operations
- **Platform analytics** — aggregate stats: total content, tips, subscriptions
- **Event emissions** — `publish`, `tip`, `subscribe`, `unsub`, `removed`, `paused`
- **Security** — checks-effects-interactions pattern on tip transfers; self-tip prevention

## Functions

| Function | Description |
|---|---|
| `initialize` | Set up the platform admin |
| `publish_content` | Publish a new content item (stores hashes) |
| `tip_author` | Send a token tip to a content author |
| `subscribe` | Subscribe to an author |
| `unsubscribe` | Unsubscribe from an author |
| `remove_content` | Remove content (author or admin) |
| `set_paused` | Pause/resume the platform (admin only) |
| `get_content` | Read content by ID |
| `get_subscription` | Check subscription status |
| `get_subscriber_count` | Get subscriber count for an author |
| `get_content_count` | Total content published |
| `get_platform_stats` | Platform-wide analytics |

## Build

```bash
cd contracts/content-publishing
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
cargo test
```
