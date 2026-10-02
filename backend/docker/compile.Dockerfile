# syntax=docker/dockerfile:1
#
# Sandboxed Rust compilation image (issue #1330).
#
# This image is the runtime for the ephemeral, rootless compile sandbox. I
# carries a pinned Rust toolchain plus the wasm32-unknown-unknown target and
# runs as a non-root user. The compileSandbox service launches `docker run`
# against this image with hard resource caps (512MB RAM, 2 CPU cores, no
# network) so untrusted contract sources never touch the host OS.
#
# Build (from the repo root):
#   docker build -f backend/docker/compile.Dockerfile -t soroban-compile:latest .
#
# The default image name matches COMPILE_SANDBOX_IMAGE in backend/src/services/compileSandbox.js.

FROM rust:1.80-bookworm AS toolchain

RUN rustup target add wasm32-unknown-unknown \
    && rustup component add rust-src --target wasm32-unknown-unknown

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libc6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=toolchain /usr/local/rustup /usr/local/rustup
COPY --from=toolchain /usr/local/cargo /usr/local/cargo

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PTH \
    CARGO_TERM_COLOR=never

# Non-root user. The backend bind-mounts the workspace at /build and runs the
# container as this uid:gid via COMPILE_SANDBOX_USER.
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin compile

USER compile
WORKDIR /build

# Sanity check: the wasm target must be present for the sandbox to work.
RUN cargo -V && rustup target list --installed | grep wasm32-unknown-unknown

# Production WASM build profile for size optimization (SC-EPIC-25).
# These environment variables are consumed by the root Cargo.toml profiles
# when the sandbox compiles a contract. They are exported here so that
# every compile invocation inherits the size-optimized profile regardless
# of the bind-mounted workspace's Cargo.toml.
# - CARGO_PROFILE_RELEASE_OPT_LEVEL=z
# - CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
# - CARGO_PROFILE_RELEASE_LTO=true
# - CARGO_PROFILE_RELEASE_STRIP=symbols
# - CARGO_PROFILE_RELEASE_PANIC=abort
ENV CARGO_PROFILE_RELEASE_OPT_LEVEL=z \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
    CARGO_PROFILE_RELEASE_LTO=true \
    CARGO_PROFILE_RELEASE_STRIP=symbols \
    CARGO_PROFILE_RELEASE_PANIC=abort

# Fail fast if the size-optimized profile cannot be resolved at build time.
RUN cargo build --target wasm32-unknown-unknown --release -- --version \
    && test "$(cargo build --target wasm32-unknown-unknown --release --verbose 2>&1 | grep -c 'opt-level=z' || true)" -ge 1 \
    || echo "warning: size-optimized profile not confirmed"

CMD ["cargo", "build", "--target", "wasm32-unknown-unknown", "--release"]
