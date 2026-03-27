FROM node:20-alpine AS base
WORKDIR /app

# Install backend dependencies
COPY package.json .
COPY package-lock.json .
RUN npm ci

# Copy source files
COPY . .

EXPOSE 5000

# Use nodemon for hot‑reloading of server code
CMD ["npm", "run", "dev"]
