# Use an official Node runtime as a parent image
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Install dependencies (only package.json needed for caching)
COPY package.json .
COPY package-lock.json .
RUN npm ci

# Copy the rest of the source code
COPY . .

# Expose Next.js default port
EXPOSE 3000

# Enable polling for file changes inside Docker (required for hot‑reload)
ENV CHOKIDAR_USEPOLLING=true

# Start the development server with hot‑reloading
CMD ["npm", "run", "dev"]
