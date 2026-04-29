import crypto from 'crypto';
import os from 'os';
import { EventEmitter } from 'events';
import redisService from './redisService.js';
import {
  oracleProofDeadLetterTotal,
  oracleProofProcessingDuration,
  oracleProofQueueDepth,
  oracleProofTaskRetries,
  oracleProofTasksEnqueued,
  oracleProofTaskTransitions,
  oracleProofWorkerHeartbeats,
} from '../routes/metrics.js';

const QUEUE_PREFIX = process.env.ORACLE_QUEUE_PREFIX || 'oracle:proof_queue';
const MAX_PRIORITY = 100;
const MIN_PRIORITY = 0;
const DEFAULT_PRIORITY = 50;
const DEFAULT_MAX_RETRIES = Number.parseInt(
  process.env.ORACLE_PROOF_MAX_RETRIES || '3',
  10
);
const DEFAULT_LOCK_MS = Number.parseInt(
  process.env.ORACLE_PROOF_LOCK_MS || '30000',
  10
);
const DEFAULT_BACKOFF_MS = Number.parseInt(
  process.env.ORACLE_PROOF_RETRY_BACKOFF_MS || '1000',
  10
);
const MAX_BACKOFF_MS = Number.parseInt(
  process.env.ORACLE_PROOF_MAX_BACKOFF_MS || '60000',
  10
);
const DEFAULT_POLL_MS = Number.parseInt(
  process.env.ORACLE_PROOF_POLL_MS || '500',
  10
);
const DEFAULT_HEARTBEAT_MS = Number.parseInt(
  process.env.ORACLE_PROOF_HEARTBEAT_MS || '5000',
  10
);
const DEFAULT_WORKERS = Number.parseInt(
  process.env.ORACLE_PROOF_WORKERS || '2',
  10
);
const MAX_BATCH_SIZE = Number.parseInt(
  process.env.ORACLE_PROOF_MAX_BATCH_SIZE || '5000',
  10
);

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseOptionalDate(value) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

function scoreFor(scheduledAt, priority) {
  const scheduledAtMs = Date.parse(scheduledAt);
  return scheduledAtMs * 1000 + (MAX_PRIORITY - priority);
}

