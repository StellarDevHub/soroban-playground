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
import config from '../config/index.js';
import redisService from './redisService.js';

// Cache integration using the shared redisService singleton.
const COMPILE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function initializeCacheService(hashes = []) {
  if (!redisService || redisService.isFallbackMode) return false;
  // Warm Redis with known artifacts metadata so lookups hit redis quickly.
  for (const h of hashes) {
    const art = artifacts.get(h);
    if (art) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await redisService.set(`wasm:artifact:${h}`, JSON.stringify(art), COMPILE_CACHE_TTL_SECONDS);
      } catch (err) {
        // ignore warming errors
      }
    }
  }
  return true;
}

async function loadCacheEntryFromCache(hash) {
  // Try in-memory LRU first
  const lruHit = cacheIndex.get(hash);
  if (lruHit) return lruHit;

  // Try Redis cache
  try {
    const redisHit = await redisService.get(`${CACHE_KEY_PREFIX}${hash}`);
    if (redisHit) {
      const parsed = typeof redisHit === 'string' ? JSON.parse(redisHit) : redisHit;
      if (parsed?.path) {
        const exists = await fs
          .stat(parsed.path)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          cacheIndex.set(hash, parsed);
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('Redis cache lookup error:', err.message);
  }

  // Fall back to the artifacts Map (survives LRU eviction)
  const artifactHit = artifacts.get(hash);
  if (artifactHit?.path) {
    const exists = await fs.stat(artifactHit.path).then(() => true).catch(() => false);
    if (exists) {
      cacheIndex.set(hash, artifactHit);
      return artifactHit;
    }
  }

  // Finally consult Redis-backed cache
  if (redisService && !redisService.isFallbackMode) {
    try {
      const raw = await redisService.get(`wasm:artifact:${hash}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Verify file still exists on disk
        const exists = await fs.stat(parsed.path).then(() => true).catch(() => false);
        if (exists) {
          cacheIndex.set(hash, parsed);
          artifacts.set(hash, parsed);
          return parsed;
        }
      }
    } catch (err) {
      // ignore redis errors and continue
    }
  }

  return null;
}

async function storeCacheEntry(entry) {
  if (!entry || !entry.hash) return;
  artifacts.set(entry.hash, entry);
  cacheIndex.set(entry.hash, entry);
  try {
    if (redisService && !redisService.isFallbackMode) {
      await redisService.set(`wasm:artifact:${entry.hash}`, JSON.stringify(entry), COMPILE_CACHE_TTL_SECONDS);
    }
  } catch (err) {
    // swallow cache persistence errors
  }
}

async function invalidateCache({ hash } = {}) {
  if (hash) {
    artifacts.delete(hash);
    cacheIndex.delete(hash);
    try {
      if (redisService) await redisService.delete(`wasm:artifact:${hash}`);
    } catch (err) {
      // ignore
    }
  }
}

async function executeUnderLock(hash, requestId, fn) {
  // Try a simple distributed lock using setNX; if unavailable, fall back to local execution
  if (!redisService || redisService.isFallbackMode) return fn();

  const lockKey = `lock:compile:${hash}`;
  const lockVal = requestId || String(Date.now());
  const ttl = 30; // seconds
  try {
    const res = await redisService.setNX(lockKey, lockVal, ttl);
    if (res === 'OK') {
      try {
        return await fn();
      } finally {
        await redisService.delete(lockKey);
      }
    }
    // Could not acquire lock; wait briefly and try to run anyway
    await new Promise((r) => setTimeout(r, 150));
    return await fn();
  } catch (err) {
    return fn();
  }
}

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
  process.env.MEMORY_CACHE_TTL_MS || `${MAX_AGE_MS}`,
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
const MAX_SOURCE_BYTES = Number.parseInt(
  process.env.COMPILE_MAX_SOURCE_BYTES || `${512 * 1024}`,
  10
);
const MAX_DEPENDENCIES = Number.parseInt(
  process.env.COMPILE_MAX_DEPENDENCIES || '64',
  10
);
const MAX_BATCH_JOBS = 4;

const queueBus = new EventEmitter();
const queue = [];
const artifacts = new Map();
const history = [];
const cacheIndex = new LRUCache({
  maxSize: MAX_CACHE_BYTES,
  sizeCalculation: (value) => Math.max(1, value?.sizeBytes || 1),
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

// Raised when a compile job is rejected before any worker is spawned.
// `code` is a stable, machine-readable reason so routes can map the failure
// onto an HTTP status instead of surfacing an opaque 500.
export class CompileValidationError extends Error {
  constructor(message, { code = 'INVALID_COMPILE_JOB', details = [] } = {}) {
    super(message);
    this.name = 'CompileValidationError';
    this.code = code;
    this.details = details;
    this.statusCode = 400;
  }
}

// Validates a compile job up-front so malformed input fails fast with a clear
// message instead of blowing up inside a worker thread. Returns the job so it
// can be used inline.
export function validateCompileJob(job) {
  const details = [];

  if (!job || typeof job !== 'object') {
    throw new CompileValidationError('compile job must be an object', {
      code: 'INVALID_COMPILE_JOB',
    });
  }

  const { code, dependencies } = job;

  if (typeof code !== 'string') {
    details.push('code is required and must be a string');
  } else if (code.trim().length === 0) {
    details.push('code must not be empty');
  } else if (Buffer.byteLength(code, 'utf8') > MAX_SOURCE_BYTES) {
    details.push(`code exceeds the ${MAX_SOURCE_BYTES} byte limit`);
  }

  if (dependencies !== undefined) {
    if (
      dependencies === null ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      details.push('dependencies must be a plain object');
    } else if (Object.keys(dependencies).length > MAX_DEPENDENCIES) {
      details.push(`dependencies exceed the limit of ${MAX_DEPENDENCIES}`);
    }
  }

  if (job.requestId !== undefined && typeof job.requestId !== 'string') {
    details.push('requestId must be a string when provided');
  }

  if (details.length > 0) {
    throw new CompileValidationError(
      `Invalid compile job: ${details.join('; ')}`,
      { details }
    );
  }

  return job;
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
  try {
    await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    console.error('Failed to persist compile state:', err.message);
  }
}

async function hydrateState() {
  const state = await readState();
  if (Array.isArray(state.history)) history.push(...state.history.slice(-500));
  if (Array.isArray(state.artifacts)) {
    for (const artifact of state.artifacts) {
      if (artifact?.hash && artifact?.path) {
        artifacts.set(artifact.hash, artifact);
        cacheIndex.set(artifact.hash, artifact);
      }
    }
  }
  // Restore persisted stats, or recompute from history if they were all zeros
  const ps = state.stats || {};
  const hasPersistedStats = (ps.totalCompiles || 0) > 0;

  if (hasPersistedStats) {
    totalCompiles = ps.totalCompiles;
    cacheHits = ps.cacheHits || 0;
    slowCompiles = ps.slowCompiles || 0;
    memoryPeakBytes = ps.memoryPeakBytes || 0;
  } else if (history.length > 0) {
    // Recompute from actual history entries
    totalCompiles = history.length;
    cacheHits = history.filter((h) => h.cached).length;
    slowCompiles = history.filter((h) => (h.durationMs || 0) > 20000).length;
    memoryPeakBytes = 0;
    // Persist the corrected stats immediately
    await persistState();
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
  await fs.rm(artifact.path, { force: true }).catch((err) => {
    console.error(`Failed to remove artifact ${hash}:`, err.message);
  });
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

      // Get actual file size if the cached entry has 0
      let sizeBytes = hit.sizeBytes || 0;
      if (!sizeBytes && hit.path) {
        try {
          const fileStat = await fs.stat(hit.path);
          sizeBytes = fileStat.size;
        } catch {
          /* ignore */
        }
      }

      return {
        success: true,
        cached: true,
        hash,
        durationMs: 0,
        artifact: {
          name: 'soroban_contract.wasm',
          sizeBytes,
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
        timeoutMs: config.compile.timeoutMs,
      });
    }).catch((err) => {
      throw new Error(`Compilation failed: ${err.message}`);
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

    if (result.success) {
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
    }

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
  // Reject bad input before it reaches the queue so a malformed job can never
  // occupy a worker slot or leave the queue counters inconsistent.
  validateCompileJob(job);

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
          artifact: result.artifact
            ? {
                name: result.artifact.name || `${result.hash}.wasm`,
                sizeBytes: result.artifact.sizeBytes || 0,
                path: result.artifact.path || '',
                durationMs: result.durationMs || 0,
              }
            : null,
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
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new CompileValidationError('jobs must be a non-empty array', {
      code: 'INVALID_COMPILE_BATCH',
    });
  }

  const ordered = jobs.slice(0, MAX_BATCH_JOBS);
  const settled = await Promise.allSettled(
    ordered.map((job) => compileQueued(job))
  );

  // Errors are Error instances, which serialize to `{}` over JSON — flatten
  // them into a readable shape so batch callers can tell what went wrong.
  return settled.map((result, index) => ({
    contractIndex: index,
    ...result,
    ...(result.status === 'rejected'
      ? {
          error: {
            message: result.reason?.message || 'Unknown compile error',
            code: result.reason?.code || 'COMPILE_FAILED',
            details: result.reason?.details || [],
          },
        }
      : {}),
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

// Compiles a single contract source and returns a compact result shape used by
// the async BullMQ compilation worker (workers/compilationProcessor.js). This
// keeps heavy cargo work off the HTTP event loop and inside the worker process.
export async function compileContract({
  source,
  contractName = 'soroban_contract',
} = {}) {
  const job = {
    code: source,
    dependencies: {},
    requestId: `async-${contractName}-${Date.now()}`,
  };

  const result = await compileQueued(job);

  if (!result.success) {
    const error = new Error(
      (result.logs || []).join('\n') || 'Compilation failed'
    );
    error.code = 'COMPILE_FAILED';
    throw error;
  }

  return {
    hash: result.hash,
    wasmUrl: result.artifact?.path || '',
    sizeBytes: result.artifact?.sizeBytes || 0,
    durationMs: result.durationMs,
  };
}

export async function initializeCompileService() {
  await ensureDirs();
  await hydrateState();
  await initializeCacheService([...artifacts.keys()]);
  await cleanupArtifacts();
}

export { queueBus as compileProgressBus };
