FROM node:20-alpine AS base
WORKDIR /app

# Install system dependencies for Rust and compilation
RUN apk add --no-cache \
    curl \
    build-base \
    gcc \
    musl-dev \
    libffi-dev \
    openssl-dev \
    pkgconfig \
    rust \
    cargo

# Ensure the WASM target is available. 
# In Alpine, we typically use the rust-src and then target add if rustup is used,
# but since we are using apk packages, we check the target.
RUN rustc --version && cargo --version

# Install backend dependencies
COPY package.json .
COPY package-lock.json .
RUN npm ci

# Copy source files
COPY . .

EXPOSE 5000

# Use nodemon for hot‑reloading of server code
CMD ["npm", "run", "dev"]
