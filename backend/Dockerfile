# Stage 1: Build dependencies
FROM node:20-alpine AS builder
WORKDIR /app

# Install build tools for node-gyp
RUN apk add --no-cache \
    python3 \
    make \
    g++

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Runtime image
FROM node:20-alpine
WORKDIR /app

# Install runtime dependencies: Rust/Cargo for contract compilation, 
# and other libraries needed for Soroban CLI and Node.js addons.
RUN apk add --no-cache \
    rust \
    cargo \
    openssl \
    libgcc \
    libstdc++ \
    ca-certificates \
    curl

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

# Create logs directory and set permissions
RUN mkdir -p logs && chown -R node:node /app

USER node

EXPOSE 5000

ENV NODE_ENV=development

# Use development command as default
CMD ["npm", "run", "dev"]
