# Decentralized Freelancer Identity

## Architecture

```text
React dashboard
  | REST + WebSocket refresh
Backend /api/freelancer-identity
  | profile cache, validation, analytics events
Soroban freelancer-identity contract
  | profiles, verifications, endorsements, pause, recovery
Stellar testnet deployment
```

## API Examples

Create a profile:

```bash
curl -X POST http://localhost:5000/api/freelancer-identity/profiles \
  -H "Content-Type: application/json" \
  -d '{"owner":"G...","handle":"soroban-dev","portfolioUrl":"https://example.com","skills":["Rust","Soroban"]}'
```

Verify portfolio work:

```bash
curl -X POST http://localhost:5000/api/freelancer-identity/portfolio-verifications \
  -H "Content-Type: application/json" \
  -d '{"owner":"G...","verifier":"GVERIFIER...","projectUrl":"https://example.com/work","evidenceUrl":"https://example.com/proof","score":92}'
```

Endorse a skill:

```bash
curl -X POST http://localhost:5000/api/freelancer-identity/skill-endorsements \
  -H "Content-Type: application/json" \
  -d '{"owner":"G...","endorser":"GENDORSER...","skill":"Soroban","evidenceUrl":"https://example.com/review","weight":7}'
```

## Deployment Guide

1. Build the contract from `contracts/freelancer-identity`.
2. Deploy the WASM to testnet with the project deploy flow.
3. Call `initialize(admin, recovery)`.
4. Register trusted verifier addresses with `set_verifier(admin, verifier, true)`.
5. Start the backend and frontend with the existing project scripts.

## Troubleshooting

- `Paused`: admin must call `set_paused(admin, false)`.
- `Unauthorized`: check admin, verifier, or recovery signer.
- `ProfileAlreadyExists`: rotate via `recover_profile` instead of registering again.
- Empty or zero hashes: hash off-chain metadata before submitting to the contract.
