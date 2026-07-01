import Redis from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';

const DEFAULT_QUEUE_PREFIX = process.env.BULLMQ_QUEUE_PREFIX || 'bull';
const DEFAULT_MAX_ATTEMPTS = Number.parseInt(
  process.env.BULLMQ_JOB_MAX_ATTEMPTS || '4',
  10
);
const DEFAULT_BACKOFF_DELAY_MS = Number.parseInt(
  process.env.BULLMQ_RETRY_BACKOFF_MS || '1000',
  10
);
const DEFAULT_BACKOFF_JITTER = Number.parseFloat(
  process.env.BULLMQ_RETRY_JITTER || '0.2'
);
const DEFAULT_STACK_TRACE_LIMIT = Number.parseInt(
  process.env.BULLMQ_STACK_TRACE_LIMIT || '10',
  10
);
const DLQ_SUFFIX = 'dlq';

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getDlqQueueName(queueName) {
  return `${queueName}:${DLQ_SUFFIX}`;
}

export function createRedisConnection(options = {}) {
  if (options.connection) return options.connection;

  const url =
    options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(url, {
    connectionName: options.connectionName || 'soroban-bullmq',
    maxRetriesPerRequest: null,
  });
}

export function createRetryBackoffOptions(options = {}) {
  const attempts = clampNumber(
    options.maxAttempts ?? options.attempts,
    1,
    50,
    DEFAULT_MAX_ATTEMPTS
  );
  const delay = clampNumber(
    options.baseDelayMs ?? options.delay,
    1,
    24 * 60 * 60 * 1000,
    DEFAULT_BACKOFF_DELAY_MS
  );
  const jitter = clampNumber(options.jitter, 0, 1, DEFAULT_BACKOFF_JITTER);
  const stackTraceLimit = clampNumber(
    options.stackTraceLimit,
    0,
    100,
    DEFAULT_STACK_TRACE_LIMIT
  );

  return {
    attempts,
    backoff: {
      type: 'exponential',
      delay,
      jitter,
    },
    stackTraceLimit,
  };
}

export function calculateExponentialBackoffDelay({
  attemptsMade,
  baseDelayMs = DEFAULT_BACKOFF_DELAY_MS,
  jitter = DEFAULT_BACKOFF_JITTER,
  random = Math.random,
} = {}) {
  const attempt = Math.max(1, Number.parseInt(attemptsMade, 10) || 1);
  const maxDelay = Math.round(2 ** (attempt - 1) * baseDelayMs);

  if (jitter <= 0) return maxDelay;

  const normalizedJitter = clampNumber(jitter, 0, 1, DEFAULT_BACKOFF_JITTER);
  const minDelay = maxDelay * (1 - normalizedJitter);
  return Math.floor(random() * maxDelay * normalizedJitter + minDelay);
}

export function isFinalAttempt(job) {
  const configuredAttempts = Number.parseInt(job?.opts?.attempts || '1', 10);
  const attemptsMade = Number.parseInt(job?.attemptsMade || '0', 10);
  return attemptsMade >= configuredAttempts;
}

export function buildFailureMetadata(job, error) {
  const failedReason = job?.failedReason || error?.message || 'Job failed';
  const stacktrace = Array.isArray(job?.stacktrace)
    ? job.stacktrace.filter(Boolean)
    : [];

  return {
    failedReason,
    attemptsMade: job?.attemptsMade || 0,
    maxAttempts: job?.opts?.attempts || 1,
    failedAt: nowIso(),
    stacktrace,
  };
}

export async function decorateJobWithFailureMetadata(job, error) {
  if (!job?.updateData) return buildFailureMetadata(job, error);

  const failure = buildFailureMetadata(job, error);
  const nextData = {
    ...(job.data || {}),
    metadata: {
      ...(job.data?.metadata || {}),
      failure,
      failures: [...(job.data?.metadata?.failures || []), failure].slice(-10),
    },
  };

  await job.updateData(nextData);
  job.data = nextData;

  return failure;
}

export function buildDlqPayload(job, failure) {
  return {
    originalQueue: job?.queueName,
    originalJobId: String(job?.id || ''),
    originalJobName: job?.name,
    data: job?.data || {},
    opts: job?.opts || {},
    failure,
    routedAt: nowIso(),
  };
}

