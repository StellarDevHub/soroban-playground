// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

jest.unstable_mockModule('../src/services/compileService.js', () => ({
  getCompileStats: jest.fn(),
  getCompileSnapshot: jest.fn(),
  initializeCompileService: jest.fn(),
}));

jest.unstable_mockModule('../src/services/redisService.js', () => ({
  default: { isConnected: false, get: jest.fn(), set: jest.fn() },
}));

const { setupSwagger, swaggerSpec } = await import('../src/docs/swagger.js');

describe('Swagger / OAS Documentation', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    setupSwagger(app);
  });

  it('serves the OAS JSON spec at /api-docs/spec.json', async () => {
    const res = await request(app).get('/api-docs/spec.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const spec = res.body;
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('Soroban Playground API');
  });

  it('serves the Swagger UI HTML at /api-docs', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('swagger');
  });

  it('spec contains at least one path', () => {
    expect(swaggerSpec.paths).toBeDefined();
    expect(Object.keys(swaggerSpec.paths).length).toBeGreaterThan(0);
  });

  it('spec passes OAS 3.0 structural validation', () => {
    expect(swaggerSpec.openapi).toBeDefined();
    expect(swaggerSpec.info).toBeDefined();
    expect(swaggerSpec.info.version).toBeDefined();
    expect(swaggerSpec.components).toBeDefined();
  });

  it('spec includes security scheme definition', () => {
    expect(swaggerSpec.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(swaggerSpec.components.securitySchemes.bearerAuth.type).toBe('http');
  });
});
