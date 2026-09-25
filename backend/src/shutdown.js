import { logger } from './utils/logger.js';
import { shutdownQueues } from './services/queueService.js';
import { closeDatabase } from './database/connection.js';
import { endAllPools } from './database/pool.js';

/**
 * Registers process signal listeners to gracefully close active network connections,
 * drain BullMQ queues, complete active transactions, and close database connection pools cleanly upon shutdown.
 *
 * @param {object} params
 * @param {import('http').Server} [params.server] - Running HTTP/HTTPS server instance
 * @param {import('ws').WebSocketServer} [params.wss] - Active WebSocket server instance
 * @param {import('knex').Knex} [params.db] - Knex database instance/pool
 * @param {object} [params.queues] - BullMQ queue instances or queue manager
 * @param {import('ioredis').Redis} [params.redis] - Redis client instance
 * @param {number} [params.timeoutMs=30000] - Hard shutdown timeout in milliseconds
 */
export function setupGracefulShutdown({
  server,
  wss,
  db,
  queues = [],
  redis,
  timeoutMs = 30000,
} = {}) {
  let isShuttingDown = false;

  const handleSignal = async (signal) => {
    if (isShuttingDown) {
      logger.warn(
        `Received ${signal} again. Force terminating process immediately.`
      );
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    const forceExitTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown timed out after ${timeoutMs}ms. Forcing exit.`
      );
      process.exit(1);
    }, timeoutMs);

    if (forceExitTimer.unref) {
      forceExitTimer.unref();
    }

    try {
      // 1. Stop accepting new HTTP/HTTPS connections
      if (server && typeof server.close === 'function') {
        logger.info('[Shutdown] Closing HTTP server to stop accepting new requests...');
        await new Promise((resolve) => server.close(resolve));
        logger.info('[Shutdown] HTTP server stopped accepting new connections.');
      }

      // 2. Close active WebSocket connections cleanly
      if (wss) {
        logger.info(
          `[Shutdown] Closing WebSocket server (${wss.clients?.size || 0} connected clients)...`
        );
        if (wss.clients) {
          for (const client of wss.clients) {
            if (client.readyState === 1 /* OPEN */) {
              client.close(1001, 'Server is shutting down');
            }
          }
        }
        await new Promise((resolve) => wss.close(resolve));
        logger.info('[Shutdown] WebSocket connections terminated and server closed.');
      }

      // 3. Drain and close BullMQ queues and workers
      logger.info('[Shutdown] Draining BullMQ queues and workers...');
      try {
        await shutdownQueues();
        logger.info('[Shutdown] BullMQ queues successfully drained and closed.');
      } catch (err) {
        logger.error('[Shutdown] Error draining BullMQ queues:', err.message);
      }

      // 4. Drain Knex database connection pool and SQLite/PG handles
      if (db && typeof db.destroy === 'function') {
        logger.info('[Shutdown] Draining Knex connection pool...');
        await db.destroy();
        logger.info('[Shutdown] Knex pool destroyed.');
      }

      logger.info('[Shutdown] Closing internal database connection handles...');
      await closeDatabase().catch((err) =>
        logger.warn('[Shutdown] SQLite close error:', err.message)
      );
      await endAllPools().catch((err) =>
        logger.warn('[Shutdown] PG pools close error:', err.message)
      );

      // 5. Close Redis connections
      if (redis && typeof redis.quit === 'function' && redis.status !== 'end') {
        logger.info('[Shutdown] Closing Redis client...');
        try {
          await redis.quit();
        } catch (_) {
          redis.disconnect();
        }
      }

      logger.info('[Shutdown] Graceful shutdown completed cleanly.');
      clearTimeout(forceExitTimer);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(0);
      }
    } catch (error) {
      logger.error(
        '[Shutdown] Error encountered during graceful shutdown execution:',
        error
      );
      clearTimeout(forceExitTimer);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  return { handleSignal };
}