export async function routeFailedJobToDlq({
  job,
  error,
  dlqQueue,
  removeOriginal = false,
} = {}) {
  if (!job) {
    return { routed: false, reason: 'missing_job' };
  }

  const failure = await decorateJobWithFailureMetadata(job, error);

  if (!dlqQueue || !isFinalAttempt(job)) {
    return { routed: false, reason: 'not_final_attempt', failure };
  }

  const payload = buildDlqPayload(job, failure);
  const dlqJobId = `${job.queueName || 'unknown'}:${job.id}`;

  await dlqQueue.add(job.name || 'failed-job', payload, {
    jobId: dlqJobId,
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  });

  if (removeOriginal && job.remove) {
    await job.remove();
  }

  return {
    routed: true,
    dlqJobId,
    failure,
  };
}

export function createBullQueue(queueName, options = {}) {
  const connection = createRedisConnection(options);
  const queue = new Queue(queueName, {
    connection,
    prefix: options.prefix || DEFAULT_QUEUE_PREFIX,
    defaultJobOptions: {
      removeOnComplete: options.removeOnComplete ?? 1000,
      removeOnFail: options.removeOnFail ?? false,
      ...createRetryBackoffOptions(options),
      ...(options.defaultJobOptions || {}),
    },
  });

  return { queue, connection };
}

export function createBullWorkerWithDlq(queueName, processor, options = {}) {
  const connection = createRedisConnection(options);
  const dlqQueueName = options.dlqQueueName || getDlqQueueName(queueName);
  const dlqQueue =
    options.dlqQueue ||
    new Queue(dlqQueueName, {
      connection,
      prefix: options.prefix || DEFAULT_QUEUE_PREFIX,
    });
  const events =
    options.queueEvents ||
    new QueueEvents(queueName, {
      connection,
      prefix: options.prefix || DEFAULT_QUEUE_PREFIX,
    });
  const worker = new Worker(queueName, processor, {
    connection,
    prefix: options.prefix || DEFAULT_QUEUE_PREFIX,
    concurrency: options.concurrency || 1,
    settings: options.settings,
  });

  worker.on('failed', async (job, error) => {
    try {
      await routeFailedJobToDlq({
        job,
        error,
        dlqQueue,
        removeOriginal: options.removeOriginalOnDlq || false,
      });
    } catch (dlqError) {
      worker.emit('error', dlqError);
    }
  });

  return {
    worker,
    dlqQueue,
    events,
    connection,
  };
}

export async function replayDlqJobs({
  sourceQueue,
  dlqQueue,
  limit = 100,
  removeAfterReplay = true,
} = {}) {
  const cappedLimit = Math.min(
    1000,
    Math.max(1, Number.parseInt(limit, 10) || 100)
  );
  const jobs = await dlqQueue.getJobs(
    ['waiting', 'delayed', 'failed', 'paused'],
    0,
    cappedLimit - 1,
    false
  );
  const replayed = [];

  for (const dlqJob of jobs) {
    const payload = dlqJob.data || {};
    const originalOpts = payload.opts || {};
    const data = {
      ...(payload.data || {}),
      metadata: {
        ...(payload.data?.metadata || {}),
        replayedFromDlq: {
          dlqJobId: String(dlqJob.id),
          originalJobId: payload.originalJobId,
          replayedAt: nowIso(),
        },
      },
    };

    const replayedJob = await sourceQueue.add(
      payload.originalJobName || dlqJob.name,
      data,
      {
        ...originalOpts,
        jobId: undefined,
        ...createRetryBackoffOptions({
          maxAttempts: originalOpts.attempts,
          baseDelayMs: originalOpts.backoff?.delay,
          jitter: originalOpts.backoff?.jitter,
          stackTraceLimit: originalOpts.stackTraceLimit,
        }),
      }
    );

    replayed.push({
      dlqJobId: String(dlqJob.id),
      replayedJobId: String(replayedJob.id),
    });

    if (removeAfterReplay && dlqJob.remove) {
      await dlqJob.remove();
    }
  }

  return replayed;
}

export async function purgeDlqJobs({ dlqQueue, limit = 1000 } = {}) {
  const states = ['waiting', 'delayed', 'failed', 'paused', 'completed'];
  let purged = 0;
  let foundJobs = true;

  while (foundJobs) {
    foundJobs = false;
    for (const state of states) {
      const jobs = await dlqQueue.getJobs([state], 0, limit - 1, false);
      if (jobs.length > 0) foundJobs = true;

      for (const job of jobs) {
        if (job.remove) {
          await job.remove();
          purged += 1;
        }
      }
    }
  }

  return purged;
}

export async function closeBullResources(resources = {}) {
  for (const resource of [
    resources.worker,
    resources.events,
    resources.queue,
    resources.dlqQueue,
  ]) {
    if (resource?.close) {
      await resource.close();
    }
  }

  if (resources.connection?.quit) {
    await resources.connection.quit();
  }
}
