// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  setupSwagger,
  swaggerSpec,
  buildLiveSpec,
  cloneOperation,
  clonePathItem,
  isVersionablePath,
  withVersionedDocumentation,
} from '../src/docs/swagger.js';
import {
  validateOpenApi31Spec,
  validateRouteCoverage,
} from '../src/docs/openapiValidator.js';
import { validateRequest } from '../src/middleware/validation.js';

jest.mock('../src/services/compileService.js', () => ({
  getCompileStats: jest.fn(),
  getCompileSnapshot: jest.fn(),
  initializeCompileService: jest.fn(),
}));

jest.mock('../src/services/redisService.js', () => ({
  default: { isConnected: false, get: jest.fn(), set: jest.fn() },
}));

describe('Swagger / OAS Documentation', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    setupSwagger(app);
  });

  it('serves the OAS 3.1.0 JSON spec at /docs/openapi.json and /api-docs/spec.json', async () => {
    const [canonical, legacy] = await Promise.all([
      request(app).get('/docs/openapi.json'),
      request(app).get('/api-docs/spec.json'),
    ]);
    for (const res of [canonical, legacy]) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.info.title).toBe('Soroban Playground API');
    }
    expect(legacy.body).toEqual(canonical.body);
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

  it('spec passes OpenAPI 3.1.0 structural validation without warnings', () => {
    const result = validateOpenApi31Spec(swaggerSpec);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
    expect(swaggerSpec.openapi).toBe('3.1.0');
    expect(swaggerSpec.info).toBeDefined();
    expect(swaggerSpec.info.version).toBeDefined();
    expect(swaggerSpec.components).toBeDefined();
  });

  it('validates that registered Zod routes have accurate OpenAPI 3.1.0 coverage', () => {
    const routeApp = express();
    routeApp.use(express.json());
    routeApp.post(
      '/api/widgets/:id',
      validateRequest(
        {
          params: z.object({ id: z.string().uuid() }),
          query: z.object({ verbose: z.coerce.boolean().optional() }),
          body: z.object({ label: z.string().min(1) }),
        },
        { summary: 'Create widget', tags: ['Widgets'] }
      ),
      (_req, res) => res.json({ ok: true })
    );
    setupSwagger(routeApp);

    const liveSpec = buildLiveSpec(routeApp);
    const specResult = validateOpenApi31Spec(liveSpec);
    expect(specResult.valid).toBe(true);
    expect(specResult.errors).toEqual([]);
    expect(specResult.warnings).toEqual([]);

    const coverage = validateRouteCoverage(routeApp, liveSpec);
    expect(coverage.valid).toBe(true);
    expect(coverage.missing).toEqual([]);
    expect(coverage.mismatches).toEqual([]);
    expect(coverage.documentedRoutes).toBe(coverage.totalRoutes);
  });

  it('detects undocumented routes in coverage validation', () => {
    const routeApp = express();
    routeApp.get('/api/undocumented-endpoint', (_req, res) =>
      res.json({ ok: true })
    );
    setupSwagger(routeApp);

    const liveSpec = buildLiveSpec(routeApp);
    const coverage = validateRouteCoverage(routeApp, liveSpec);
    expect(coverage.valid).toBe(false);
    expect(coverage.missing).toContain('GET /api/undocumented-endpoint');
  });

  it('spec includes security scheme definition', () => {
    expect(swaggerSpec.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(swaggerSpec.components.securitySchemes.bearerAuth.type).toBe('http');
  });

  it('categorizes versioned API documentation', () => {
    expect(swaggerSpec.tags.map((tag) => tag.name)).toEqual(
      expect.arrayContaining(['Versioning', 'API v1', 'API v2'])
    );
    expect(swaggerSpec.paths['/api/v1/compile']?.post?.tags).toContain(
      'API v1'
    );
    expect(swaggerSpec.paths['/api/v2/compile']?.post?.tags).toContain(
      'API v2'
    );
  });
});

