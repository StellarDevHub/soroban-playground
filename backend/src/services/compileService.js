import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { LRUCache } from 'lru-cache';
import { buildCargoToml } from '../routes/compile_utils.js';
import {
  createSpan,
  setSpanAttributes,
  addSpanEvent,
  getTraceId,
} from '../utils/tracing.js';
import { alertManager } from '../utils/alerting.js';
import {
  initializeCacheService,
  loadCacheEntry as loadCacheEntryFromCache,
  storeCacheEntry,
  executeUnderLock,
} from './cacheService.js';

const CACHE_ROOT =
  process.env.WASM_CACHE_DIR || path.join(process.cwd(), 'cache', 'wasm');
const ARTIFACT_ROOT =
  process.env.WASM_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts');
const STATE_FILE =
  process.env.COMPILE_STATE_FILE ||
  path.join(process.cwd(), 'data', 'compile.json');
const MAX_WORKERS = Math.min(
  Number.parseInt(process.env.COMPILE_WORKERS || '4', 10),
  4
);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 1024 * 1024 * 1024;
const MEMORY_CACHE_TTL_MS = Number.parseInt(
  process.env.MEMORY_CACHE_TTL_MS || `${30 * 1000}`,
  10
);
const CACHE_TTL_MS = Number.parseInt(
  process.env.WASM_CACHE_TTL_MS || `${MAX_AGE_MS}`,
  10
);
const MAX_COMPILATION_MEMORY_MB = Number.parseInt(
  process.env.COMPILE_MEMORY_LIMIT_MB || '512',
  10
);

const queueBus = new EventEmitter();
const queue = [];
const artifacts = new Map();
const history = [];
const cacheIndex = new LRUCache({
  maxSize: MAX_CACHE_BYTES,
  sizeCalculation: (value) => value.sizeBytes ?? 0,
  ttl: MEMORY_CACHE_TTL_MS,
  updateAgeOnGet: true,
  updateAgeOnHas: true,
});

let active = 0;
let totalCompiles = 0;
let cacheHits = 0;
let slowCompiles = 0;
let memoryPeakBytes = 0;
let workerIdSequence = 0;

function nowIso() {
  return new Date().toISOString();
}

async function ensureDirs() {
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  await fs.mkdir(ARTIFACT_ROOT, { recursive: true });
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
}

export function hashSource(code, dependencies = {}) {
  return crypto
    .createHash('sha256')
    .update(code)
    .update('\0')
    .update(JSON.stringify(dependencies))
    .digest('hex');
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { history: [], artifacts: [], stats: {} };
  }
}

async function writeState(state) {
  await ensureDirs();
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function hydrateState() {
  const state = await readState();
  if (Array.isArray(state.history)) history.push(...state.history.slice(-500));
  if (Array.isArray(state.artifacts)) {
    for (const artifact of state.artifacts) {
      if (artifact?.hash && artifact?.path) {
        artifacts.set(artifact.hash, artifact);
      }
    }
  }
}

async function persistState() {
  const state = {
    history: history.slice(-500),
    artifacts: [...artifacts.values()].slice(-500),
    stats: getCompileStats(),
  };
  await writeState(state);
}

async function removeArtifact(hash) {
  const artifact = artifacts.get(hash);
  if (!artifact) return;
  await fs.rm(artifact.path, { force: true }).catch(() => {});
  artifacts.delete(hash);
  cacheIndex.delete(hash);
  await invalidateCache({ hash });
}

async function evictExpiredArtifacts() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [hash, artifact] of artifacts.entries()) {
    const createdAt = Date.parse(
      artifact.createdAt || artifact.completedAt || 0
    );
    if (Number.isFinite(createdAt) && createdAt < cutoff) {
      await removeArtifact(hash);
    }
  }
}

async function recordArtifact(entry) {
  artifacts.set(entry.hash, entry);
  cacheIndex.set(entry.hash, entry);
  await storeCacheEntry(entry);
  await persistState();
}

async function enforceCacheLimit() {
  for (const [hash, entry] of cacheIndex.entries()) {
    const exists = await fs
      .stat(entry.path)
      .then(() => true)
      .catch(() => false);
    if (!exists) cacheIndex.delete(hash);
  }
}

function makeWorker() {
  const workerPath = new URL('./compileWorker.js', import.meta.url);
  const worker = new Worker(workerPath, {
    type: 'module',
    resourceLimits: {
      maxOldGenerationSizeMb: MAX_COMPILATION_MEMORY_MB,
    },
  });
  worker._workerId = ++workerIdSequence;
  return worker;
}

