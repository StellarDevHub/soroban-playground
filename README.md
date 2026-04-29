# Soroban Playground

Soroban Playground is a browser-based workspace for writing, compiling, deploying, and exploring Stellar Soroban smart contracts. This repo includes a Next.js frontend, an Express backend, and a growing set of Rust contract examples.

## Core Stack

- `frontend/`: Next.js app-router UI and interactive dashboards
- `backend/`: Express APIs for compile, deploy, invoke, search, and feature demos
- `contracts/`: Self-contained Soroban contract examples compiled to WASM

## Patent Registry Feature

Issue `#350` adds a smallest-complete decentralized patent workflow that fits the existing playground architecture.

### Architecture Summary

- Smart contract: `contracts/patent-registry/`
  - Patent registration and owner-managed updates
  - Verifier or admin approval flow
  - License offer creation, update, and acceptance
  - Pause and unpause emergency control
- Backend: `backend/src/routes/patents.js` + `backend/src/services/patentRegistryService.js`
  - REST endpoints for patents, licenses, dashboard state, and history
  - Validation and rate limiting via existing middleware patterns
  - Lightweight cache integration for dashboard and list endpoints
- Frontend: `frontend/src/app/patents/page.tsx`
  - Responsive patent registry dashboard
  - Patent registration and update forms
  - Verification controls
  - Licensing marketplace and transaction history

## Patent API Usage

Base path: `/api/patents`

- `GET /api/patents`
  Returns patents, offers, history, and verifier config
- `GET /api/patents/items`
  Lists patents with optional `owner` and `verificationStatus` filters
- `POST /api/patents/items`
  Registers a new patent
- `PATCH /api/patents/items/:id`
  Updates a patent. Requires `x-actor-address` header for owner authorization
- `POST /api/patents/items/:id/verify`
  Verifies a patent. Requires verifier or admin actor header
- `GET /api/patents/licenses`
  Lists license offers
- `POST /api/patents/licenses`
  Creates a license offer
- `PATCH /api/patents/licenses/:id`
  Updates open license terms
- `POST /api/patents/licenses/:id/accept`
  Accepts an open offer
- `GET /api/patents/history`
  Returns backend transaction history

## Contract Functions

The patent contract exposes these main functions:

- `initialize(admin, verifier)`
- `register_patent(owner, title, description, content_hash, metadata_uri)`
- `update_patent(owner, patent_id, title, description, content_hash, metadata_uri)`
- `verify_patent(verifier, patent_id)`
- `create_license_offer(owner, patent_id, terms_uri, payment_amount, payment_token)`
- `update_license_offer(owner, offer_id, terms_uri, payment_amount, payment_token)`
- `accept_license_offer(licensee, offer_id)`
- `pause(admin)`
- `unpause(admin)`

## Local Setup

### Prerequisites

- Node.js 18+
- npm
- Rust toolchain
- Soroban CLI

### Run Frontend

```bash
cd frontend
npm install
npm run dev
```

### Run Backend

```bash
cd backend
npm install
npm run dev
```

Optional environment variables for the patent module:

- `PATENT_ADMIN_ADDRESS`
- `PATENT_VERIFIER_ADDRESS`
- `NEXT_PUBLIC_API_URL`

### Test Contract

```bash
cd contracts/patent-registry
cargo test
```

## Troubleshooting

- If the patent dashboard shows offline, confirm the backend is running on `http://localhost:5000`.
- If verification fails, use the configured verifier or admin address returned by `GET /api/patents/config`.
- If contract invocation is required for other playground flows, make sure Soroban CLI and the Stellar testnet source account are configured in the backend environment.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
