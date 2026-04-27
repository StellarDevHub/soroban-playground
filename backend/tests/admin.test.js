jest.mock('../src/services/cacheService.js', () => ({
  invalidateCache: jest.fn(),
  warmCache: jest.fn(),
  listCacheKeys: jest.fn(),
  getCacheAdminSnapshot: jest.fn(),
  bumpCacheVersion: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import adminRouter from '../src/routes/admin.js';
import {
  invalidateCache,
  warmCache,
  listCacheKeys,
  getCacheAdminSnapshot,
  bumpCacheVersion,
} from '../src/services/cacheService.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

describe('Admin cache endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cache snapshot', async () => {
    getCacheAdminSnapshot.mockResolvedValue({ cacheVersion: 'v1', memoryEntries: 0 });
    const res = await request(app).get('/api/admin/cache');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.snapshot.cacheVersion).toBe('v1');
  });

  it('warms cache entries', async () => {
    warmCache.mockResolvedValue({ warmed: ['abc'], warmedCount: 1 });
    const res = await request(app)
      .post('/api/admin/cache/warm')
      .send({ hashes: ['abc'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(warmCache).toHaveBeenCalledWith({ hashes: ['abc'], top: undefined });
  });

  it('invalidates by hash', async () => {
    invalidateCache.mockResolvedValue({ hashes: ['abc'] });
    const res = await request(app)
      .post('/api/admin/cache/invalidate')
      .send({ hash: 'abc' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(invalidateCache).toHaveBeenCalledWith({ hash: 'abc', dependency: undefined, namespace: undefined });
  });

  it('bumps cache version', async () => {
    bumpCacheVersion.mockResolvedValue('v2');
    const res = await request(app)
      .post('/api/admin/cache/version/bump')
      .send({ version: 'v2' });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v2');
  });
});