class WorkerPool {
  constructor(size) {
    this.size = size;
    this.idle = [];
    this.busy = new Map();
    for (let i = 0; i < size; i += 1) {
      this.idle.push(makeWorker());
    }
  }

  async run(job) {
    const span = createSpan('cargo.build', {
      'worker.id': this.workerId || 'unknown',
      'compile.hash': job.hash,
      'compile.request_id': job.requestId,
    });

    const worker = this.idle.pop() || makeWorker();
    this.busy.set(worker.threadId, worker);

    try {
      return await new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
          this.busy.delete(worker.threadId);
          if (worker.threadId && worker.exitCode === undefined) {
            this.idle.push(worker);
          }
        };

        const onMessage = (message) => {
          if (message?.type === 'result') {
            setSpanAttributes(span, {
              'worker.exit_code': message.payload.exitCode || 0,
              'worker.duration_ms': message.payload.durationMs,
              'worker.memory_peak_mb':
                (message.payload.memoryPeakBytes || 0) / (1024 * 1024),
            });
            cleanup();
            resolve(message.payload);
          } else if (message?.type === 'progress') {
            addSpanEvent(span, 'worker.progress', {
              'progress.status': message.payload.status,
            });
            queueBus.emit('progress', message.payload);
          }
        };

        const onError = (error) => {
          setSpanAttributes(span, {
            error: true,
            'error.message': error.message,
          });
          cleanup();
          reject(error);
        };

        const onExit = (code) => {
          setSpanAttributes(span, { 'worker.exit_code': code });
          cleanup();
          if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
        };

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);
        worker.postMessage(job);
      });
    } finally {
      span.end();
    }
  }
}

const pool = new WorkerPool(MAX_WORKERS);

async function compileOnce({ code, dependencies = {}, requestId }) {
  const span = createSpan('compile.once', {
    'compile.request_id': requestId,
    'compile.code_length': code.length,
  });

  try {
    await ensureDirs();
    const hash = hashSource(code, dependencies);

    setSpanAttributes(span, {
      'compile.hash': hash,
      'compile.dependencies_count': Object.keys(dependencies).length,
    });

    await evictExpiredArtifacts();

    const hit = await loadCacheEntryFromCache(hash);
    if (hit) {
      addSpanEvent(span, 'cache.hit', {
        'cache.size_bytes': hit.sizeBytes,
        'cache.age_seconds': (Date.now() - Date.parse(hit.createdAt)) / 1000,
      });

      cacheHits += 1;
      totalCompiles += 1;
      queueBus.emit('progress', {
        requestId,
        status: 'cache-hit',
        hash,
        queueLength: queue.length,
        activeWorkers: active,
        etaMs: 0,
      });
      const artifact = {
        hash,
        path: hit.path,
        sizeBytes: hit.sizeBytes,
        createdAt: hit.createdAt,
        sourceHash: hash,
      };
      await recordArtifact({
        ...artifact,
        requestId,
        cached: true,
        durationMs: 0,
        dependencies,
        timestamp: nowIso(),
        completedAt: nowIso(),
      });

      setSpanAttributes(span, {
        'compile.cached': true,
        'compile.duration_ms': 0,
        'compile.wasm_size_bytes': hit.sizeBytes,
      });

      return {
        success: true,
        cached: true,
        hash,
        durationMs: 0,
        artifact: {
          name: `${hash}.wasm`,
          sizeBytes: hit.sizeBytes,
          path: hit.path,
        },
        logs: ['Cache hit: returned existing WASM artifact'],
        memoryPeakBytes,
      };
    }

    addSpanEvent(span, 'cache.miss');

    queueBus.emit('progress', {
      requestId,
      status: 'queueing',
      hash,
      queueLength: queue.length,
      activeWorkers: active,
      etaMs: estimateQueueTime(),
    });

    const startTime = Date.now();
    const result = await executeUnderLock(hash, requestId, async () => {
      return await pool.run({
        code,
        dependencies,
        requestId,
        hash,
        cacheRoot: CACHE_ROOT,
        artifactRoot: ARTIFACT_ROOT,
        cargoToml: buildCargoToml(dependencies),
        timeoutMs: Number.parseInt(
          process.env.COMPILE_TIMEOUT_MS || '30000',
          10
        ),
      });
    });

    const durationMs = Date.now() - startTime;

    totalCompiles += 1;
    if (result.cached) cacheHits += 1;
    if (durationMs > 20000) slowCompiles += 1;
    memoryPeakBytes = Math.max(memoryPeakBytes, result.memoryPeakBytes || 0);

    setSpanAttributes(span, {
      'compile.cached': result.cached,
      'compile.duration_ms': durationMs,
      'compile.wasm_size_bytes': result.artifact.sizeBytes,
      'compile.memory_peak_mb': (result.memoryPeakBytes || 0) / (1024 * 1024),
    });

    const payload = {
      hash,
      requestId,
      cached: result.cached,
      durationMs,
      dependencies,
      sizeBytes: result.artifact.sizeBytes,
      path: result.artifact.path,
      createdAt: nowIso(),
      completedAt: nowIso(),
      sourceHash: hash,
    };
    await recordArtifact(payload);

    return result;
  } finally {
    span.end();
  }
}

