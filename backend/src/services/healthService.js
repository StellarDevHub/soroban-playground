import os from 'os';

const CACHE_TTL_MS = Number.parseInt(
  process.env.HEALTH_CHECK_CACHE_MS || '3000',
  10
);
const CHECK_TIMEOUT_MS = Number.parseInt(
  process.env.HEALTH_CHECK_TIMEOUT_MS || '5000',
  10
);

let cachedDeepCheck = null;
let cacheExpiry = 0;

const dependencyUptime = {
  sqlite: { healthySince: null, lastStatus: null, consecutiveFailures: 0 },
  redis: { healthySince: null, lastStatus: null, consecutiveFailures: 0 },
  sorobanRpc: { healthySince: null, lastStatus: null, consecutiveFailures: 0 },
};

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`]
    .filter(Boolean)
    .join(' ');
}

function getUptimeInfo() {
  return {
    processSec: Math.floor(process.uptime()),
    processHuman: formatUptime(process.uptime()),
    systemSec: Math.floor(os.uptime()),
    systemHuman: formatUptime(os.uptime()),
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} check timed out after ${ms}ms`)),
        ms
      );
    }),
  ]);
}

function recordDependencyStatus(key, healthy) {
  const tracker = dependencyUptime[key];
  const now = new Date().toISOString();
  if (healthy) {
    if (!tracker.healthySince) tracker.healthySince = now;
    tracker.consecutiveFailures = 0;
    tracker.lastStatus = 'healthy';
  } else {
    tracker.healthySince = null;
    tracker.consecutiveFailures += 1;
    tracker.lastStatus = 'unhealthy';
  }
  tracker.lastCheck = now;
}

