// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { responseCacheMiddleware } from '../src/middleware/cacheMiddleware.js';
import redisService from '../src/services/redisService.js';
import express from 'express';
import request from 'supertest';
import etag from 'etag';

jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

describe('Response Cache Middleware', () => {
  let app;
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = jest.fn((req, res) => {
      res.json({ message: 'hello world' });
    });

    app = express();
    app.use(express.json());
    app.use(responseCacheMiddleware({ prefix: 'test:', ttl: 60 }));
    app.all('/test-endpoint', handler);
  });

  it('should pass through and cache on cache miss', async () => {
    redisService.get.mockResolvedValue(null);

    const res = await request(app).get('/test-endpoint').query({ q: 'test' });

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['etag']).toBeDefined();
    expect(res.body).toEqual({ message: 'hello world' });
    expect(handler).toHaveBeenCalledTimes(1);

    // Should save to Redis
    expect(redisService.set).toHaveBeenCalled();
  });

  it('should return cached response on cache hit and skip handler', async () => {
    const cachedData = JSON.stringify({ message: 'cached' });
    redisService.get.mockResolvedValue(cachedData);

    const res = await request(app).get('/test-endpoint').query({ q: 'test' });

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('HIT');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['etag']).toBe(etag(cachedData));
    expect(res.body).toEqual({ message: 'cached' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support conditional GET with ETag / If-None-Match', async () => {
    const cachedData = JSON.stringify({ message: 'cached' });
    redisService.get.mockResolvedValue(cachedData);
    const expectedEtag = etag(cachedData);

    const res = await request(app)
      .get('/test-endpoint')
      .set('If-None-Match', expectedEtag);

    expect(res.status).toBe(304);
    expect(res.headers['etag']).toBe(expectedEtag);
    expect(res.text).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should bypass cache when bypass header is true', async () => {
    redisService.get.mockResolvedValue(JSON.stringify({ message: 'cached' }));

    const res = await request(app)
      .get('/test-endpoint')
      .set('x-cache-bypass', 'true');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('BYPASS');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redisService.get).not.toHaveBeenCalled();
  });
});
