import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { LRUCache } from 'lru-cache';
import redisService from './redisService.js';
import {
  cacheHitsTotal,
  cacheMissesTotal,
  cacheEvictionsTotal,
  cacheEntryCount,
  cacheVersionGauge,
  cacheLatencyHistogram,
} from '../routes/metrics.js';

const CACHE_ROOT =
  process.env.WASM_CACHE_DIR || path.join(process.cwd(), 'cache', 'wasm');
const L1_TTL_MS = Number(process.env.CACHE_L1_TTL_MS || 30 * 1000);
const L2_TTL_MS = Number(process.env.CACHE_L2_TTL_MS || 5 * 60 * 1000);
const CACHE_LOCK_TTL_MS = Number(process.env.CACHE_LOCK_TTL_MS || 15 * 1000);
const CACHE_WAIT_TIMEOUT_MS = Number(process.env.CACHE_WAIT_TIMEOUT_MS || 15 * 1000);
const CACHE_WARM_INTERVAL_MS = Number(process.env.CACHE_WARM_INTERVAL_MS || 2 * 60 * 1000);
const CACHE_PREDICTIVE_TOP = Number(process.env.CACHE_PREDICTIVE_TOP || 20);
const CACHE_VERSION_DEFAULT = process.env.CACHE_NAMESPACE_VERSION || 'v1';
const CACHE_VERSION_KEY = 'cache:compile:version';
const CACHE_VERSIONS_SET = 'cache:compile:versions';
const CACHE_PREDICTION_KEY = 'cache:compile:prediction';
const CACHE_DEPENDENCY_PREFIX = 'cache:compile:dependency:';
const CACHE_LOCK_PREFIX = 'cache:compile:lock:';
const CACHE_ARTIFACT_PREFIX = 'cache:compile:artifact:';

const cacheIndex = new LRUCache({
  maxSize: Number(process.env.WASM_CACHE_MAX_BYTES || 1024 * 1024 * 1024),
  sizeCalculation: (value) => value.sizeBytes ?? 0,
  ttl: L1_TTL_MS,
  updateAgeOnGet: true,
  updateAgeOnHas: true,
});

let currentCacheVersion = CACHE_VERSION_DEFAULT;
let versionInitialized = false;
const pendingCachePromises = new Map();
let cacheMisses = 0;
let cacheHits = 0;

function getCacheKey(version, hash) {
  return `${CACHE_ARTIFACT_PREFIX}${version}:${hash}`;
}

function getLockKey(hash) {
  return `${CACHE_LOCK_PREFIX}${hash}`;
}

