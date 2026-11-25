// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  zodToOpenApi,
  toOpenApiPath,
  collectZodOperations,
  mergeZodOperations,
} from '../src/docs/zodOpenApi.js';
import { validateRequest } from '../src/middleware/validation.js';

jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: { isConnected: false, get: jest.fn().mockResolvedValue(null) },
}));

jest.mock('../src/services/authService.js', () => ({
  __esModule: true,
  default: { authenticate: jest.fn().mockResolvedValue(null) },
}));

jest.mock('../src/services/corsWhitelistService.js', () => ({
  __esModule: true,
  listOrigins: jest.fn(),
  addOrigin: jest.fn(),
  removeOrigin: jest.fn(),
}));

const ok = (_req, res) => res.json({ ok: true });

describe('zodToOpenApi', () => {
  it('maps string checks from Zod internals', () => {
    expect(
      zodToOpenApi(
        z.string().min(3).max(10).regex(/^G/).describe('Stellar key')
      )
    ).toEqual({
      type: 'string',
      minLength: 3,
      maxLength: 10,
      pattern: '^G',
      description: 'Stellar key',
    });
    expect(zodToOpenApi(z.string().email())).toEqual({
      type: 'string',
      format: 'email',
    });
    expect(zodToOpenApi(z.string().url()).format).toBe('uri');
  });

  it('maps number checks, including coercion and OAS 3.1 numeric exclusivity', () => {
    expect(zodToOpenApi(z.coerce.number().int().positive().max(100))).toEqual({
      type: 'integer',
      exclusiveMinimum: 0,
      maximum: 100,
    });
  });

  it('marks optional and defaulted fields as not required and uses OAS 3.1 nullable type arrays', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string().optional(),
      c: z.number().default(5),
      d: z.string().nullable(),
    });
    const out = zodToOpenApi(schema);
    expect(out.required).toEqual(['a', 'd']);
    expect(out.properties.b).toEqual({ type: 'string' });
    expect(out.properties.c).toEqual({ type: 'number', default: 5 });
    expect(out.properties.d).toEqual({ type: ['string', 'null'] });
  });

  it('handles strict objects, arrays, enums, unions and effects', () => {
    expect(zodToOpenApi(z.object({}).strict()).additionalProperties).toBe(
      false
    );
    expect(zodToOpenApi(z.array(z.boolean()).min(1).max(3))).toEqual({
      type: 'array',
      items: { type: 'boolean' },
      minItems: 1,
      maxItems: 3,
    });
    expect(zodToOpenApi(z.enum(['testnet', 'mainnet']))).toEqual({
      type: 'string',
      enum: ['testnet', 'mainnet'],
    });
    expect(zodToOpenApi(z.union([z.string(), z.number()]))).toEqual({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(
      zodToOpenApi(
        z
          .string()
          .transform((s) => s.length)
          .pipe(z.number())
      )
    ).toEqual({ type: 'string' });
    expect(zodToOpenApi(z.record(z.number()))).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    });
  });
});

describe('route discovery', () => {
  function buildApp() {
    const app = express();
    const api = express.Router();
    const nested = express.Router({ mergeParams: true });

    nested.post(
      '/items/:itemId',
      validateRequest(
        {
          params: z.object({ orgId: z.string(), itemId: z.string().uuid() }),
          query: z.object({ dryRun: z.coerce.boolean().optional() }),
          body: z.object({ name: z.string().min(1) }),
        },
        { summary: 'Create item', tags: ['Items'] }
      ),
      ok
    );
    api.use('/orgs/:orgId', nested);
    api.get('/plain', ok); // no schema -> not generated
    app.use('/api', api);
    return app;
  }

  it('converts Express paths to OpenAPI paths', () => {
    expect(toOpenApiPath('/api/orgs/:orgId/items/:itemId')).toBe(
      '/api/orgs/{orgId}/items/{itemId}'
    );
  });

  it('recovers full nested paths, parameters and bodies', () => {
    const paths = collectZodOperations(buildApp());
    expect(Object.keys(paths)).toEqual(['/api/orgs/{orgId}/items/{itemId}']);

    const op = paths['/api/orgs/{orgId}/items/{itemId}'].post;
    expect(op.summary).toBe('Create item');
    expect(op.tags).toEqual(['Items']);
    expect(op.parameters).toEqual([
      { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'itemId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      {
        name: 'dryRun',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
      },
    ]);
    expect(op.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 } },
      required: ['name'],
    });
    expect(op.responses['422'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ValidationError'
    );
  });

  it('lets Zod schemas override stale JSDoc request docs but keeps prose', () => {
    const base = {
      openapi: '3.0.0',
      paths: {
        '/api/orgs/{orgId}/items/{itemId}': {
          post: {
            summary: 'Hand-written summary',
            requestBody: { content: { 'application/json': { schema: {} } } },
            responses: { 201: { description: 'Created' } },
          },
        },
      },
    };
    const merged = mergeZodOperations(base, collectZodOperations(buildApp()));
    const op = merged.paths['/api/orgs/{orgId}/items/{itemId}'].post;

    expect(op.summary).toBe('Hand-written summary');
    expect(op.requestBody.content['application/json'].schema.required).toEqual([
      'name',
    ]);
    expect(Object.keys(op.responses).sort()).toEqual(['201', '422']);
    expect(merged.components.schemas.ValidationError).toBeDefined();
  });
});

describe('live /docs endpoints', () => {
  let app;
  let setupSwagger;

  beforeAll(async () => {
    ({ setupSwagger } = await import('../src/docs/swagger.js'));
    const { default: corsAdminRoute } =
      await import('../src/routes/corsAdmin.js');
    app = express();
    app.use('/api/cors-whitelist', corsAdminRoute);
    setupSwagger(app);
  });

  it('serves the Swagger UI at /docs', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });

  it('points the UI at the live spec', async () => {
    const res = await request(app).get('/docs/swagger-ui-init.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/docs/openapi.json');
  });

  it('documents routes from their Zod schemas', async () => {
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    const post = res.body.paths['/api/cors-whitelist'].post;
    expect(post.tags).toEqual(['CORS Whitelist']);
    expect(post.security).toEqual([{ bearerAuth: [] }]);
    expect(
      post.requestBody.content['application/json'].schema.properties.origin
        .pattern
    ).toBeDefined();
    expect(
      res.body.paths['/api/cors-whitelist/{origin}'].delete.parameters[0]
    ).toMatchObject({ name: 'origin', in: 'path', required: true });
  });

  it('keeps /api-docs/spec.json in sync with /docs/openapi.json', async () => {
    const [a, b] = await Promise.all([
      request(app).get('/docs/openapi.json'),
      request(app).get('/api-docs/spec.json'),
    ]);
    expect(b.body).toEqual(a.body);
  });

  it('reflects routes registered after startup without a restart', async () => {
    const lateApp = express();
    setupSwagger(lateApp);
    const before = await request(lateApp).get('/docs/openapi.json');
    expect(before.body.paths['/api/late']).toBeUndefined();

    lateApp.put(
      '/api/late',
      validateRequest({ body: z.object({ flag: z.boolean() }) }),
      ok
    );
    const after = await request(lateApp).get('/docs/openapi.json');
    expect(after.body.paths['/api/late'].put.requestBody).toBeDefined();
  });
});
