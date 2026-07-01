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

  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${prefix} ${text}`);
}

/**
 * Wire up graceful shutdown for an HTTP(S) server.
 * When master sends { type: 'shutdown' }, drains connections then exits cleanly.
 */
export function attachGracefulShutdown(httpServer, { drainTimeout = 5000 } = {}) {
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