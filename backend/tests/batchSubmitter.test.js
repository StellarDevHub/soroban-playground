// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import { BatchSubmitter } from '../src/services/batchSubmitter.js';
import { NoncePool, NoncePoolRegistry } from '../src/services/noncePool.js';
import batchRouter from '../src/routes/batchSubmitter.js';

// ── NoncePool unit tests ──────────────────────────────────────────────────────

describe('NoncePool', () => {
  it('initializes sequence from fetchFn on first acquire', async () => {
    const fetch = jest.fn().mockResolvedValue('1000');
    const pool = new NoncePool('GABC', fetch);
    const seq = await pool.acquire();
    expect(fetch).toHaveBeenCalledWith('GABC');
    expect(seq).toBe(1001n);
  });

  it('increments sequence atomically on each acquire', async () => {
    const fetch = jest.fn().mockResolvedValue('500');
    const pool = new NoncePool('GABC', fetch);
    const [s1, s2, s3] = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ]);
    const seqs = [s1, s2, s3].map(Number).sort((a, b) => a - b);
    expect(seqs).toEqual([501, 502, 503]);
  });

  it('only calls fetchFn once on repeated acquires', async () => {
    const fetch = jest.fn().mockResolvedValue('100');
    const pool = new NoncePool('GABC', fetch);
    await pool.acquire();
    await pool.acquire();
    await pool.acquire();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resyncs sequence from ledger on resync()', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('200');
    const pool = new NoncePool('GABC', fetch);
    await pool.acquire(); // init to 100, seq = 101
    await pool.resync(); // fetch again → 200
    const seq = await pool.acquire();
    expect(seq).toBe(201n);
  });
});

describe('NoncePoolRegistry', () => {
  it('returns the same pool for the same account', () => {
    const fetch = jest.fn();
    const registry = new NoncePoolRegistry(fetch);
    const p1 = registry.getPool('GABC');
    const p2 = registry.getPool('GABC');
    expect(p1).toBe(p2);
  });

  it('returns different pools for different accounts', () => {
    const fetch = jest.fn();
    const registry = new NoncePoolRegistry(fetch);
    const p1 = registry.getPool('GABC');
    const p2 = registry.getPool('GXYZ');
    expect(p1).not.toBe(p2);
  });
});

// ── BatchSubmitter unit tests ─────────────────────────────────────────────────

describe('BatchSubmitter', () => {
  function makeSubmitter(submitFn, opts = {}) {
    return new BatchSubmitter({
      fetchSequenceFn: jest.fn().mockResolvedValue('1000'),
      submitFn,
      maxWaitMs: 50,
      retryDelayMs: 10,
      ...opts,
    });
  }

  it('submits a single transaction and returns hash', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'txhash1' });
    const s = makeSubmitter(submit);
    const result = await s.submit({
      id: 'tx1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(result).toEqual({ txId: 'tx1', hash: 'txhash1' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].seq).toBe(1001n);
  });

  it('assigns unique sequence numbers to concurrent transactions', async () => {
    const seqsSeen = [];
    const submit = jest.fn().mockImplementation(async (envelope) => {
      seqsSeen.push(Number(envelope.seq));
      return { hash: `hash-${envelope.seq}` };
    });
    const s = makeSubmitter(submit, { maxBatchSize: 5 });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        s.submit({
          id: `tx${i}`,
          sourceAccount: 'GABC',
          buildEnvelope: (seq) => ({ seq }),
        })
      )
    );

    expect(results).toHaveLength(5);
    const unique = new Set(seqsSeen);
    expect(unique.size).toBe(5);
    results.forEach((r) => expect(r).toHaveProperty('hash'));
  });

  it('retries on failure and resolves after retry succeeds', async () => {
    let calls = 0;
    const submit = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('network error');
      return { hash: 'recovered' };
    });
    const s = makeSubmitter(submit, { retryAttempts: 3, retryDelayMs: 5 });
    const result = await s.submit({
      id: 'tx1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    expect(result.hash).toBe('recovered');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('rejects after exhausting retry attempts', async () => {
    const submit = jest.fn().mockRejectedValue(new Error('permanent'));
    const s = makeSubmitter(submit, { retryAttempts: 2, retryDelayMs: 5 });
    await expect(
      s.submit({
        id: 'tx1',
        sourceAccount: 'GABC',
        buildEnvelope: (seq) => ({ seq }),
      })
    ).rejects.toThrow('permanent');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('flush() drains all queued transactions immediately', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxWaitMs: 60000 }); // very long timer
    const promises = Array.from({ length: 3 }, (_, i) =>
      s.submit({
        id: `tx${i}`,
        sourceAccount: 'GABC',
        buildEnvelope: (seq) => ({ seq }),
      })
    );
    expect(s.queueLength).toBe(3);
    await s.flush();
    expect(s.queueLength).toBe(0);
    await Promise.all(promises);
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it('emits batch:submitted event after flushing', async () => {
    const submit = jest.fn().mockResolvedValue({ hash: 'h' });
    const s = makeSubmitter(submit, { maxBatchSize: 2 });
    const events = [];
    s.on('batch:submitted', (e) => events.push(e));
    await s.submit({
      id: 't1',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    await s.submit({
      id: 't2',
      sourceAccount: 'GABC',
      buildEnvelope: (seq) => ({ seq }),
    });
    // maxBatchSize reached, flush triggered automatically
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('batchId');
    expect(events[0].count).toBe(2);
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('POST /api/batch/submit', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/batch', batchRouter);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/batch/submit').send({ id: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 200 and hash for a valid submission', async () => {
    const res = await request(app)
      .post('/api/batch/submit')
      .send({
        id: 'route-tx1',
        sourceAccount: 'GABC',
        payload: { type: 'invoke', contractId: 'C123' },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('txId', 'route-tx1');
    expect(res.body.data).toHaveProperty('hash');
  });

  it('GET /api/batch/status returns queue length', async () => {
    const res = await request(app).get('/api/batch/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('queueLength');
  });

  it('POST /api/batch/flush returns 200', async () => {
    const res = await request(app).post('/api/batch/flush').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
