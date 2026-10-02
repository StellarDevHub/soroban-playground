### Build Optimization Plan

### Identified Issues

- Deprecated `whatwg-encoding` package (replace with `@exodus/bytes`)
- Outdated `@types/react-window` type definitions
- Annual Next.js telemetry opt-in UI
- Root `Cargo.toml` release profile not tuned for WASM size (binaries exceeding 64KB)

### Recommended Actions

1. Update dependencies:
   - Replace `whatwg-encoding` with `@exodus/bytes` (warning suggests this is faster and spec-compliant)
   - Remove `react-window` types (user-provided definitions exist)
   - Run `npm install` to apply updates
2. Address telemetry:
   - Review opt-in URL ([nextjs.org/telemetry](https://nextjs.org/telemetry)) to confirm consent status
   - Update Vercel config if telemetry needs to be disabled
3. Tune root `Cargo.toml` release profile for WASM size:
   - Set `[profile.release]` with `opt-level = "z"`, `codegen-units = 1`, `lto = true`, `panic = "abort"`, `strip = "symbols"`
   - Enable `[workspace.metadata].release.lto = true` to apply LTO across all workspace members
   - Enable `[profile.release.package]` overrides where needed for `wasm-bindgen-start` and `cap-npa` crates
4. Verify binary sizes:
   - Add a check that fails when any compiled `.wasm` artifact exceeds 64KB
   - Run `wasm-opt -os -o out.wasm in.wasm` as a post-build size pass
5. Run lint/verify:
   - Execute `npm run lint` and `npm run typecheck` to validate changes
   - Execute `cargo test --workspace` and `cargo build --release --target wasm32-unknown-unknown`
6. Rebuild and test:
   - Run `vercel build` again to verify fix

### Prerequisites

- Ensure npm is updated to latest version
- Confirm project dependencies are compatible with Next.js 16.2.6
- Ensure the `wasm32-unknown-unknown` target is installed (`rustup target add wasm32-unknown-unknown`)
- Ensure `binaryen` or `cargo-binary-size` is available for size reporting

### Deliverables

- Clean build with no deprecation warnings
- Updated dependency manifests (`package.json`)
- Telemetry configuration confirmed
- Root `Cargo.toml` release profile tuned for WASM size
- All compiled binaries verified under 64KB
- 64KB size regression guard wired into CI
- Unit and integration tests covering profile configuration and size limits

### Owner

Kilo<br>Plan Date: 2026-06-12