function dueScore(now = nowMs()) {
  return now * 1000 + MAX_PRIORITY;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function createTaskId() {
  if (crypto.randomUUID) {
    return `proof-${crypto.randomUUID()}`;
  }
  return `proof-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function key(name) {
  return `${QUEUE_PREFIX}:${name}`;
}

function taskKey(id) {
  return `${QUEUE_PREFIX}:task:${id}`;
}

function serializeTask(task) {
  return {
    id: task.id,
    proofType: task.proofType,
    proof: JSON.stringify(task.proof ?? null),
    payload: JSON.stringify(task.payload ?? {}),
    metadata: JSON.stringify(task.metadata ?? {}),
    result: JSON.stringify(task.result ?? null),
    history: JSON.stringify(task.history ?? []),
    priority: String(task.priority),
    maxRetries: String(task.maxRetries),
    attempts: String(task.attempts),
    retryCount: String(task.retryCount),
    status: task.status,
    idempotencyKey: task.idempotencyKey || '',
    proofHash: task.proofHash,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    scheduledAt: task.scheduledAt,
    deadlineAt: task.deadlineAt || '',
    processingStartedAt: task.processingStartedAt || '',
    heartbeatAt: task.heartbeatAt || '',
    leaseExpiresAt: task.leaseExpiresAt || '',
    completedAt: task.completedAt || '',
    failedAt: task.failedAt || '',
    workerId: task.workerId || '',
    lastError: task.lastError || '',
  };
}

function deserializeTask(raw) {
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    id: raw.id,
    proofType: raw.proofType,
    proof: safeJsonParse(raw.proof, null),
    payload: safeJsonParse(raw.payload, {}),
    metadata: safeJsonParse(raw.metadata, {}),
    result: safeJsonParse(raw.result, null),
    history: safeJsonParse(raw.history, []),
    priority: Number.parseInt(raw.priority || '0', 10),
    maxRetries: Number.parseInt(raw.maxRetries || '0', 10),
    attempts: Number.parseInt(raw.attempts || '0', 10),
    retryCount: Number.parseInt(raw.retryCount || '0', 10),
    status: raw.status,
    idempotencyKey: raw.idempotencyKey || undefined,
    proofHash: raw.proofHash,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    scheduledAt: raw.scheduledAt,
    deadlineAt: raw.deadlineAt || undefined,
    processingStartedAt: raw.processingStartedAt || undefined,
    heartbeatAt: raw.heartbeatAt || undefined,
    leaseExpiresAt: raw.leaseExpiresAt || undefined,
    completedAt: raw.completedAt || undefined,
    failedAt: raw.failedAt || undefined,
    workerId: raw.workerId || undefined,
    lastError: raw.lastError || undefined,
  };
}

function transition(task, toState, detail = {}) {
  const fromState = task.status || 'new';
  task.status = toState;
  task.updatedAt = nowIso();
  task.history = [
    ...(task.history || []),
    {
      from: fromState,
      to: toState,
      at: task.updatedAt,
      ...detail,
    },
  ].slice(-40);
  oracleProofTaskTransitions.inc({
    from_state: fromState,
    to_state: toState,
  });
}

function normalizeProofTask(input = {}, source = 'api') {
  const proof = input.proof ?? input.oracleProof ?? input.oracle_proof;
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const errors = [];

  if (proof === undefined || proof === null || proof === '') {
    errors.push('proof is required');
  }

  if (input.payload !== undefined && (typeof input.payload !== 'object' || Array.isArray(input.payload))) {
    errors.push('payload must be an object when provided');
  }

  const scheduledAt = parseOptionalDate(input.scheduledAt || input.scheduled_at) || nowIso();
  const deadlineAt = parseOptionalDate(input.deadlineAt || input.deadline_at);

  if ((input.deadlineAt || input.deadline_at) && !deadlineAt) {
    errors.push('deadlineAt must be a valid ISO timestamp');
  }

  const priority = clampNumber(
    input.priority,
    MIN_PRIORITY,
    MAX_PRIORITY,
    DEFAULT_PRIORITY
  );
  const maxRetries = clampNumber(input.maxRetries ?? input.max_retries, 0, 10, DEFAULT_MAX_RETRIES);
  const proofType = String(input.proofType || input.proof_type || 'generic');
  const idempotencyKey = input.idempotencyKey || input.idempotency_key;
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    source,
    requestId: input.requestId || input.request_id,
  };

  if (errors.length > 0) {
    const error = new Error('Invalid oracle proof task');
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  const createdAt = nowIso();
  return {
    id: input.id || createTaskId(),
    proofType,
    proof,
    payload,
    metadata,
    priority,
    maxRetries,
    attempts: 0,
    retryCount: 0,
    status: 'queued',
    idempotencyKey,
    proofHash: hashPayload({ proofType, proof, payload }),
    createdAt,
    updatedAt: createdAt,
    scheduledAt,
    deadlineAt,
    history: [
      {
        from: 'new',
        to: 'queued',
        at: createdAt,
        reason: 'producer_api',
      },
    ],
  };
}

class OracleProofQueueService extends EventEmitter {
  constructor() {
    super();
    this.workerIdBase = `${os.hostname()}-${process.pid}`;
    this.workers = new Map();
    this.workerTimers = new Set();
    this.recoveryTimer = null;
    this.stopping = false;
    this.activeLocalTasks = new Map();
    this.resetForTests();
  }

  resetForTests() {
    this.memory = {
      tasks: new Map(),
      idempotency: new Map(),
    };
    this.stopping = false;
    this.activeLocalTasks.clear();
    this.updateQueueDepthMetrics({
      queued: 0,
      retrying: 0,
      processing: 0,
      completed: 0,
      dead_letter: 0,
      failed: 0,
    });
  }

  redisReady() {
    return Boolean(redisService.client && !redisService.isFallbackMode);
  }

  allowMemoryBackend() {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.ORACLE_QUEUE_ALLOW_MEMORY_FALLBACK === 'true'
    );
  }

  storageMode() {
    if (this.redisReady()) return 'redis';
    if (this.allowMemoryBackend()) return 'memory';
    return 'unavailable';
  }

  assertWritableBackend() {
    if (this.storageMode() === 'unavailable') {
      const error = new Error(
        'Oracle proof queue requires Redis. Set ORACLE_QUEUE_ALLOW_MEMORY_FALLBACK=true only for local development.'
      );
      error.statusCode = 503;
      throw error;
    }
  }

  updateQueueDepthMetrics(counts) {
    for (const state of [
      'queued',
      'retrying',
      'processing',
      'completed',
      'dead_letter',
      'failed',
    ]) {
      oracleProofQueueDepth.set({ state }, counts[state] || 0);
    }
  }

  async enqueueProofTask(input, options = {}) {
    this.assertWritableBackend();
    const task = normalizeProofTask(input, options.source || 'api');

    if (task.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(task.idempotencyKey);
      if (existing) {
        return { task: existing, deduplicated: true };
      }
    }

    if (this.storageMode() === 'redis') {
      await this.enqueueRedisTask(task);
    } else {
      this.enqueueMemoryTask(task);
    }

    oracleProofTasksEnqueued.inc({ priority: String(task.priority) });
    this.emit('progress', {
      taskId: task.id,
      status: task.status,
      priority: task.priority,
      timestamp: nowIso(),
    });

    return { task, deduplicated: false };
  }

  async enqueueBatch(tasks, options = {}) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      const error = new Error('tasks must be a non-empty array');
      error.statusCode = 400;
      throw error;
    }
    if (tasks.length > MAX_BATCH_SIZE) {
      const error = new Error(`tasks cannot exceed ${MAX_BATCH_SIZE} items`);
      error.statusCode = 400;
      throw error;
    }

    const results = [];
    for (const task of tasks) {
      results.push(await this.enqueueProofTask(task, options));
    }
    return results;
  }

  enqueueMemoryTask(task) {
    this.memory.tasks.set(task.id, task);
    if (task.idempotencyKey) {
      this.memory.idempotency.set(task.idempotencyKey, task.id);
    }
    this.refreshMemoryMetrics();
  }

  async enqueueRedisTask(task) {
    const client = redisService.client;
    const multi = client.multi();
    multi.hset(taskKey(task.id), serializeTask(task));
    multi.sadd(key('ids'), task.id);
    multi.zadd(key('pending'), scoreFor(task.scheduledAt, task.priority), task.id);
    if (task.idempotencyKey) {
      multi.hset(key('idempotency'), task.idempotencyKey, task.id);
    }
    await multi.exec();
    await this.refreshRedisMetrics();
  }

  async findByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    if (this.storageMode() === 'redis') {
      const id = await redisService.client.hget(key('idempotency'), idempotencyKey);
      return id ? this.getTask(id) : null;
    }
    const id = this.memory.idempotency.get(idempotencyKey);
    return id ? this.memory.tasks.get(id) : null;
  }

  async getTask(id) {
    if (!id) return null;
    if (this.storageMode() === 'redis') {
      return deserializeTask(await redisService.client.hgetall(taskKey(id)));
    }
    return this.memory.tasks.get(id) || null;
  }

  async claimNextTask(workerId) {
    this.assertWritableBackend();
    if (this.storageMode() === 'redis') {
      return this.claimRedisTask(workerId);
    }
    return this.claimMemoryTask(workerId);
  }

  async claimRedisTask(workerId) {
    const now = nowMs();
    const leaseExpiresAt = new Date(now + DEFAULT_LOCK_MS).toISOString();
    const script = `
      local pending = KEYS[1]
      local processing = KEYS[2]
      local taskPrefix = ARGV[1]
      local maxScore = tonumber(ARGV[2])
      local workerId = ARGV[3]
      local nowIso = ARGV[4]
      local leaseExpiresAt = ARGV[5]
      local leaseScore = tonumber(ARGV[6])

      local ids = redis.call('ZRANGEBYSCORE', pending, '-inf', maxScore, 'LIMIT', 0, 10)
      for _, id in ipairs(ids) do
        local taskKey = taskPrefix .. id
        local status = redis.call('HGET', taskKey, 'status')
        if status == 'queued' or status == 'retrying' then
          redis.call('ZREM', pending, id)
          redis.call('ZADD', processing, leaseScore, id)
          redis.call('HINCRBY', taskKey, 'attempts', 1)
          redis.call('HSET', taskKey,
            'status', 'processing',
            'workerId', workerId,
            'processingStartedAt', nowIso,
            'heartbeatAt', nowIso,
            'leaseExpiresAt', leaseExpiresAt,
            'updatedAt', nowIso
          )
          return redis.call('HGETALL', taskKey)
        else
          redis.call('ZREM', pending, id)
        end
      end
      return {}
    `;

    const raw = await redisService.client.eval(
      script,
      2,
      key('pending'),
      key('processing'),
      `${QUEUE_PREFIX}:task:`,
      dueScore(now),
      workerId,
      new Date(now).toISOString(),
      leaseExpiresAt,
      now + DEFAULT_LOCK_MS
    );

    const task = this.redisArrayToTask(raw);
    if (task) {
      task.status = task.history?.at(-1)?.to || 'queued';
      transition(task, 'processing', { workerId });
      await redisService.client.hset(taskKey(task.id), {
        history: JSON.stringify(task.history),
      });
      this.activeLocalTasks.set(task.id, { workerId, task });
      await this.refreshRedisMetrics();
    }
    return task;
  }

  redisArrayToTask(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const hash = {};
    for (let index = 0; index < raw.length; index += 2) {
      hash[raw[index]] = raw[index + 1];
    }
    return deserializeTask(hash);
  }

  claimMemoryTask(workerId) {
    const now = nowMs();
    const due = [...this.memory.tasks.values()]
      .filter(
        (task) =>
          ['queued', 'retrying'].includes(task.status) &&
          Date.parse(task.scheduledAt) <= now
      )
      .sort((a, b) => {
        const scheduledDiff = Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
        if (scheduledDiff !== 0) return scheduledDiff;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });

    const task = due[0];
    if (!task) return null;

    task.attempts += 1;
    task.workerId = workerId;
    task.processingStartedAt = nowIso();
    task.heartbeatAt = task.processingStartedAt;
    task.leaseExpiresAt = new Date(now + DEFAULT_LOCK_MS).toISOString();
    transition(task, 'processing', { workerId });
    this.activeLocalTasks.set(task.id, { workerId, task });
    this.refreshMemoryMetrics();
    return task;
  }

  async heartbeat(taskId, workerId) {
    const heartbeatAt = nowIso();
    const leaseExpiresAt = new Date(nowMs() + DEFAULT_LOCK_MS).toISOString();
    if (this.storageMode() === 'redis') {
      const script = `
        local taskKey = KEYS[1]
        local processing = KEYS[2]
        local taskId = ARGV[1]
        local workerId = ARGV[2]
        local heartbeatAt = ARGV[3]
        local leaseExpiresAt = ARGV[4]
        local leaseScore = tonumber(ARGV[5])
        if redis.call('HGET', taskKey, 'status') ~= 'processing' then return 0 end
        if redis.call('HGET', taskKey, 'workerId') ~= workerId then return 0 end
        redis.call('HSET', taskKey,
          'heartbeatAt', heartbeatAt,
          'leaseExpiresAt', leaseExpiresAt,
          'updatedAt', heartbeatAt
        )
        redis.call('ZADD', processing, leaseScore, taskId)
        return 1
      `;
      await redisService.client.eval(
        script,
        2,
        taskKey(taskId),
        key('processing'),
        taskId,
        workerId,
        heartbeatAt,
        leaseExpiresAt,
        nowMs() + DEFAULT_LOCK_MS
      );
    } else {
      const task = this.memory.tasks.get(taskId);
      if (task?.workerId === workerId && task.status === 'processing') {
        task.heartbeatAt = heartbeatAt;
        task.leaseExpiresAt = leaseExpiresAt;
        task.updatedAt = heartbeatAt;
      }
    }
    oracleProofWorkerHeartbeats.inc({ worker_id: workerId });
  }

  async completeTask(task, workerId, result, durationSeconds) {
    const completedAt = nowIso();
    task.result = result;
    task.completedAt = completedAt;
    task.workerId = workerId;
    transition(task, 'completed', { workerId });
    this.activeLocalTasks.delete(task.id);
    oracleProofProcessingDuration.observe({ outcome: 'completed' }, durationSeconds);

    if (this.storageMode() === 'redis') {
      const script = `
        local taskKey = KEYS[1]
        local processing = KEYS[2]
        local completed = KEYS[3]
        local taskId = ARGV[1]
        local workerId = ARGV[2]
        local completedAt = ARGV[3]
        local result = ARGV[4]
        local history = ARGV[5]
        local completedScore = tonumber(ARGV[6])
        if redis.call('HGET', taskKey, 'status') ~= 'processing' then return 0 end
        if redis.call('HGET', taskKey, 'workerId') ~= workerId then return 0 end
        redis.call('ZREM', processing, taskId)
        redis.call('ZADD', completed, completedScore, taskId)
        redis.call('HSET', taskKey,
          'status', 'completed',
          'result', result,
          'completedAt', completedAt,
          'updatedAt', completedAt,
          'history', history
        )
        return 1
      `;
      await redisService.client.eval(
        script,
        3,
        taskKey(task.id),
        key('processing'),
        key('completed'),
        task.id,
        workerId,
        completedAt,
        JSON.stringify(result),
        JSON.stringify(task.history),
        nowMs()
      );
      await this.refreshRedisMetrics();
    } else {
      this.memory.tasks.set(task.id, task);
      this.refreshMemoryMetrics();
    }

    this.emit('progress', {
      taskId: task.id,
      status: 'completed',
      workerId,
      timestamp: completedAt,
    });
  }

  async failTask(task, workerId, error, options = {}) {
    const reason = options.reason || error?.code || 'processing_failed';
    const message = error?.message || String(error || 'Oracle proof processing failed');
    const now = nowMs();
    const deadlineExpired = task.deadlineAt && Date.parse(task.deadlineAt) <= now;
    const shouldRetry =
      !deadlineExpired && task.attempts <= task.maxRetries && !options.forceDeadLetter;

    task.lastError = message;
    task.failedAt = nowIso();
    this.activeLocalTasks.delete(task.id);

    if (shouldRetry) {
      const delay = Math.min(
        MAX_BACKOFF_MS,
        DEFAULT_BACKOFF_MS * 2 ** Math.max(0, task.attempts - 1)
      );
      task.retryCount += 1;
      task.scheduledAt = new Date(now + delay).toISOString();
      transition(task, 'retrying', {
        workerId,
        reason,
        error: message,
        retryInMs: delay,
      });
      oracleProofTaskRetries.inc({ reason });
      await this.persistRetry(task, workerId, options.allowAnyWorker);
    } else {
      transition(task, 'dead_letter', {
        workerId,
        reason: deadlineExpired ? 'deadline_expired' : reason,
        error: message,
      });
      oracleProofDeadLetterTotal.inc({
        reason: deadlineExpired ? 'deadline_expired' : reason,
      });
      await this.persistDeadLetter(task, workerId, options.allowAnyWorker);
    }
  }

  async persistRetry(task, workerId, allowAnyWorker = false) {
    if (this.storageMode() === 'redis') {
      await this.persistFailureRedis(task, workerId, 'retrying', allowAnyWorker);
      await this.refreshRedisMetrics();
      return;
    }
    this.memory.tasks.set(task.id, task);
    this.refreshMemoryMetrics();
  }

  async persistDeadLetter(task, workerId, allowAnyWorker = false) {
    if (this.storageMode() === 'redis') {
      await this.persistFailureRedis(task, workerId, 'dead_letter', allowAnyWorker);
      await this.refreshRedisMetrics();
      return;
    }
    this.memory.tasks.set(task.id, task);
    this.refreshMemoryMetrics();
  }

  async persistFailureRedis(task, workerId, nextState, allowAnyWorker) {
    const targetQueue = nextState === 'retrying' ? key('pending') : key('dead_letter');
    const targetScore =
      nextState === 'retrying' ? scoreFor(task.scheduledAt, task.priority) : nowMs();
    const script = `
      local taskKey = KEYS[1]
      local processing = KEYS[2]
      local target = KEYS[3]
      local taskId = ARGV[1]
      local workerId = ARGV[2]
      local allowAnyWorker = ARGV[3]
      local nextState = ARGV[4]
      local targetScore = tonumber(ARGV[5])
      local updatedAt = ARGV[6]
      local scheduledAt = ARGV[7]
      local failedAt = ARGV[8]
      local lastError = ARGV[9]
      local retryCount = ARGV[10]
      local history = ARGV[11]
      if redis.call('HGET', taskKey, 'status') ~= 'processing' then return 0 end
      if allowAnyWorker ~= 'true' and redis.call('HGET', taskKey, 'workerId') ~= workerId then return 0 end
      redis.call('ZREM', processing, taskId)
      redis.call('ZADD', target, targetScore, taskId)
      redis.call('HSET', taskKey,
        'status', nextState,
        'scheduledAt', scheduledAt,
        'failedAt', failedAt,
        'lastError', lastError,
        'retryCount', retryCount,
        'updatedAt', updatedAt,
        'history', history
      )
      return 1
    `;
    await redisService.client.eval(
      script,
      3,
      taskKey(task.id),
      key('processing'),
      targetQueue,
      task.id,
      workerId || '',
      allowAnyWorker ? 'true' : 'false',
      nextState,
      targetScore,
      task.updatedAt,
      task.scheduledAt,
      task.failedAt,
      task.lastError,
      String(task.retryCount),
      JSON.stringify(task.history)
    );
  }

  async verifyProofTask(task) {
    const configuredDelay = Number.parseInt(task.payload?.processingMs || '0', 10);
    if (Number.isFinite(configuredDelay) && configuredDelay > 0) {
      await sleep(Math.min(configuredDelay, 5000));
    }

    if (task.deadlineAt && Date.parse(task.deadlineAt) <= nowMs()) {
      const error = new Error('Task deadline expired before verification');
      error.code = 'deadline_expired';
      throw error;
    }

    if (
      task.proof?.forceFail ||
      task.proof?.valid === false ||
      task.payload?.forceFail
    ) {
      const error = new Error('Oracle proof verification failed');
      error.code = 'invalid_proof';
      throw error;
    }

    return {
      verified: true,
      proofType: task.proofType,
      proofHash: task.proofHash,
      outputHash: hashPayload({
        proofHash: task.proofHash,
        payload: task.payload,
        attempts: task.attempts,
      }),
      verifiedAt: nowIso(),
    };
  }

  async processNextTask(workerId = `${this.workerIdBase}-manual`) {
    const task = await this.claimNextTask(workerId);
    if (!task) return null;
    return this.executeClaimedTask(task, workerId);
  }

  async executeClaimedTask(task, workerId) {
    const startedAt = nowMs();
    const heartbeatTimer = setInterval(() => {
      this.heartbeat(task.id, workerId).catch(() => {});
    }, DEFAULT_HEARTBEAT_MS);
    this.workerTimers.add(heartbeatTimer);

    try {
      const result = await this.verifyProofTask(task);
      await this.completeTask(
        task,
        workerId,
        result,
        (nowMs() - startedAt) / 1000
      );
      return { taskId: task.id, status: 'completed', result };
    } catch (error) {
      oracleProofProcessingDuration.observe(
        { outcome: 'failed' },
        (nowMs() - startedAt) / 1000
      );
      await this.failTask(task, workerId, error);
      return {
        taskId: task.id,
        status: task.status,
        error: error.message,
      };
    } finally {
      clearInterval(heartbeatTimer);
      this.workerTimers.delete(heartbeatTimer);
    }
  }

  async recoverStalledTasks() {
    if (this.storageMode() === 'redis') {
      const ids = await redisService.client.zrangebyscore(
        key('processing'),
        '-inf',
        nowMs()
      );
      for (const id of ids) {
        const task = await this.getTask(id);
        if (task?.status === 'processing') {
          await this.failTask(
            task,
            task.workerId,
            new Error('Worker heartbeat expired'),
            { reason: 'heartbeat_expired', allowAnyWorker: true }
          );
        } else {
          await redisService.client.zrem(key('processing'), id);
        }
      }
      await this.refreshRedisMetrics();
      return ids.length;
    }

    let recovered = 0;
    for (const task of this.memory.tasks.values()) {
      if (task.status === 'processing' && Date.parse(task.leaseExpiresAt) <= nowMs()) {
        await this.failTask(task, task.workerId, new Error('Worker heartbeat expired'), {
          reason: 'heartbeat_expired',
          allowAnyWorker: true,
        });
        recovered += 1;
      }
    }
    this.refreshMemoryMetrics();
    return recovered;
  }

  async startWorkers(count = DEFAULT_WORKERS) {
    if (process.env.ORACLE_PROOF_WORKERS_DISABLED === 'true') {
      return { started: 0, disabled: true };
    }

    if (this.storageMode() === 'unavailable') {
      console.warn(
        'Oracle proof queue workers are disabled until Redis is available.'
      );
      return { started: 0, disabled: true, storage: 'unavailable' };
    }

    if (this.workers.size > 0) {
      return { started: 0, running: this.workers.size };
    }

    this.stopping = false;
    await this.recoverStalledTasks().catch(() => {});

    for (let index = 0; index < count; index += 1) {
      const workerId = `${this.workerIdBase}-${index + 1}`;
      this.workers.set(workerId, {
        workerId,
        startedAt: nowIso(),
        processed: 0,
      });
      this.runWorkerLoop(workerId);
    }

    this.recoveryTimer = setInterval(() => {
      this.recoverStalledTasks().catch((error) => {
        console.error('Oracle queue recovery failed:', error.message);
      });
    }, DEFAULT_LOCK_MS);

    return { started: count };
  }

  runWorkerLoop(workerId) {
    const loop = async () => {
      while (!this.stopping && this.workers.has(workerId)) {
        try {
          const result = await this.processNextTask(workerId);
          if (result) {
            const worker = this.workers.get(workerId);
            if (worker) {
              worker.processed += 1;
              worker.lastTaskId = result.taskId;
              worker.lastStatus = result.status;
              worker.lastSeenAt = nowIso();
            }
          } else {
            await sleep(DEFAULT_POLL_MS);
          }
        } catch (error) {
          console.error(`Oracle proof worker ${workerId} failed:`, error.message);
          await sleep(DEFAULT_POLL_MS);
        }
      }
    };

    loop();
  }

  async stopWorkers({ requeueActive = true } = {}) {
    this.stopping = true;
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    for (const timer of this.workerTimers) {
      clearInterval(timer);
    }
    this.workerTimers.clear();

    if (requeueActive) {
      for (const { task, workerId } of this.activeLocalTasks.values()) {
        await this.requeueProcessingTask(task, workerId, 'graceful_shutdown');
      }
    }
    this.activeLocalTasks.clear();
    this.workers.clear();
  }

  async requeueProcessingTask(task, workerId, reason) {
    task.scheduledAt = nowIso();
    transition(task, 'retrying', { workerId, reason });
    if (this.storageMode() === 'redis') {
      await this.persistFailureRedis(task, workerId, 'retrying', true);
    } else {
      this.memory.tasks.set(task.id, task);
    }
  }

  refreshMemoryMetrics() {
    const counts = {
      queued: 0,
      retrying: 0,
      processing: 0,
      completed: 0,
      dead_letter: 0,
      failed: 0,
    };
    for (const task of this.memory.tasks.values()) {
      counts[task.status] = (counts[task.status] || 0) + 1;
    }
    this.updateQueueDepthMetrics(counts);
    return counts;
  }

  async refreshRedisMetrics() {
    if (this.storageMode() !== 'redis') {
      return this.refreshMemoryMetrics();
    }

    const [pending, processing, completed, deadLetter] = await Promise.all([
      redisService.client.zcard(key('pending')),
      redisService.client.zcard(key('processing')),
      redisService.client.zcard(key('completed')),
      redisService.client.zcard(key('dead_letter')),
    ]);
    const counts = {
      queued: pending,
      retrying: 0,
      processing,
      completed,
      dead_letter: deadLetter,
      failed: deadLetter,
    };
    this.updateQueueDepthMetrics(counts);
    return counts;
  }

  async getStatus() {
    const counts =
      this.storageMode() === 'redis'
        ? await this.refreshRedisMetrics()
        : this.refreshMemoryMetrics();
    const recentDeadLetter = await this.listDeadLetter(5);

    return {
      queue: 'oracle-proof-processing',
      storage: this.storageMode(),
      durable: this.storageMode() === 'redis',
      counts,
      workers: [...this.workers.values()],
      settings: {
        maxRetries: DEFAULT_MAX_RETRIES,
        lockMs: DEFAULT_LOCK_MS,
        heartbeatMs: DEFAULT_HEARTBEAT_MS,
        pollMs: DEFAULT_POLL_MS,
        batchLimit: MAX_BATCH_SIZE,
      },
      recentDeadLetter,
      generatedAt: nowIso(),
    };
  }

  async listTasks(state = 'all', limit = 50) {
    const cappedLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 50));
    if (this.storageMode() !== 'redis') {
      return [...this.memory.tasks.values()]
        .filter((task) => state === 'all' || task.status === state)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, cappedLimit);
    }

    let ids;
    if (state === 'queued' || state === 'retrying' || state === 'pending') {
      ids = await redisService.client.zrange(key('pending'), 0, cappedLimit - 1);
    } else if (state === 'processing') {
      ids = await redisService.client.zrange(key('processing'), 0, cappedLimit - 1);
    } else if (state === 'completed') {
      ids = await redisService.client.zrevrange(key('completed'), 0, cappedLimit - 1);
    } else if (state === 'dead_letter' || state === 'failed') {
      ids = await redisService.client.zrevrange(key('dead_letter'), 0, cappedLimit - 1);
    } else {
      ids = (await redisService.client.smembers(key('ids'))).slice(0, cappedLimit);
    }

    const tasks = [];
    for (const id of ids) {
      const task = await this.getTask(id);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async listDeadLetter(limit = 50) {
    return this.listTasks('dead_letter', limit);
  }

  async requeueDeadLetter(id) {
    const task = await this.getTask(id);
    if (!task || task.status !== 'dead_letter') {
      const error = new Error('Dead letter task not found');
      error.statusCode = 404;
      throw error;
    }

    task.attempts = 0;
    task.retryCount = 0;
    task.lastError = '';
    task.failedAt = '';
    task.workerId = '';
    task.scheduledAt = nowIso();
    transition(task, 'queued', { reason: 'manual_requeue' });

    if (this.storageMode() === 'redis') {
      const multi = redisService.client.multi();
      multi.zrem(key('dead_letter'), task.id);
      multi.zadd(key('pending'), scoreFor(task.scheduledAt, task.priority), task.id);
      multi.hset(taskKey(task.id), serializeTask(task));
      await multi.exec();
      await this.refreshRedisMetrics();
    } else {
      this.memory.tasks.set(task.id, task);
      this.refreshMemoryMetrics();
    }

    return task;
  }
}

const oracleProofQueueService = new OracleProofQueueService();

export {
  normalizeProofTask,
  scoreFor,
};

export default oracleProofQueueService;
