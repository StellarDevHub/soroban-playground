import { logger } from './utils/logger.js';

/**
 * Registers process signal listeners to gracefully close active network connections
 * and drain database connection pools upon shutdown.
 *
 * @param {object} params
 * @param {import('http').Server} params.server - Running HTTP/HTTPS server instance
 * @param {import('ws').WebSocketServer} params.wss - Active WebSocket server instance
 * @param {import('knex').Knex} params.db - Knex database instance/pool
 * @param {object} [params.queues] - BullMQ queue instances whose workers must drain
 * @param {import('ioredis').Redis} [params.redis] - Redis client to flush pipelines
 * @param {number} [params.timeoutMs=20000] - Hard shutdown timeout in milliseconds (20s drain)
 */
export function setupGracefulShutdown({
  server,
  wss,
  db,
  queues = [],
  redis,
  timeoutMs = 20000,
}) {
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

    // Forceful termination timer if process hangs beyond timeout threshold
    const forceExitTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown timed out after ${timeoutMs}ms. Forcing exit.`
      );
      process.exit(1);
    }, timeoutMs);

    // Prevent timeout handle from keeping node event loop alive if cleanup finishes early
    if (forceExitTimer.unref) {
      forceExitTimer.unref();
    }

    try {
      // 1. Stop accepting new incoming HTTP connections
      if (server) {
        logger.info('Closing HTTP server to stop accepting new requests...');
        await new Promise((resolve) => server.close(resolve));
        logger.info('HTTP server closed successfully.');
      }

      // 2. Notify and close active WebSocket clients cleanly
      if (wss) {
        logger.info(
          `Closing WebSocket server (${wss.clients.size} connected clients)...`
        );

        for (const client of wss.clients) {
          if (client.readyState === 1 /* OPEN */) {
            client.close(1001, 'Server is shutting down');
          }
        }

        await new Promise((resolve) => wss.close(resolve));
        logger.info('WebSocket connections terminated and server closed.');
      }

      // 3. Wait for active BullMQ workers to complete in-flight jobs
      if (queues && queues.length > 0) {
        logger.info(
          `Waiting for ${queues.length} BullMQ queues to drain active jobs...`
        );
        await Promise.all(
          queues.map(async (queue) => {
            if (queue && typeof queue.close === 'function') {
              await queue.close();
              logger.info(`Queue drained: ${queue.name}`);
            }
          })
        );
      }

      // 4. Flush pending Redis pipelines before closing
      if (redis && typeof redis.pipeline === 'function') {
        logger.info('Flushing pending Redis pipelines...');
        try {
          await new Promise((resolve, reject) => {
            const pipeline = redis.pipeline();
            pipeline.exec().then(resolve).catch(reject);
          });
        } catch (err) {
          logger.warn('Non-fatal error flushing Redis pipelines:', err.message);
        }
      }

      // 5. Drain and destroy Knex database connection pool
      if (db && typeof db.destroy === 'function') {
        logger.info('Draining Knex database connection pool...');
        await db.destroy();
        logger.info('Database connection pool drained.');
      }

      logger.info('Graceful shutdown completed successfully. Exiting process.');
      process.exit(0);
    } catch (error) {
      logger.error(
        'Error encountered during graceful shutdown execution:',
        error
      );
      process.exit(1);
    }
  };

  // Register OS Process Signals
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}
