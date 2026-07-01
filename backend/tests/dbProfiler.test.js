/**
 * Tests for DB query profiler middleware (#755)
 */
import express from 'express';
import request from 'supertest';
import { createDbProfilerMiddleware } from '../src/middleware/dbProfiler.js';

function makeDb() {
  return {
    get: jest.fn(async () => ({ id: 1 })),
    all: jest.fn(async () => [{ id: 1 }, { id: 2 }]),
    run: jest.fn(async () => ({ changes: 1 })),
  };
}

function buildApp(db, routeFn) {
  const app = express();
  app.use(createDbProfilerMiddleware(db));
  app.get('/test', routeFn);
  return app;
}

describe('createDbProfilerMiddleware (#755)', () => {
  it('attaches dbMetrics to req', async () => {
    const db = makeDb();
    let capturedMetrics;
    const app = buildApp(db, async (req, res) => {
      await db.get('SELECT 1');
      capturedMetrics = req.dbMetrics;
      res.json({ ok: true });
    });

    await request(app).get('/test');
    expect(capturedMetrics).toBeDefined();
    expect(capturedMetrics.queries).toBe(1);
    expect(typeof capturedMetrics.totalMs).toBe('number');
  });

  it('counts multiple queries correctly', async () => {
    const db = makeDb();
    let capturedMetrics;
    const app = buildApp(db, async (req, res) => {
      await db.get('SELECT 1');
      await db.all('SELECT * FROM contracts');
      await db.run('INSERT INTO foo VALUES (1)');
      capturedMetrics = req.dbMetrics;
      res.json({ ok: true });
    });

    await request(app).get('/test');
    expect(capturedMetrics.queries).toBe(3);
  });

  it('groups queries by signature and detects duplicates', async () => {
    const db = makeDb();
    let capturedMetrics;
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const app = buildApp(db, async (req, res) => {
      for (let i = 0; i < 4; i++) {
        await db.get(`SELECT * FROM contracts WHERE id = ${i}`);
      }
      capturedMetrics = req.dbMetrics;
      res.json({ ok: true });
    });

    await request(app).get('/test');

    // All 4 map to the same normalised signature
    const sigs = Object.values(capturedMetrics.bySignature);
    expect(sigs.length).toBe(1);
    expect(sigs[0].count).toBe(4);

    // Should have warned about N+1
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('N+1'));
    consoleSpy.mockRestore();
  });

  it('does not interfere with the db after the response finishes', async () => {
    const db = makeDb();
    const app = buildApp(db, async (req, res) => {
      await db.get('SELECT 1');
      res.json({ ok: true });
    });

    await request(app).get('/test');

    // Calling db.get directly after response should use original mock (not wrapper)
    const result = await db.get('SELECT original');
    expect(result).toEqual({ id: 1 });
  });

  it('accumulates totalMs across all queries', async () => {
    const db = makeDb();
    db.get = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { id: 1 };
    });

    let capturedMetrics;
    const app = buildApp(db, async (req, res) => {
      await db.get('SELECT 1');
      await db.get('SELECT 2');
      capturedMetrics = req.dbMetrics;
      res.json({ ok: true });
    });

    await request(app).get('/test');
    expect(capturedMetrics.totalMs).toBeGreaterThanOrEqual(2);
  });
});
