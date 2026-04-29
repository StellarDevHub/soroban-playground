# Contract Examples

This folder is the home for small Soroban contract examples used by the playground.

The goal is to give contributors a simple place to add contracts that are easy to read, build locally, and reuse while testing the project.

## Purpose

Each directory inside `contracts/` should be one self-contained contract example.

Examples in this area should be:

- Small and beginner-friendly
- Focused on one contract idea or feature
- Independent from other examples
- Ready to build locally

Current example:

- `hello-world/`: a minimal Soroban contract with its own README
- `patent-registry/`: decentralized invention registration, verification, and licensing

## Recommended structure

Create a new directory for each example:

```text
contracts/
  example-name/
    README.md
    Cargo.toml
    src/
      lib.rs
```

What each file is for:

- `README.md`: explains what the contract does and how to use it
- `Cargo.toml`: Rust package configuration for that example
- `src/lib.rs`: the contract source code

## Organization guidelines

To keep this folder easy to browse and maintain:

- Use short, descriptive names such as `hello-world` or `counter`
- Keep one example contract per directory
- Include a `README.md` in every example directory
- Keep examples focused instead of combining unrelated ideas

## Local usage

To try an example locally, start at the repository root and move into the example you want to build.

Example:

```bash
cd contracts/hello-world
cargo build --target wasm32-unknown-unknown --release
```

After the build finishes, Cargo will place the compiled WASM artifact in that example's `target` directory.

## Adding a new example

If you want to contribute a new contract example:

1. Create a new folder inside `contracts/`.
2. Add the contract files for that example.
3. Add a short README that explains the contract in simple language.
4. Keep the example small enough for a first-time contributor to follow.
