# Freelancer Identity Contract

Soroban contract for decentralized freelancer profiles, portfolio verification,
skill endorsements, emergency pause, and wallet recovery.

## Core Calls

- `initialize(admin, recovery)`: sets administrator and recovery authority.
- `set_paused(admin, paused)`: emergency stop for user mutations.
- `set_verifier(admin, verifier, active)`: grants or removes portfolio verifier access.
- `register_profile(owner, display_hash, portfolio_hash)`: creates a freelancer profile.
- `update_portfolio(owner, portfolio_hash)`: rotates the portfolio metadata hash.
- `verify_portfolio(verifier, freelancer, project_hash, evidence_hash, score)`: records a verified project and increases reputation.
- `endorse_skill(endorser, subject, skill_hash, evidence_hash, weight)`: records a skill endorsement.
- `revoke_endorsement(admin, endorsement_id)`: marks an endorsement as revoked.
- `recover_profile(recovery, old_owner, new_owner)`: migrates a profile after wallet rotation.

## Events

The contract emits compact Soroban events for critical actions:

- `init`
- `paused`
- `verifyr`
- `profile`
- `port_upd`
- `verif`
- `endorse`
- `rev_end`
- `deact`
- `recover`

## Security Notes

- Admin-only controls protect pause, verifier management, admin transfer, and endorsement revocation.
- Verifier-only portfolio verification separates identity ownership from attestation authority.
- User calls require owner or endorser authorization.
- Pause blocks user mutations while keeping read calls available.
- Wallet recovery requires the configured recovery signer and deactivates the old owner profile.
- Inputs reject empty hashes, invalid scores, invalid endorsement weights, and self-endorsements.

## Testing

Run from this directory when the Rust toolchain is available:

```bash
cargo test
```
