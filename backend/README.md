# Backend API

## Compile

- URL: `POST /api/compile`
- Body:

```json
{
  "code": "<Rust source for src/lib.rs>",
  "dependencies": {
    "serde": "1.0",
    "serde_json": "^1.0"
  }
}
```

- Notes:
  - `dependencies` is optional. When present, items are injected under the `[dependencies]` section of `Cargo.toml`.
  - `soroban-sdk` is pinned by the backend and cannot be overridden.

- Validation:
  - Crate names: lowercase `[a-z0-9][a-z0-9_-]{0,63}`.
  - Versions: only characters `[0-9A-Za-zxX.^~* <>=,+-]` and spaces; max length 50.
  - Max dependencies: 20.
  - Disallows quotes, brackets, or newlines in names/versions.

- Errors:
  - `400` when code is missing or dependency input is invalid (details included).
  - `400` when dependency payload cannot be safely transformed into `Cargo.toml`.
  - `500` on compilation failures (stderr/diagnostics included).
