# Music licensing identifiers, agreements and publisher payments

The music contracts support metadata-backed licensing alongside the existing
playground APIs. Recording/work identifiers and publisher shares are stored
separately, preserving the existing `Track`, `Song` and `License` wire layouts.
Existing tracks and songs retain their original demonstration behavior.

## Metadata

`MusicMetadata` contains:

- `isrc`: 12 uppercase ASCII characters without separators: two country letters,
  three uppercase alphanumeric registrant characters, two year digits and five
  designation digits. Example: `USABC2600001`.
- `iswc`: `T` followed by nine work digits and a valid check digit, without dots
  or hyphens. Example: `T0345246801`. The check digit is
  `(10 - ((1 + sum(position * digit)) mod 10)) mod 10`, with positions 1 through 9.
- `publisher_splits`: 1–16 unique Stellar recipient addresses with positive
  integer basis-point shares totaling exactly 10,000. The artist authenticates
  the metadata registration. Splits are immutable after registration.

These fields provide standardized identifier syntax and a publisher routing
table. They do not certify copyright ownership, allocate a new ISRC/ISWC, implement
a complete DDEX message exchange, or contact a registry/distributor. Supply assigned
identifiers and legally agreed shares. Example identifiers are synthetic fixtures.

## Typed agreements and purchase

`LicenseTerms` contains a `kind` (`Sync` or `CommercialPerformance`), an uppercase
two-letter territory or `WORLD`, an HTTPS `terms_uri` of at most 256 bytes, and
`duration_seconds` from 3,600 to 315,360,000 inclusive. URLs with embedded user-info,
whitespace or backslashes are rejected. The contract never fetches agreement URLs.
The URI references the legal synchronization or commercial public-performance
agreement; the enum is not a determination of legal permission.

The artist specifies a SEP-41 payment token and a positive integer atomic price.
Use the intended USDC asset contract and its seven-decimal atomic units for USDC
offers; the contract does not infer currency from a token's display symbol.

For `music-licensing`:

1. Initialize with `init` as before.
2. Call `register_track_with_metadata(artist, title, price, metadata, terms,
   payment_token)`. The artist must authorize registration.
3. The buyer authorizes `purchase_rights_license(buyer, track_id)`. It collects
   the offer price once and routes it to the publisher table.
4. Read `get_track_rights` or `get_rights_license` for the metadata, terms,
   payment receipt and expiration timestamp. Duration begins at purchase.

For `music-royalty`:

1. Initialize with `initialize` as before.
2. Call `register_song_with_metadata(artist, song_id, title, metadata)`.
3. The registered artist authorizes `issue_rights_license(artist, song_id,
   licensee, terms, payment_token, price)`. It records an inactive offer, with
   expiration measured from issuance. The first valid offer permanently pins
   the song's payment token; later offers for that song must use the same token.
4. The licensee authorizes `purchase_rights_license(song_id, licensee)` before
   expiration. Payment activates the license and increases the song's verified
   paid royalty total. `get_rights_agreement` returns the immutable terms and
   purchase status. At the exact expiration timestamp, purchase is rejected.

`get_song_payment_token(song_id)` returns that token, or `None` before the first
valid offer. Read revenue counters in this token's atomic units. Different songs
may use different tokens, but a song cannot combine currencies in its total.
The purchase path also checks the pinned token before changing revenue or making
transfers. Failed issuance cannot pin a token, and expiration does not reset it.

Each track/buyer or song/licensee pair can purchase once. An unsuccessful payment
leaves the license unpurchased and may be retried after correcting funding.
Legacy demonstration entry points cannot bypass payment or fabricate earnings
for metadata-backed registrations. Existing registrations without metadata retain
their original entry points and responses.

## Rounding and atomic rollback

All payments use integer token units. Each publisher except the final one receives
`floor(price * share / 10000)`; the final publisher receives the remainder. The
implementation avoids multiplication overflow even at `i128::MAX`. Publisher
order is part of the authenticated table; the final publisher receives rounding
units. Zero allocations make no transfer.

For a price of 101 atomic units and shares 6,000/4,000, receipts are 60 and 41.
For a one-unit price, they are 0 and 1. The sum always equals the buyer's debit.
The contract rejects itself as a payer or publisher recipient, retains no part of this payment and does not spend a prefunded
treasury balance. Buyer authorization, collection, publisher transfers and license
state changes occur in one Soroban invocation. A failure at any recipient rolls
back all transfers and the license record, including earlier recipients.

Before this change, license purchases recorded a license without transferring
funds and royalty distribution only updated counters. The new APIs produce
verifiable token balance changes and a metadata-backed license; no live deployment
or funded-state migration is performed by this repository change.

## New errors

Existing royalty error numbers 1–15 remain unchanged. Metadata-backed APIs return
the following `RightsError` codes; messages never echo supplied identifiers or URLs.

| Code | Name | Corrective action |
| --- | --- | --- |
| 101 | `InvalidIsrc` | Supply the canonical 12-character recording identifier. |
| 102 | `InvalidIswc` | Supply the canonical work identifier with a valid check digit. |
| 103 | `InvalidSplits` | Use 1–16 positive shares totaling 10,000. |
| 104 | `DuplicatePublisher` | Include each publisher address once. |
| 105 | `InvalidAgreement` | Correct the territory, HTTPS URI or duration; use the rights purchase API. |
| 106 | `InvalidAmount` | Supply a positive atomic price within `i128`. |
| 107 | `MetadataNotFound` | Register metadata before offering or purchasing rights. |
| 108 | `Unauthorized` | The registered artist must issue the agreement. |
| 109 | `PaymentFailed` | Check buyer balance, token contract and recipient authorization. |
| 110 | `Overflow` | Correct the price, accumulated amount or timestamp. |
| 111 | `AlreadyRegistered` | Use a new registration or avoid repeating an existing offer/purchase. |
| 112 | `InvalidTitle` | Supply a nonempty title of at most 200 bytes. |
| 113 | `LicenseNotFound` | Issue/purchase the agreement first. |
| 114 | `LicenseExpired` | The offered agreement is no longer purchasable. |
| 115 | `Paused` | Wait for the licensing contract administrator to unpause. |
| 116 | `NotInitialized` | Initialize the contract first. |
| 117 | `InvalidSongId` | Supply a nonempty song ID of at most 100 bytes. |
| 118 | `PaymentTokenMismatch` | Use the song's pinned payment token. |

Legacy accounting/issuance calls on metadata-backed songs return existing
`Unauthorized` (5). Missing Soroban account authorization is a host authorization
failure; connecting a wallet does not substitute for signing.

## Focused verification

```sh
cargo test --locked -p music-licensing -p music-royalty
cargo clippy --locked -p music-licensing -p music-royalty --all-targets -- -D warnings
cargo build --locked -p music-licensing -p music-royalty --target wasm32v1-none --release
```

Tests use generated addresses and local Stellar Asset Contracts only. They cover
both agreement kinds, single-asset revenue and rejected mixed-asset offers,
invalid identifiers/check digits, invalid publisher tables,
failed payment rollback, repeat purchases, authorization and expiry boundaries,
and one-unit/maximum-integer allocation alongside existing music contract tests.

Use `wasm32v1-none` with current Rust for these SDK 21 crates. Locally, artifacts
built with Rust 1.98.1 for `wasm32-unknown-unknown` compiled but failed SDK 21 host
registration because their reference-types encoding is unsupported. The same
contracts built for `wasm32v1-none` registered successfully. The existing workspace
CI command still selects `wasm32-unknown-unknown`; this change does not modify
repository-wide toolchains or workflows.
