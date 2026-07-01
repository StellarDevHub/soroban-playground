import {
  calculateExponentialBackoffDelay,
  createRetryBackoffOptions,
  decorateJobWithFailureMetadata,
  replayDlqJobs,
  routeFailedJobToDlq,
} from '../src/services/bullmqDlqService.js';

function createJob(overrides = {}) {
  const job = {
    id: 'job-1',
    name: 'compile',
    queueName: 'compile',
    data: {
      source: 'contract',
      metadata: {
        requestId: 'req-1',
      },
    },
    opts: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
        jitter: 0.2,
      },
      stackTraceLimit: 10,
    },
    attemptsMade: 3,
    failedReason: 'persistent failure',
    stacktrace: ['Error: persistent failure\n    at worker.js:10:3'],
    updateData: jest.fn(async (data) => {
      job.data = data;
    }),
    remove: jest.fn(async () => {}),
    ...overrides,
  };
  return job;
}

describe('BullMQ DLQ failure recovery helpers', () => {
  it('configures BullMQ attempts and exponential backoff with jitter', () => {
    expect(
      createRetryBackoffOptions({
        maxAttempts: 5,
        baseDelayMs: 750,
        jitter: 0.3,
      })
    ).toEqual({
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 750,
        jitter: 0.3,
      },
      stackTraceLimit: 10,
    });
  });

  it('calculates precise exponential retry intervals with factor 2', () => {
    expect(
      [1, 2, 3, 4].map((attemptsMade) =>
        calculateExponentialBackoffDelay({
          attemptsMade,
          baseDelayMs: 500,
          jitter: 0,
        })
      )
    ).toEqual([500, 1000, 2000, 4000]);
  });

  it('applies bounded random jitter to retry intervals', () => {
    const delay = calculateExponentialBackoffDelay({
      attemptsMade: 3,
      baseDelayMs: 1000,
      jitter: 0.25,
      random: () => 0.5,
    });

    expect(delay).toBe(3500);
  });

  it('stores detailed failure stack traces in job metadata', async () => {
    const job = createJob();
    const failure = await decorateJobWithFailureMetadata(
      job,
      new Error('boom')
    );

    expect(failure).toMatchObject({
      failedReason: 'persistent failure',
      attemptsMade: 3,
      maxAttempts: 3,
      stacktrace: ['Error: persistent failure\n    at worker.js:10:3'],
    });
    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestId: 'req-1',
          failure: expect.objectContaining({
            failedReason: 'persistent failure',
          }),
          failures: [
            expect.objectContaining({
              stacktrace: ['Error: persistent failure\n    at worker.js:10:3'],
            }),
          ],
        }),
      })
    );
  });

  it('routes persistent failures to the DLQ only after retries are exhausted', async () => {
    const dlqQueue = {
      add: jest.fn(async () => ({ id: 'compile:job-1' })),
    };

    const transient = await routeFailedJobToDlq({
      job: createJob({ attemptsMade: 2 }),
      error: new Error('transient'),
      dlqQueue,
    });

    expect(transient).toMatchObject({
      routed: false,
      reason: 'not_final_attempt',
      failure: {
        attemptsMade: 2,
      },
    });
    expect(dlqQueue.add).not.toHaveBeenCalled();

    const persistentJob = createJob();
    const persistent = await routeFailedJobToDlq({
      job: persistentJob,
      error: new Error('persistent'),
      dlqQueue,
    });

    expect(persistent).toMatchObject({
      routed: true,
      dlqJobId: 'compile:job-1',
      failure: {
        failedReason: 'persistent failure',
        attemptsMade: 3,
      },
    });
    expect(dlqQueue.add).toHaveBeenCalledWith(
      'compile',
      expect.objectContaining({
        originalQueue: 'compile',
        originalJobId: 'job-1',
        failure: expect.objectContaining({
          stacktrace: ['Error: persistent failure\n    at worker.js:10:3'],
        }),
      }),
      expect.objectContaining({
        attempts: 1,
        jobId: 'compile:job-1',
      })
    );
  });

  it('replays DLQ jobs into the source queue and removes replayed entries', async () => {
    const dlqJob = {
      id: 'compile:job-1',
      name: 'compile',
      data: {
        originalJobId: 'job-1',
        originalJobName: 'compile',
        data: {
          source: 'contract',
          metadata: {
            requestId: 'req-1',
          },
        },
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
            jitter: 0.2,
          },
        },
      },
      remove: jest.fn(async () => {}),
    };
    const dlqQueue = {
      getJobs: jest.fn(async () => [dlqJob]),
    };
    const sourceQueue = {
      add: jest.fn(async () => ({ id: 'job-2' })),
    };

    const replayed = await replayDlqJobs({
      sourceQueue,
      dlqQueue,
      limit: 10,
    });

    expect(replayed).toEqual([
      {
        dlqJobId: 'compile:job-1',
        replayedJobId: 'job-2',
      },
    ]);
    expect(sourceQueue.add).toHaveBeenCalledWith(
      'compile',
      expect.objectContaining({
        source: 'contract',
        metadata: expect.objectContaining({
          requestId: 'req-1',
          replayedFromDlq: expect.objectContaining({
            dlqJobId: 'compile:job-1',
            originalJobId: 'job-1',
          }),
        }),
      }),
      expect.objectContaining({
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
          jitter: 0.2,
        },
      })
    );
    expect(dlqJob.remove).toHaveBeenCalled();
  });
});
