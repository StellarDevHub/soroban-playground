'use strict';

/**
 * server.js  ─  Integration guide for cluster mode
 * ──────────────────────────────────────────────────────────────────────────────
 * This file shows exactly what to ADD to your existing backend/src/server.js
 * (or wherever your Express/GraphQL HTTP server is created and started).
 *
 * Search for the ── ADD ── sections and apply the same changes to the real file.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── ADD (1): Import the cluster worker helper ─────────────────────────────────
const {
  log,
  attachGracefulShutdown,
  assertExternalSessionStore,
} = require('./cluster/clusterWorker');

// ── EXISTING: your normal imports (example) ───────────────────────────────────
const express  = require('express');
const session  = require('express-session');
const RedisStore = require('connect-redis').default;   // npm i connect-redis
const { createClient } = require('redis');             // npm i redis

// ── ADD (2): Create and connect the Redis client ──────────────────────────────
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch((err) => log(`Redis connection error: ${err.message}`, 'error'));
redisClient.on('error', (err) => log(`Redis error: ${err.message}`, 'error'));

// ── EXISTING: build your Express app ─────────────────────────────────────────
const app = express();

app.use(express.json());

// ── ADD (3): Use Redis-backed sessions (required in cluster mode) ─────────────
const sessionOptions = {
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' },
};

// ── ADD (4): Assert external session store before mounting ────────────────────
assertExternalSessionStore(sessionOptions);

app.use(session(sessionOptions));

// ── EXISTING: your routes / GraphQL / etc. go here ───────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    pid: process.pid,
    worker: require('cluster').worker?.id ?? 'standalone',
  });
});

// ── ADD (5): Start the server and wire up graceful shutdown ───────────────────
const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  log(`HTTP server listening on port ${PORT} (PID ${process.pid})`);
});

// ── ADD (6): Drain in-flight requests before this worker exits ────────────────
attachGracefulShutdown(server, { drainTimeout: 5000 });

module.exports = { app, server };