function parseRedisInfo(info) {
  const result = {};
  if (!info || typeof info !== 'string') return result;
  for (const line of info.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [key, value] = line.split(':');
    if (key && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function updateCacheCountMetrics() {
  if (cacheEntryCount) {
    cacheEntryCount.set(cacheIndex.size);
  }
}

function recordCacheHit(level = 'memory') {
  cacheHits += 1;
  cacheHitsTotal?.inc({ level, reason: 'success' });
}

function recordCacheMiss(reason = 'unknown') {
  cacheMisses += 1;
  cacheMissesTotal?.inc({ reason });
}

function recordCacheEviction() {
  cacheEvictionsTotal?.inc();
}

async function ensureCacheVersion() {
  if (versionInitialized) return currentCacheVersion;

  if (!redisService.client || redisService.isFallbackMode) {
    versionInitialized = true;
    cacheVersionGauge?.set({ namespace: 'compile' }, parseInt(currentCacheVersion.replace(/[^0-9]/g, ''), 10) || 1);
    return currentCacheVersion;
  }

  try {
    const storedVersion = await redisService.client.get(CACHE_VERSION_KEY);
    if (storedVersion) {
      currentCacheVersion = storedVersion;
    } else {
      await redisService.client.multi()
        .set(CACHE_VERSION_KEY, currentCacheVersion)
        .sadd(CACHE_VERSIONS_SET, currentCacheVersion)
        .exec();
    }
    cacheVersionGauge?.set({ namespace: 'compile' }, parseInt(currentCacheVersion.replace(/[^0-9]/g, ''), 10) || 1);
  } catch (err) {
    console.error('Cache version initialization failed:', err.message);
  }

  versionInitialized = true;
  return currentCacheVersion;
}

async function bumpCacheVersion(newVersion) {
  if (!newVersion || typeof newVersion !== 'string') {
    throw new Error('New cache version must be a valid string');
  }

  currentCacheVersion = newVersion;
  versionInitialized = true;

  if (redisService.client && !redisService.isFallbackMode) {
    try {
      await redisService.client.multi()
        .set(CACHE_VERSION_KEY, currentCacheVersion)
        .sadd(CACHE_VERSIONS_SET, currentCacheVersion)
        .exec();
    } catch (err) {
      console.error('Cache version bump failed:', err.message);
    }
  }

  cacheVersionGauge?.set({ namespace: 'compile' }, parseInt(currentCacheVersion.replace(/[^0-9]/g, ''), 10) || 1);
  return currentCacheVersion;
}

async function getCacheVersions() {
  await ensureCacheVersion();
  if (!redisService.client || redisService.isFallbackMode) {
    return [currentCacheVersion];
  }

  try {
    const versions = await redisService.client.smembers(CACHE_VERSIONS_SET);
    if (Array.isArray(versions) && versions.length > 0) {
      return versions;
    }
  } catch (err) {
    console.error('Failed to read cache versions:', err.message);
  }

  return [currentCacheVersion];
}

async function validateArtifactPath(filePath) {
  if (!filePath) return false;
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadFileArtifact(hash) {
  const wasmPath = path.join(CACHE_ROOT, `${hash}.wasm`);
  try {
    const stats = await fs.stat(wasmPath);
    return {
      hash,
      path: wasmPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      dependencies: [],
    };
  } catch {
    return null;
  }
}

async function loadRedisCacheEntry(hash) {
  if (!redisService.client || redisService.isFallbackMode) return null;

  await ensureCacheVersion();
  const versions = await getCacheVersions();
  for (const version of versions.slice(0, 3)) {
    const key = getCacheKey(version, hash);
    try {
      const payload = await redisService.client.get(key);
      if (!payload) continue;
      const entry = JSON.parse(payload);
      if (!(entry && entry.path && entry.hash === hash)) {
        await redisService.client.del(key);
        continue;
      }
      if (!(await validateArtifactPath(entry.path))) {
        await redisService.client.del(key);
        continue;
      }
      recordCacheHit('redis');
      return entry;
    } catch (err) {
      console.error('Failed to load Redis cache entry:', err.message);
      return null;
    }
  }

  return null;
}

async function writeRedisCacheEntry(entry) {
  if (!redisService.client || redisService.isFallbackMode) return;
  await ensureCacheVersion();

  const key = getCacheKey(currentCacheVersion, entry.hash);
  try {
    await redisService.client.set(key, JSON.stringify(entry), {
      PX: L2_TTL_MS,
    });
  } catch (err) {
    console.error('Failed to write Redis cache entry:', err.message);
  }
}

async function recordDependencies(hash, dependencies = {}) {
  if (!redisService.client || redisService.isFallbackMode) return;
  if (!dependencies || typeof dependencies !== 'object') return;

  try {
    const pipeline = redisService.client.pipeline();
    Object.entries(dependencies).forEach(([name, value]) => {
      const dependencyHash = `${name}:${JSON.stringify(value)}`;
      pipeline.sadd(`${CACHE_DEPENDENCY_PREFIX}${dependencyHash}`, hash);
      pipeline.expire(`${CACHE_DEPENDENCY_PREFIX}${dependencyHash}`, 60 * 60 * 24 * 30);
    });
    await pipeline.exec();
  } catch (err) {
    console.error('Failed to record dependency mapping:', err.message);
  }
}

async function updatePredictionScore(hash) {
  if (!redisService.client || redisService.isFallbackMode) return;
  try {
    await redisService.client.zincrby(CACHE_PREDICTION_KEY, 1, hash);
  } catch (err) {
    console.error('Failed to update prediction score:', err.message);
  }
}

async function loadCacheEntry(hash) {
  if (!hash) return null;

  const cached = cacheIndex.get(hash);
  if (cached) {
    recordCacheHit('memory');
    updateCacheCountMetrics();
    return cached;
  }

  const redisEntry = await loadRedisCacheEntry(hash);
  if (redisEntry) {
    cacheIndex.set(hash, redisEntry);
    updateCacheCountMetrics();
    return redisEntry;
  }

  const fileEntry = await loadFileArtifact(hash);
  if (fileEntry) {
    recordCacheMiss('fs');
    cacheIndex.set(hash, fileEntry);
    updateCacheCountMetrics();
    await writeRedisCacheEntry(fileEntry);
    return fileEntry;
  }

  recordCacheMiss('missing');
  updateCacheCountMetrics();
  return null;
}

async function storeCacheEntry(entry) {
  if (!entry || !entry.hash) return;

  cacheIndex.set(entry.hash, entry);
  updateCacheCountMetrics();

  if (entry.dependencies) {
    await recordDependencies(entry.hash, entry.dependencies);
  }

  await writeRedisCacheEntry(entry);
}

async function executeUnderLock(hash, requestId, taskFn) {
  if (!hash || typeof taskFn !== 'function') {
    throw new Error('executeUnderLock requires hash and taskFn');
  }

  if (pendingCachePromises.has(hash)) {
    return pendingCachePromises.get(hash);
  }

  const promise = (async () => {
    const existing = cacheIndex.get(hash);
    if (existing) {
      recordCacheHit('memory');
      return {
        cached: true,
        artifact: existing,
        durationMs: 0,
        logs: ['Cache hit: returned existing WASM artifact'],
        source: 'memory',
      };
    }

    const lockKey = getLockKey(hash);
    const lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let acquired = false;

    if (redisService.client && !redisService.isFallbackMode) {
      try {
        acquired = Boolean(await redisService.client.set(lockKey, lockValue, {
          NX: true,
          PX: CACHE_LOCK_TTL_MS,
        }));
      } catch (err) {
        console.error('Cache stampede lock error:', err.message);
      }
    }

    if (acquired) {
      try {
        const result = await taskFn();
        return result;
      } finally {
        if (redisService.client && !redisService.isFallbackMode) {
          try {
            const current = await redisService.client.get(lockKey);
            if (current === lockValue) {
              await redisService.client.del(lockKey);
            }
          } catch (lockError) {
            console.error('Failed to release cache lock:', lockError.message);
          }
        }
      }
    }

    const deadline = Date.now() + CACHE_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const warmed = await loadCacheEntry(hash);
      if (warmed) {
        return {
          cached: true,
          artifact: warmed,
          durationMs: 0,
          logs: ['Cache hit: waited on existing cache entry'],
          source: 'external',
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (redisService.client && !redisService.isFallbackMode) {
        const current = await redisService.client.get(lockKey);
        if (!current) break;
      }
    }

    return await taskFn();
  })();

  pendingCachePromises.set(hash, promise);
  promise.finally(() => pendingCachePromises.delete(hash));
  return promise;
}

async function warmCache({ hashes = [], top = 10 } = {}) {
  const timerStart = Date.now();
  const warmed = [];
  const candidateHashes = Array.isArray(hashes) && hashes.length ? hashes : await getTopPredictedHashes(top);

  for (const hash of candidateHashes.slice(0, top)) {
    if (!hash) continue;
    const entry = await loadCacheEntry(hash);
    if (entry) warmed.push(hash);
  }

  cacheLatencyHistogram?.observe({ action: 'warm' }, (Date.now() - timerStart) / 1000);
  return { warmed, warmedCount: warmed.length };
}

async function getTopPredictedHashes(limit = CACHE_PREDICTIVE_TOP) {
  if (!redisService.client || redisService.isFallbackMode) return [];
  try {
    const values = await redisService.client.zrevrange(CACHE_PREDICTION_KEY, 0, limit - 1);
    return values;
  } catch (err) {
    console.error('Failed to load predictive caches:', err.message);
    return [];
  }
}

async function invalidateCache({ hash, dependency, namespace = 'compile' } = {}) {
  if (namespace !== 'compile') {
    throw new Error('Only compile cache namespace is supported');
  }

  const invalidated = {
    hashes: [],
    dependency: null,
    versionBumped: false,
  };

  if (hash) {
    cacheIndex.delete(hash);
    invalidated.hashes.push(hash);

    if (redisService.client && !redisService.isFallbackMode) {
      const versions = await getCacheVersions();
      const pipeline = redisService.client.pipeline();
      versions.forEach((version) => pipeline.del(getCacheKey(version, hash)));
      await pipeline.exec();
    }
  }

  if (dependency) {
    if (redisService.client && !redisService.isFallbackMode) {
      const dependencyKey = `${CACHE_DEPENDENCY_PREFIX}${dependency}`;
      try {
        const hashes = await redisService.client.smembers(dependencyKey);
        if (Array.isArray(hashes) && hashes.length) {
          const versions = await getCacheVersions();
          const pipeline = redisService.client.pipeline();
          hashes.forEach((entryHash) => {
            cacheIndex.delete(entryHash);
            invalidated.hashes.push(entryHash);
            versions.forEach((version) => pipeline.del(getCacheKey(version, entryHash)));
          });
          pipeline.del(dependencyKey);
          await pipeline.exec();
        }
      } catch (err) {
        console.error('Failed to invalidate dependency cache:', err.message);
      }
    }
    invalidated.dependency = dependency;
  }

  if (!hash && !dependency) {
    await bumpCacheVersion(`${currentCacheVersion}-bump-${Date.now()}`);
    invalidated.versionBumped = true;
  }

  if (invalidated.hashes.length) {
    invalidated.hashes = [...new Set(invalidated.hashes)];
    invalidated.hashes.forEach(() => recordCacheEviction());
  }

  return invalidated;
}

async function listCacheKeys({ pattern = 'cache:compile:*', limit = 100 } = {}) {
  if (!redisService.client || redisService.isFallbackMode) return [];
  const keys = [];
  let cursor = 0;

  try {
    do {
      const [nextCursor, items] = await redisService.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = Number(nextCursor);
      keys.push(...items);
    } while (cursor !== 0 && keys.length < limit);
  } catch (err) {
    console.error('Failed to list cache keys:', err.message);
  }

  return keys.slice(0, limit);
}

async function getCacheAdminSnapshot() {
  const memoryKeys = Array.from(cacheIndex.keys());
  const snapshot = {
    cacheVersion: await ensureCacheVersion(),
    memoryEntries: cacheIndex.size,
    memorySizeBytes: [...cacheIndex.values()].reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0),
    cacheHits,
    cacheMisses,
    topPredictions: await getTopPredictedHashes(10),
    connectedToRedis: Boolean(redisService.client && !redisService.isFallbackMode),
    redisStatus: {},
    cacheKeys: memoryKeys,
  };

  if (redisService.client && !redisService.isFallbackMode) {
    try {
      const redisInfoRaw = await redisService.client.info();
      const stats = parseRedisInfo(redisInfoRaw);
      snapshot.redisStatus = {
        usedMemory: stats.used_memory,
        maxMemory: stats.maxmemory,
        evictedKeys: stats.evicted_keys,
        totalKeys: stats.db0 ? stats.db0.split(',')[0] : undefined,
      };
    } catch (err) {
      console.error('Failed to read Redis info:', err.message);
    }
  }

  return snapshot;
}

async function initializeCacheService(existingHashes = []) {
  await ensureCacheVersion();
  if (Array.isArray(existingHashes) && existingHashes.length) {
    await warmCache({ hashes: existingHashes.slice(0, 20) });
  }

  setInterval(() => {
    warmCache({ top: CACHE_PREDICTIVE_TOP }).catch((err) => {
      console.error('Predictive cache warm failed:', err.message);
    });
  }, CACHE_WARM_INTERVAL_MS);
}

export {
  initializeCacheService,
  loadCacheEntry,
  storeCacheEntry,
  executeUnderLock,
  warmCache,
  invalidateCache,
  listCacheKeys,
  getCacheAdminSnapshot,
  bumpCacheVersion,
};
