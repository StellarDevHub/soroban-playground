# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage, hardened production image (issue #748).
#
# The API compiles Soroban contracts in-process (compileWorker spawns `cargo`),
# so the runtime must carry the Rust toolchain. That rules out Google Distroless
# and a <150MB image — both are incompatible with an in-container compiler. We
# instead harden a minimal Alpine runtime: production-only dependencies built in
# an isolated stage, a non-root user, no dev tooling, and a tini init. See the
# "Docker / production image" section of README.md for the read-only-fs run
# recipe and the full security rationale.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1 — install production dependencies only (native modules like sqlite3
# are compiled here, so the toolchain never ships in the final image).
# (The backend is an npm workspace member; the lockfile lives at the repo root,
# so a ./backend build context has only package.json — npm install is used.)
FROM node:20-alpine3.20 AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
# Drop the root `prepare` (lint/format) lifecycle — it needs dev tooling — while
# keeping dependency install scripts so native modules (sqlite3) still compile.
RUN npm pkg delete scripts.prepare \
    && npm install --omit=dev --no-audit --no-fund

# Stage 2 — local development image (hot reload via nodemon). Targeted by
# docker-compose; not the default build. Includes dev dependencies and the build
# toolchain so source can be volume-mounted.
FROM node:20-alpine3.20 AS dev
WORKDIR /app
ENV NODE_ENV=development
RUN apk add --no-cache python3 make g++ rust cargo openssl libgcc libstdc++ \
    ca-certificates curl tini
COPY package.json ./
RUN npm pkg delete scripts.prepare \
    && npm install --no-audit --no-fund
COPY . .
RUN mkdir -p logs cache
EXPOSE 5000
ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "dev"]

# Stage 3 — runtime. Only the production node_modules and the files the server
# actually needs are copied in; tests, configs and dev tooling are excluded via
# .dockerignore.
FROM node:20-alpine3.20 AS runtime

# Patch the base image and install only what the running service requires:
# the Rust toolchain for contract compilation, TLS/cert libs, the C++ runtime
# for the prebuilt native modules, curl for the healthcheck, and tini as PID 1.
RUN apk upgrade --no-cache && apk add --no-cache \
    rust \
    cargo \
    openssl \
    libgcc \
    libstdc++ \
    ca-certificates \
    curl \
    tini

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Application code and the runtime files the server needs (the schema in
# src/database is required by initializeDatabase()).
COPY package.json ./
COPY src ./src
COPY migrations ./migrations

# Writable dirs for logs and the cargo build cache, owned by the non-root user.
RUN mkdir -p logs cache && chown -R node:node /app

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:5000/api/health || exit 1

# tini reaps the cargo child processes the server spawns.
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/server.js"]
