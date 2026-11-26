import cluster from 'cluster';
import os from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NUM_CPUS = os.cpus().length;

class ClusterManager {
  constructor(options = {}) {
    this.numWorkers = options.numWorkers || NUM_CPUS;
    this.workerScript =
      options.workerScript || resolve(__dirname, 'src/server.js');
    this.restartDelay = options.restartDelay || 100;
    this.workers = new Map();
    this.drainingWorkers = new Set();
    this.isShuttingDown = false;
  }

  start() {
    if (!cluster.isPrimary) {
      throw new Error(
        'ClusterManager.start() must only be called from the master process.'
      );
    }

    this._log(
      `Master PID ${process.pid} starting with ${this.numWorkers} workers`
    );

    cluster.setupPrimary({ exec: this.workerScript });

    for (let i = 0; i < this.numWorkers; i++) {
      this._spawnWorker();
    }

    cluster.on('exit', (worker, code, signal) => {
      if (this.isShuttingDown) return;
      const reason = signal || `exit code ${code}`;
      this._log(
        `Worker PID ${worker.process.pid} (id: ${worker.id}) died — ${reason}. Restarting...`,
        'warn'
      );
      this.workers.delete(worker.id);
      if (this.drainingWorkers.delete(worker.id)) return;
      setTimeout(() => {
        if (!this.isShuttingDown) this._spawnWorker();
      }, this.restartDelay);
    });

    cluster.on('message', (worker, message) => {
      if (message && message.type === 'log') {
        this._log(
          `[Worker ${worker.id}] ${message.text}`,
          message.level || 'info'
        );
      }

      if (message && message.type === 'cache:invalidate') {
        // Re-broadcast the invalidation payload to every other worker so their
        // in-process L1 caches are purged even when Redis Pub/Sub is down.
        for (const [id, sibling] of this.workers) {
          if (id !== worker.id) {
            try {
              sibling.send(message);
            } catch (err) {
              this._log(
                `Failed to relay cache:invalidate to worker ${id}: ${err.message}`,
                'warn'
              );
            }
          }
        }
      }
    });

    process.on('SIGTERM', () => this._gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this._gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => this._rollingRestart());

    this._log(`Cluster ready. Workers: ${[...this.workers.keys()].join(', ')}`);
  }

  _spawnWorker() {
    const worker = cluster.fork();
    this.workers.set(worker.id, worker);
    this._log(`Spawned worker PID ${worker.process.pid} (id: ${worker.id})`);
    return worker;
  }

  _rollingRestart() {
    if (this.isShuttingDown) return;
    this._log('Master received SIGHUP. Starting a rolling worker restart.', 'warn');

    for (const worker of [...this.workers.values()]) {
      const replacement = this._spawnWorker();
      replacement.once('online', () => {
        this.drainingWorkers.add(worker.id);
        worker.send({ type: 'shutdown' }, (error) => {
          if (error) {
            this._log(
              `Failed to signal worker ${worker.id} for restart: ${error.message}`,
              'error'
            );
          }
        });
      });
    }
  }

  _gracefulShutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this._log(
      `Master received ${signal}. Gracefully shutting down ${this.workers.size} workers...`,
      'warn'
    );

    const timeout = setTimeout(() => {
      this._log('Graceful shutdown timed out. Forcing exit.', 'error');
      process.exit(1);
    }, 15_000);

    let remaining = this.workers.size;
    if (remaining === 0) {
      clearTimeout(timeout);
      process.exit(0);
    }

    for (const worker of this.workers.values()) {
      worker.send({ type: 'shutdown' });
      worker.once('exit', () => {
        remaining--;
        if (remaining === 0) {
          clearTimeout(timeout);
          this._log('All workers exited. Master shutting down.');
          process.exit(0);
        }
      });
    }
  }

  _log(msg, level = 'info') {
    const ts = new Date().toISOString();
    const tag = `[MASTER][${level.toUpperCase()}]`;
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `${ts} ${tag} ${msg}`
    );
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

if (cluster.isPrimary) {
  const manager = new ClusterManager({
    numWorkers: parseInt(process.env.CLUSTER_WORKERS, 10) || NUM_CPUS,
    workerScript:
      process.env.WORKER_SCRIPT || resolve(__dirname, 'src/server.js'),
  });
  manager.start();
} else {
  await import('./src/server.js');
}
