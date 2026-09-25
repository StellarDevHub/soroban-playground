# guess-the-number

> **⚠️ This is a reference/example contract for learning purposes only.**
> It is NOT included in any production deployment and is NOT meant to be deployed to mainnet.

## Purpose

`guess-the-number` is a minimal on-chain guessing game that demonstrates Soroban basics:

- Contract initialisation and admin patterns
- Instance storage reads/writes
- Commit-reveal pattern (hashing the answer instead of storing it in plaintext)
- Event emission
- `require_auth()` for player and admin authorization

It is intended as a learning aid for developers new to Soroban smart contracts.

## Production deployment scope

**This contract is explicitly excluded from production deployments.**

The `deploy_all.sh` script at the repo root deploys all compiled `.wasm` files found under `contracts/`.
To avoid accidentally deploying this example, **do not build this contract for release** outside of
local development:

```bash
# Only build for testing (never for a production deploy run)
cargo test -p guess-the-number
```

If you need to demonstrate this contract on testnet for educational purposes, deploy it manually
and **do not** include it in any automated deployment pipeline.

## No debug backdoors

This contract intentionally omits any `get_answer`, `reveal_answer`, or similar function.
The secret answer is committed as a SHA-256 hash; the plaintext is never stored on-chain.
The absence of a reveal function is tested in `src/test.rs::no_get_answer_backdoor_exists`.

## How it works

1. An admin calls `initialize(admin, answer_hash, max_guesses)` with the SHA-256 hash of the
   secret number.  The hash is computed off-chain; the plaintext is never sent to the contract.
2. Players call `guess(player, candidate_hash)` with the SHA-256 hash of their guessed number.
   The contract compares hashes.
3. If correct, `GameResult::Correct` is returned and the game is marked solved.
4. If wrong, `GameResult::Wrong { guesses_left }` is returned.
5. After `max_guesses` wrong attempts, further guesses are rejected.
6. The admin can reset the game with a new hash via `reset(admin, new_answer_hash, max_guesses)`.

## Security limitations

- A determined attacker can brute-force a small integer range (e.g. 1–1000) off-chain.
- This is **intentional** for a teaching example — the point is to learn Soroban patterns,
  not to build a production-grade game.
- For a production guessing game, use a verifiable random function (VRF) and a proper
  commit-reveal scheme with player-provided randomness.

## Running tests

```bash
cd contracts/guess-the-number
cargo test
```

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin, answer_hash, max_guesses)` | Admin (once) | Set up the game |
| `guess(player, candidate_hash)` | Any (auth) | Submit a guess |
| `reset(admin, new_answer_hash, max_guesses)` | Admin only | Start a new round |
| `guess_count()` | Read | Guesses used so far |
| `max_guesses()` | Read | Maximum allowed guesses |
| `guesses_remaining()` | Read | Guesses left |
| `is_solved()` | Read | Whether the game has been solved |
