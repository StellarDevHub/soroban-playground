#!/usr/bin/env node

import {
  closeBullResources,
  createBullQueue,
  getDlqQueueName,
  purgeDlqJobs,
  replayDlqJobs,
} from '../src/services/bullmqDlqService.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    queue: process.env.BULLMQ_QUEUE_NAME,
    limit: 100,
    removeAfterReplay: true,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--queue' || arg === '-q') {
      options.queue = rest[index + 1];
      index += 1;
    } else if (arg === '--limit' || arg === '-l') {
      options.limit = Number.parseInt(rest[index + 1], 10);
      index += 1;
    } else if (arg === '--keep') {
      options.removeAfterReplay = false;
    } else if (arg === '--redis-url') {
      options.redisUrl = rest[index + 1];
      index += 1;
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  node scripts/dlq.js list --queue <queue-name> [--limit 100]
  node scripts/dlq.js replay --queue <queue-name> [--limit 100] [--keep]
  node scripts/dlq.js purge --queue <queue-name> [--limit 1000]

Environment:
  REDIS_URL              Redis connection URL
  BULLMQ_QUEUE_NAME      Default source queue name
`);
}

async function listDlqJobs(dlqQueue, limit) {
  const jobs = await dlqQueue.getJobs(
    ['waiting', 'delayed', 'failed', 'paused', 'completed'],
    0,
    Math.max(1, limit) - 1,
    false
  );

  return jobs.map((job) => ({
    dlqJobId: String(job.id),
    name: job.name,
    originalQueue: job.data?.originalQueue,
    originalJobId: job.data?.originalJobId,
    failedReason: job.data?.failure?.failedReason,
    attemptsMade: job.data?.failure?.attemptsMade,
    routedAt: job.data?.routedAt,
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (
    !['list', 'replay', 'purge'].includes(options.command) ||
    !options.queue
  ) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const source = createBullQueue(options.queue, {
    redisUrl: options.redisUrl,
  });
  const dlq = createBullQueue(getDlqQueueName(options.queue), {
    redisUrl: options.redisUrl,
  });

  try {
    if (options.command === 'list') {
      const jobs = await listDlqJobs(dlq.queue, options.limit);
      console.log(JSON.stringify({ count: jobs.length, jobs }, null, 2));
    } else if (options.command === 'replay') {
      const replayed = await replayDlqJobs({
        sourceQueue: source.queue,
        dlqQueue: dlq.queue,
        limit: options.limit,
        removeAfterReplay: options.removeAfterReplay,
      });
      console.log(
        JSON.stringify({ count: replayed.length, replayed }, null, 2)
      );
    } else if (options.command === 'purge') {
      const purged = await purgeDlqJobs({
        dlqQueue: dlq.queue,
        limit: options.limit || 1000,
      });
      console.log(JSON.stringify({ purged }, null, 2));
    }
  } finally {
    await closeBullResources({
      queue: source.queue,
      dlqQueue: dlq.queue,
      connection: source.connection,
    });
    await closeBullResources({
      connection: dlq.connection,
    });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
