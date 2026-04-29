import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/services/compileService.js', () => ({
  compileQueued: jest.fn(),
  compileBatch: jest.fn(),
  getCompileSnapshot: jest.fn(),
  compileProgressBus: { on: jest.fn() },
}));

const { compileQueued, compileBatch } = await import('../src/services/compileService.js');

import express from 'express';
import request from 'supertest';
const { default: compileRouter } = await import('../src/routes/v1/compile.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/compile', compileRouter);
app.use(errorHandler);

describe('POST /api/compile batch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cached compile results quickly', async () => {
    compileQueued.mockResolvedValue({
      cached: true,
      hash: 'abc',
      durationMs: 0,
      logs: ['Cache hit: returned existing WASM artifact'],
      artifact: { name: 'abc.wasm', sizeBytes: 128, path: '/tmp/abc.wasm' },
    });

    const res = await request(app)
      .post('/api/compile')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(compileQueued).toHaveBeenCalled();
  });

  it('accepts batch compile jobs', async () => {
    compileBatch.mockResolvedValue([
      {
        status: 'fulfilled',
        value: { cached: false, artifact: { name: 'a.wasm' } },
      },
    ]);

    const res = await request(app)
      .post('/api/compile/batch')
      .send({
        contracts: [{ code: 'fn a() {}' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(compileBatch).toHaveBeenCalled();
  });
});
