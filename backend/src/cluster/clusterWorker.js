import cluster from 'cluster';

/**
 * Send a log message to the master process (or fall back to console).
 */
export function log(text, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = `${ts} [Worker ${process.pid}][${level.toUpperCase()}]`;

  if (cluster.isWorker && process.send) {
    process.send({ type: 'log', text, level });
  }

  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `${prefix} ${text}`
  );
}

/**
 * Broadcast a cache invalidation to sibling workers via the master process.
 *
 * This is used as a fallback when Redis Pub/Sub is unavailable (fallback mode).
 * The master re-broadcasts the message to every other worker via IPC.
 *
 * Message shape:
 *   { type: 'cache:invalidate', keys?: string[], prefix?: string }
 */
export function broadcastCacheInvalidation(payload) {
  if (cluster.isWorker && process.send) {
    process.send({ type: 'cache:invalidate', ...payload });
  }
}

/**
 * Subscribe a worker to inbound cache invalidation IPC messages from the master.
 *
 * When master relays a cache:invalidate IPC message, `handler` is called with
 * the same payload shape as the Redis Pub/Sub message so both paths share one
 * handler:  { keys?: string[], prefix?: string }
 *
 * Returns a cleanup function that removes the listener.
 */
export function attachCacheInvalidationListener(handler) {
  if (!cluster.isWorker) return () => {};

  const listener = (msg) => {
    if (!msg || msg.type !== 'cache:invalidate') return;
    const { type: _type, ...payload } = msg;
    try {
      handler(payload);
    } catch (err) {
      log(`Cache invalidation IPC handler error: ${err.message}`, 'error');
    }
  };

  process.on('message', listener);
  return () => process.off('message', listener);
}

/**
 * Wire up graceful shutdown for an HTTP(S) server.
 * When master sends { type: 'shutdown' }, drains connections then exits cleanly.
 */
export function attachGracefulShutdown(
  httpServer,
  { drainTimeout = 5000 } = {}
) {
  if (!cluster.isWorker) return;

  process.on('message', (msg) => {
    if (!msg || msg.type !== 'shutdown') return;

    log('Received shutdown signal. Draining connections...', 'warn');

    httpServer.close(() => {
      log('All connections drained. Worker exiting cleanly.');
      process.exit(0);
    });

    const timer = setTimeout(() => {
      log('Drain timeout exceeded. Forcing worker exit.', 'error');
      process.exit(1);
    }, drainTimeout);

    if (timer.unref) timer.unref();
  });
}

/**
 * Throws if no external session store is configured (guards against in-memory sessions).
 */
export function assertExternalSessionStore(sessionMiddlewareOptions) {
  const store = sessionMiddlewareOptions && sessionMiddlewareOptions.store;
  if (!store) {
    throw new Error(
      '[Cluster] In-memory session store detected. ' +
        'In cluster mode all session state MUST be stored externally (e.g. Redis). ' +
        'Pass a compatible session store to express-session.'
    );
  }
  log('External session store confirmed.');
}