describe('isVersionablePath', () => {
  it('returns false for paths not starting with /api/', () => {
    expect(isVersionablePath('/health')).toBe(false);
    expect(isVersionablePath('/compile')).toBe(false);
  });

  it('returns false for /api/ paths not in the versioned prefix list', () => {
    expect(isVersionablePath('/api/health')).toBe(false);
    expect(isVersionablePath('/api/admin')).toBe(false);
  });

  it('returns true for exact versioned route prefix matches', () => {
    expect(isVersionablePath('/api/compile')).toBe(true);
    expect(isVersionablePath('/api/deploy')).toBe(true);
    expect(isVersionablePath('/api/invoke')).toBe(true);
  });

  it('returns true for paths that start with a versioned route prefix', () => {
    expect(isVersionablePath('/api/compile/batch')).toBe(true);
    expect(isVersionablePath('/api/deploy/queue')).toBe(true);
    expect(isVersionablePath('/api/invoke/status')).toBe(true);
  });
});

describe('cloneOperation', () => {
  it('prepends the version tag and preserves existing tags', () => {
    const op = { summary: 'test', tags: ['Contract Compiler'] };
    const cloned = cloneOperation(op, 'v2');
    expect(cloned.tags).toContain('API v2');
    expect(cloned.tags).toContain('Contract Compiler');
  });

  it('does not duplicate the version tag when already present', () => {
    const op = { tags: ['API v1'] };
    const cloned = cloneOperation(op, 'v1');
    expect(cloned.tags.filter((t) => t === 'API v1').length).toBe(1);
  });

  it('handles operations with no tags array', () => {
    const op = { summary: 'no tags' };
    const cloned = cloneOperation(op, 'v1');
    expect(cloned.tags).toEqual(['API v1']);
  });

  it('deep-clones so mutations do not affect the original', () => {
    const op = { tags: ['Original'], requestBody: { content: {} } };
    const cloned = cloneOperation(op, 'v1');
    cloned.tags.push('Mutated');
    expect(op.tags).toEqual(['Original']);
  });
});

describe('clonePathItem', () => {
  it('applies the version tag to every HTTP method in the path item', () => {
    const pathItem = {
      get: { summary: 'get op', tags: ['System'] },
      post: { summary: 'post op', tags: ['System'] },
    };
    const cloned = clonePathItem(pathItem, 'v2');
    expect(cloned.get.tags).toContain('API v2');
    expect(cloned.post.tags).toContain('API v2');
  });

  it('ignores non-operation keys (e.g. summary at path level)', () => {
    const pathItem = {
      summary: 'path-level summary',
      get: { tags: [] },
    };
    const cloned = clonePathItem(pathItem, 'v1');
    expect(cloned.get.tags).toContain('API v1');
    expect(cloned.summary).toBe('path-level summary');
  });

  it('deep-clones so mutations do not affect the original', () => {
    const pathItem = { get: { tags: ['Original'] } };
    const cloned = clonePathItem(pathItem, 'v1');
    cloned.get.tags.push('Mutated');
    expect(pathItem.get.tags).toEqual(['Original']);
  });
});

describe('withVersionedDocumentation', () => {
  it('returns a spec with paths when given an empty paths object', () => {
    const result = withVersionedDocumentation({ paths: {} });
    expect(result.paths).toBeDefined();
    expect(Object.keys(result.paths).length).toBe(0);
  });

  it('handles a spec with no paths key without throwing', () => {
    const result = withVersionedDocumentation({});
    expect(result.paths).toBeDefined();
  });

  it('tags already-versioned paths (/api/vN/...) with the correct version', () => {
    const spec = {
      paths: {
        '/api/v2/compile': { post: { tags: ['Contract Compiler'] } },
      },
    };
    const result = withVersionedDocumentation(spec);
    expect(result.paths['/api/v2/compile'].post.tags).toContain('API v2');
  });

  it('does not overwrite an already-versioned path that exists in the spec', () => {
    const spec = {
      paths: {
        '/api/compile': { post: { tags: [] } },
        '/api/v2/compile': { post: { tags: ['Existing'] } },
      },
    };
    const result = withVersionedDocumentation(spec);
    expect(result.paths['/api/v2/compile'].post.tags).toContain('Existing');
  });

  it('does not mutate the original spec object', () => {
    const spec = {
      paths: {
        '/api/compile': { post: { tags: [] } },
      },
    };
    const originalPathKeys = Object.keys(spec.paths);
    withVersionedDocumentation(spec);
    expect(Object.keys(spec.paths)).toEqual(originalPathKeys);
  });
});