function estimateQueueTime() {
  const avg = history.length
    ? history.reduce((sum, item) => sum + (item.durationMs || 0), 0) /
      history.length
    : 0;
  const waiting = queue.length + Math.max(0, active - MAX_WORKERS);
  return Math.round(avg * waiting);
}

export async function compileQueued(job) {
  const span = createSpan('soroban.compile', {
    'compile.request_id': job.requestId,
    'compile.hash': hashSource(job.code, job.dependencies),
    'compile.dependencies_count': Object.keys(job.dependencies || {}).length,
  });

  return new Promise((resolve, reject) => {
    addSpanEvent(span, 'compile.queued', {
      'queue.length': queue.length,
      'queue.active_workers': active,
      'queue.eta_ms': estimateQueueTime(),
    });

    queue.push({ job, resolve, reject });
    queueBus.emit('progress', {
      requestId: job.requestId,
      status: 'queued',
      queueLength: queue.length,
      activeWorkers: active,
      etaMs: estimateQueueTime(),
    });
    pump();
  }).finally(() => {
    span.end();
  });
}

function pump() {
  while (active < MAX_WORKERS && queue.length) {
    const item = queue.shift();
    active += 1;
    queueBus.emit('progress', {
      requestId: item.job.requestId,
      status: 'starting',
      queueLength: queue.length,
      activeWorkers: active,
      etaMs: estimateQueueTime(),
    });
    compileOnce(item.job)
      .then((result) => {
        history.push({
          requestId: item.job.requestId,
          hash: result.hash,
          cached: result.cached,
          durationMs: result.durationMs,
          queueLength: queue.length,
          activeWorkers: active,
          timestamp: nowIso(),
        });
        item.resolve(result);
      })
      .catch(item.reject)
      .finally(() => {
        active -= 1;
        queueBus.emit('progress', {
          requestId: item.job.requestId,
          status: 'idle',
          queueLength: queue.length,
          activeWorkers: active,
          etaMs: estimateQueueTime(),
        });
        pump();
      });
  }
}

export async function compileBatch(jobs) {
  const ordered = jobs.slice(0, 4);
  const settled = await Promise.allSettled(
    ordered.map((job) => compileQueued(job))
  );
  return settled.map((result, index) => ({
    contractIndex: index,
    ...result,
  }));
}

export async function cleanupArtifacts() {
  await evictExpiredArtifacts();
  await enforceCacheLimit();
  await persistState();
}

export function getCompileStats() {
  const hitRate =
    totalCompiles > 0 ? Math.round((cacheHits / totalCompiles) * 100) : 0;
  return {
    activeWorkers: active,
    maxWorkers: MAX_WORKERS,
    queueLength: queue.length,
    estimatedWaitTimeMs: estimateQueueTime(),
    cacheHitRate: hitRate,
    totalCompiles,
    cacheHits,
    slowCompiles,
    memoryPeakBytes,
    cacheBytes: [...cacheIndex.values()].reduce(
      (sum, entry) => sum + (entry.sizeBytes || 0),
      0
    ),
    artifacts: artifacts.size,
  };
}

export async function getCompileSnapshot() {
  const state = await readState();
  return {
    ...getCompileStats(),
    history: state.history || [],
    artifacts: state.artifacts || [],
  };
}

export async function initializeCompileService() {
  await ensureDirs();
  await hydrateState();
  await initializeCacheService([...artifacts.keys()]);
  await cleanupArtifacts();
}

export { queueBus as compileProgressBus };
