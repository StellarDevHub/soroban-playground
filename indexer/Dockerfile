# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Indexer service container definition (issue #1327).
#
# The indexer is a Rust/axum service that ingests Soroban contract events and
# exposes them over WebSocket + GraphQL. Previously docker-compose.yml built it
# from ./indexer/Dockerfile, which did not exist, so `docker compose up --build`
# failed immediately. This file fixes that.
#
# Three stages:
#   * planner  - runs `cargo chef prepare` to snapshot the dependency graph.
#   * builder  - `cargo chef cook` compiles dependencies once so they are
#                cached in the image, then builds the release binary. This is
#                the "cached dependency compilation" required by the issue.
#   * runtime  - slim Debian image with only the libraries the service needs
#                at run time, a non-root appuser (uid 10001), port 3001 and a
#                /health HEALTHCHECK. The binary is installed into
#                /usr/local/bin so the compose bind-mount of ./indexer:/app
#                never hides it.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1 — dependency snapshot. Only Cargo manifests are copied, so the
# chef recipe stays small and cacheable.
FROM rust:1.80-bookworm AS planner
WORKDIR /app
RUN cargo install cargo-chef --locked
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2 — dependency cache + release build. `cargo chef cook` compiles every
# dependency once; the resulting layer is reused unless Cargo.toml changes.
FROM rust:1.80-bookworm AS builder
WORKDIR /app
RUN cargo install cargo-chef --locked
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release --bin soroban-indexer

# Stage 3 — runtime. Only the binary plus the libraries the service needs.
# libssl-dev + libsqlite3-dev keep sqlx (rustls/sqlite/postgres) happy;
# ca-certificates are required for TLS; curl backs the /health HEALTHCHECK.
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libssl-dev \
        libsqlite3-dev \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root runner (issue #1327 requires appuser:10001).
RUN useradd --create-home --uid 10001 appuser

WORKDIR /app

COPY --from=builder /app/target/release/soroban-indexer /usr/local/bin/soroban-indexer

# The compose file bind-mounts ./indexer:/app and a named volume at /app/data
# (the default DATABASE_URL is sqlite:///app/data/indexer.db).
RUN mkdir -p /app/data && chown -R appuser:appuser /app

USER appuser

ENV WS_PORT=3001
ENV RUST_LOG=info

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:3001/health || exit 1

CMD ["soroban-indexer"]
