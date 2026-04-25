jest.mock('../src/services/compileService.js', () => ({
  compileQueued: jest.fn(),
  compileBatch: jest.fn(),
  getCompileSnapshot: jest.fn(),
  compileProgressBus: { on: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import compileRouter from '../src/routes/compile.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { compileQueued, compileBatch } from '../src/services/compileService.js';

const app = express();
app.use(express.json());
app.use('/api/compile', compileRouter);
app.use(errorHandler);

describe('POST /api/compile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 if no code is provided', async () => {
    const res = await request(app).post('/api/compile').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'No code provided',
      statusCode: 400,
    });
  });

  it('rejects invalid dependencies', async () => {
    const res = await request(app).post('/api/compile').send({
      code: '#![no_std]',
      dependencies: [],
    });

    expect(res.status).toBe(400);
  });

  it('returns cache hit results from the service', async () => {
    compileQueued.mockResolvedValue({
      cached: true,
      hash: 'abc',
      durationMs: 0,
      logs: ['Cache hit: returned existing WASM artifact'],
      artifact: { name: 'abc.wasm', sizeBytes: 128, path: '/tmp/abc.wasm' },
    });

    const res = await request(app).post('/api/compile').send({
      code: 'fn main() {}',
    });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.artifact.name).toBe('abc.wasm');
  });

  it('returns batch compile results', async () => {
    compileBatch.mockResolvedValue([
      {
        status: 'fulfilled',
        value: {
          cached: false,
          artifact: { name: 'a.wasm', sizeBytes: 42, path: '/tmp/a.wasm' },
        },
      },
    ]);

    const res = await request(app)
      .post('/api/compile/batch')
      .send({
        contracts: [{ code: 'fn a() {}' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });
});
