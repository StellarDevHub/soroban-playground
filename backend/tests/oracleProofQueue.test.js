import express from 'express';
import request from 'supertest';
import oracleRouter from '../src/routes/oracle.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import oracleProofQueueService from '../src/services/oracleProofQueueService.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/oracle', oracleRouter);
app.use(errorHandler);

function proofTask(overrides = {}) {
  return {
    proofType: 'price_attestation',
    proof: {
      oracle: 'demo-oracle',
      asset: 'sBTC',
      price: 68420,
      signature: 'demo-signature',
      valid: true,
    },
    payload: {
      source: 'test',
    },
    ...overrides,
  };
}

describe('oracle proof distributed task queue', () => {
  beforeEach(async () => {
    await oracleProofQueueService.stopWorkers({ requeueActive: false });
    oracleProofQueueService.resetForTests();
  });

  it('queues a proof task through the producer API', async () => {
    const res = await request(app)
      .post('/api/oracle/proofs')
      .send(proofTask({ priority: 90, maxRetries: 2 }));

    expect(res.status).toBe(202);
    expect(res.body.data.task).toMatchObject({
      proofType: 'price_attestation',
      priority: 90,
      maxRetries: 2,
      status: 'queued',
    });
  });

  it('accepts 1000 proof submissions in one batch', async () => {
    const tasks = Array.from({ length: 1000 }, (_, index) =>
      proofTask({
        idempotencyKey: `batch-${index}`,
        payload: { index },
      })
    );

    const res = await request(app)
      .post('/api/oracle/proofs/batch')
      .send({ tasks });

    expect(res.status).toBe(202);
    expect(res.body.data.count).toBe(1000);

    const status = await oracleProofQueueService.getStatus();
    expect(status.counts.queued).toBe(1000);
  });

  it('claims higher priority tasks first when scheduled time matches', async () => {
    const scheduledAt = new Date(Date.now() - 1000).toISOString();
    const low = await oracleProofQueueService.enqueueProofTask(
      proofTask({ priority: 10, scheduledAt }),
      { source: 'test' }
    );
    const high = await oracleProofQueueService.enqueueProofTask(
      proofTask({ priority: 95, scheduledAt }),
      { source: 'test' }
    );

    const claimed = await oracleProofQueueService.claimNextTask('worker-a');

    expect(claimed.id).toBe(high.task.id);
    expect(claimed.id).not.toBe(low.task.id);
    expect(claimed.status).toBe('processing');
  });

  it('retries failed tasks with backoff and then moves them to dead letter', async () => {
    const queued = await oracleProofQueueService.enqueueProofTask(
      proofTask({
        maxRetries: 1,
        proof: { valid: false },
      }),
      { source: 'test' }
    );

    const firstRun = await oracleProofQueueService.processNextTask('worker-a');
    expect(firstRun.status).toBe('retrying');

    const retrying = oracleProofQueueService.memory.tasks.get(queued.task.id);
    retrying.scheduledAt = new Date(Date.now() - 1000).toISOString();

    const secondRun = await oracleProofQueueService.processNextTask('worker-a');
    expect(secondRun.status).toBe('dead_letter');

    const deadLetter = await oracleProofQueueService.listDeadLetter();
    expect(deadLetter).toHaveLength(1);
    expect(deadLetter[0]).toMatchObject({
      id: queued.task.id,
      status: 'dead_letter',
      attempts: 2,
    });
  });

  it('manually requeues dead letter tasks for inspection workflows', async () => {
    const queued = await oracleProofQueueService.enqueueProofTask(
      proofTask({
        maxRetries: 0,
        proof: { forceFail: true },
      }),
      { source: 'test' }
    );

    await oracleProofQueueService.processNextTask('worker-a');
    const requeued = await oracleProofQueueService.requeueDeadLetter(
      queued.task.id
    );

    expect(requeued).toMatchObject({
      id: queued.task.id,
      status: 'queued',
      attempts: 0,
    });
  });
});