async function checkSqlite() {
  const start = Date.now();
  try {
    const { getDatabase } = await import('../database/connection.js');
    const db = getDatabase();
    await withTimeout(
      db.get('SELECT 1 AS ok'),
      CHECK_TIMEOUT_MS,
      'sqlite-read'
    );
    await withTimeout(
      db.run(
        `CREATE TABLE IF NOT EXISTS _health_probe (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          checked_at TEXT NOT NULL
        )`
      ),
      CHECK_TIMEOUT_MS,
      'sqlite-write-setup'
    );
    const checkedAt = new Date().toISOString();
    await withTimeout(
      db.run(
        'INSERT OR REPLACE INTO _health_probe (id, checked_at) VALUES (1, ?)',
        [checkedAt]
      ),
      CHECK_TIMEOUT_MS,
      'sqlite-write'
    );
    const row = await withTimeout(
      db.get('SELECT checked_at FROM _health_probe WHERE id = 1'),
      CHECK_TIMEOUT_MS,
      'sqlite-read-verify'
    );
    const latencyMs = Date.now() - start;
    const healthy = Boolean(row?.checked_at);
    recordDependencyStatus('sqlite', healthy);
    return {
      name: 'sqlite',
      status: healthy ? 'healthy' : 'unhealthy',
      latencyMs,
      readable: true,
      writable: healthy,
      message: healthy
        ? 'SQLite read/write OK'
        : 'SQLite write verification failed',
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    recordDependencyStatus('sqlite', false);
    return {
      name: 'sqlite',
      status: 'unhealthy',
      latencyMs,
      readable: false,
      writable: false,
      message: error.message,
    };
  }
}

async function checkRedis() {
  const start = Date.now();
  try {
    const { default: redisService } = await import('./redisService.js');
    if (redisService.isFallbackMode || !redisService.client) {
      const latencyMs = Date.now() - start;
      const inTest = process.env.NODE_ENV === 'test';
      const status = inTest ? 'degraded' : 'unhealthy';
      recordDependencyStatus('redis', inTest);
      return {
        name: 'redis',
        status,
        latencyMs,
        mode: 'fallback',
        message: inTest
          ? 'Redis unavailable in test environment (memory fallback)'
          : 'Redis cluster unreachable — running in memory fallback',
      };
    }
    const pong = await withTimeout(
      redisService.client.ping(),
      CHECK_TIMEOUT_MS,
      'redis-ping'
    );
    const latencyMs = Date.now() - start;
    const healthy = pong === 'PONG';
    recordDependencyStatus('redis', healthy);
    return {
      name: 'redis',
      status: healthy ? 'healthy' : 'unhealthy',
      latencyMs,
      mode: 'cluster',
      ping: pong,
      message: healthy ? 'Redis ping OK' : `Unexpected ping response: ${pong}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    recordDependencyStatus('redis', false);
    let mode = 'cluster';
    try {
      const { default: redisService } = await import('./redisService.js');
      mode = redisService.isFallbackMode ? 'fallback' : 'cluster';
    } catch {
      // ignore
    }
    return {
      name: 'redis',
      status: 'unhealthy',
      latencyMs,
      mode,
      message: error.message,
    };
  }
}

async function checkSorobanRpc() {
  const start = Date.now();
  const { default: config } = await import('../config/index.js');
  const rpcUrl = config.indexer?.rpcUrl || process.env.SOROBAN_RPC_URL;
  try {
    const { SorobanRpc } = await import('@stellar/stellar-sdk');
    const server = new SorobanRpc.Server(rpcUrl);
    const healthFn =
      typeof server.getHealth === 'function'
        ? () => server.getHealth()
        : () => server.getLatestLedger();
    await withTimeout(healthFn(), CHECK_TIMEOUT_MS, 'soroban-rpc');
    const latencyMs = Date.now() - start;
    recordDependencyStatus('sorobanRpc', true);
    return {
      name: 'sorobanRpc',
      status: 'healthy',
      latencyMs,
      endpoint: rpcUrl,
      message: 'Soroban RPC reachable',
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    recordDependencyStatus('sorobanRpc', false);
    return {
      name: 'sorobanRpc',
      status: 'unhealthy',
      latencyMs,
      endpoint: rpcUrl,
      message: error.message,
    };
  }
}

function aggregateStatus(dependencies) {
  const statuses = dependencies.map((d) => d.status);
  if (statuses.every((s) => s === 'healthy' || s === 'degraded')) {
    return statuses.includes('degraded') ? 'degraded' : 'ok';
  }
  return 'unhealthy';
}

function buildDependencyUptimeReport() {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(dependencyUptime).map(([name, tracker]) => {
      const uptimeSec = tracker.healthySince
        ? Math.floor((now - new Date(tracker.healthySince).getTime()) / 1000)
        : 0;
      return [
        name,
        {
          lastStatus: tracker.lastStatus,
          lastCheck: tracker.lastCheck,
          healthySince: tracker.healthySince,
          uptimeSec,
          uptimeHuman: uptimeSec > 0 ? formatUptime(uptimeSec) : null,
          consecutiveFailures: tracker.consecutiveFailures,
        },
      ];
    })
  );
}

export function clearHealthCache() {
  cachedDeepCheck = null;
  cacheExpiry = 0;
}

export const dependencyCheckers = {
  sqlite: checkSqlite,
  redis: checkRedis,
  sorobanRpc: checkSorobanRpc,
};

export function resetDependencyCheckers() {
  dependencyCheckers.sqlite = checkSqlite;
  dependencyCheckers.redis = checkRedis;
  dependencyCheckers.sorobanRpc = checkSorobanRpc;
}

export function getLivenessPayload() {
  return {
    status: 'ok',
    probe: 'liveness',
    timestamp: new Date().toISOString(),
    uptime: getUptimeInfo(),
  };
}

export async function performDeepHealthCheck(options = {}) {
  const { skipCache = false } = options;
  const now = Date.now();

  if (!skipCache && cachedDeepCheck && now < cacheExpiry) {
    return { ...cachedDeepCheck, cached: true };
  }

  const [sqlite, redis, sorobanRpc] = await Promise.all([
    dependencyCheckers.sqlite(),
    dependencyCheckers.redis(),
    dependencyCheckers.sorobanRpc(),
  ]);

  const dependencies = { sqlite, redis, sorobanRpc };
  const status = aggregateStatus([sqlite, redis, sorobanRpc]);
  const result = {
    status,
    probe: 'readiness',
    timestamp: new Date().toISOString(),
    uptime: getUptimeInfo(),
    dependencies,
    dependencyUptime: buildDependencyUptimeReport(),
    cached: false,
  };

  cachedDeepCheck = result;
  cacheExpiry = now + CACHE_TTL_MS;
  return result;
}

export function getHttpStatusForHealth(status) {
  return status === 'ok' || status === 'degraded' ? 200 : 503;
}

export default {
  getLivenessPayload,
  performDeepHealthCheck,
  getHttpStatusForHealth,
  clearHealthCache,
  dependencyCheckers,
  resetDependencyCheckers,
};
