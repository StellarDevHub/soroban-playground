// Tests for GraphQL query complexity guardrails (issue #742).
// Covers: directive-weighted static scoring, per-role limits, rejection BEFORE
// resolvers/DB run, the complexity breakdown on errors, the success-path
// extensions echo, and survival of the breakdown under production maskedErrors.

import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const nodeRequire = createRequire(import.meta.url);
const { createSchema } = nodeRequire('graphql-yoga');
const { parse } = nodeRequire('graphql');

// Mock the services the resolvers/loaders pull in so importing the GraphQL
// server has no side effects and so we can assert resolvers are (not) reached.
jest.mock('../src/services/compileService.js', () => ({
  __esModule: true,
  getCompileSnapshot: jest.fn().mockResolvedValue({ stats: {}, history: [] }),
  getCompileStats: jest.fn(),
  compileQueued: jest.fn(),
  compileBatch: jest.fn(),
  compileProgressBus: { on: jest.fn(), off: jest.fn() },
}));

jest.mock('../src/services/deployService.js', () => ({
  __esModule: true,
  deployBatchContracts: jest.fn(),
  deployProgressBus: { on: jest.fn(), off: jest.fn() },
  readDeployHistory: jest.fn().mockResolvedValue([]),
  getDeploymentState: jest.fn(),
}));

jest.mock('../src/services/invokeService.js', () => ({
  __esModule: true,
  invokeSorobanContract: jest.fn(),
  invokeProgressBus: { on: jest.fn(), off: jest.fn() },
}));

jest.mock('../src/graphql/cache.js', () => ({
  __esModule: true,
  getCached: jest.fn().mockResolvedValue(null),
  setCached: jest.fn().mockResolvedValue(undefined),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/authService.js', () => ({
  __esModule: true,
  default: {
    authenticate: jest.fn().mockImplementation(({ headers }) => {
      // Keys might be lowercase in raw headers object
      const headerRole = headers['x-role'] || headers['X-Role'];
      if (headerRole) {
        return {
          id: headerRole === 'admin' ? 1 : 2,
          username: `${headerRole}_user`,
          email: `${headerRole}@example.com`,
          role: headerRole,
          permissions: ['project:read'],
        };
      }
      return {
        id: null,
        username: 'anonymous',
        email: '',
        role: 'guest',
        permissions: ['project:read'],
      };
    }),
    hasPermission: () => true,
  },
}));

import { createGraphQLServer } from '../src/graphql/index.js';
import {
  computeComplexity,
  getMaxComplexityForRole,
  ROLE_LIMITS,
  MAX_COMPLEXITY,
  DEFAULT_ROLE,
} from '../src/graphql/complexity.js';
import { typeDefs } from '../src/graphql/schema.js';
import { resolvers } from '../src/graphql/resolvers.js';
import { getCompileSnapshot } from '../src/services/compileService.js';

function mountYoga(app) {
  const yoga = createGraphQLServer();
  app.use(yoga.graphqlEndpoint, yoga);
}

function gqlRequest(app, query, role) {
  const req = request(app).post('/graphql').send({ query });
  if (role) req.set('x-role', role);
  return req;
}

describe('complexity.js — static scoring & per-role limits', () => {
  const schema = createSchema({ typeDefs, resolvers });
  const score = (q) => computeComplexity(schema, parse(q));

  it('exposes role limits, default role, and the backwards-compatible alias', () => {
    expect(ROLE_LIMITS).toEqual({ guest: 100, user: 500, admin: 500 });
    expect(DEFAULT_ROLE).toBe('guest');
    expect(MAX_COMPLEXITY).toBe(ROLE_LIMITS.guest);
  });

  it('maps each role to its ceiling and defaults unknown roles to guest', () => {
    expect(getMaxComplexityForRole(['guest'])).toBe(100);
    expect(getMaxComplexityForRole(['user'])).toBe(500);
    expect(getMaxComplexityForRole(['admin'])).toBe(500);
    expect(getMaxComplexityForRole(['mystery'])).toBe(100);
  });

  it('picks the most permissive limit when several roles are present', () => {
    expect(getMaxComplexityForRole(['guest', 'admin'])).toBe(500);
    expect(getMaxComplexityForRole(['user', 'guest'])).toBe(500);
  });

  it('tolerates non-array / empty role input', () => {
    expect(getMaxComplexityForRole('admin')).toBe(1000);
    expect(getMaxComplexityForRole([])).toBe(100);
    expect(getMaxComplexityForRole()).toBe(100);
  });

  it('scores undirected and directed fields from the schema', () => {
    expect(score('{ health }')).toBe(1);
    expect(score('{ compileStats compileHistory health }')).toBe(5); // 1 + 3 + 1
  });

  it('applies directive multipliers to list fields', () => {
    // deployHistory: @complexity(value: 3, multipliers: ["first"]) -> (3 + 1 child) * first
    expect(score('{ deployHistory(first: 10) { totalCount } }')).toBe(40);
    expect(score('{ deployHistory(first: 30) { totalCount } }')).toBe(120);
  });

  it('resolves multiplier arguments supplied via query variables', () => {
    const doc = parse(
      'query($n: Int) { deployHistory(first: $n) { totalCount } }'
    );
    expect(computeComplexity(schema, doc, { n: 10 })).toBe(40);
  });

  it('treats null variables (as yoga may pass) as no variables', () => {
    expect(computeComplexity(schema, parse('{ health }'), null)).toBe(1);
  });

  it('weights mutations heavier than reads', () => {
    expect(
      score(
        'mutation { deploy(input:{contractName:"x", wasmPath:"y"}) { success } }'
      )
    ).toBe(11); // 10 directive + 1 child
  });
});

describe('GraphQL server — complexity enforcement', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    mountYoga(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getCompileSnapshot.mockResolvedValue({ stats: {}, history: [] });
  });

  it('allows an in-budget query and echoes the complexity score in extensions', async () => {
    const res = await gqlRequest(app, '{ health }', 'guest');
    expect(res.status).toBe(200);
    expect(res.body.data.health).toBe('ok');
    expect(res.body.extensions.complexity).toEqual({ score: 1, max: 100 });
  });

  it('runs the resolver (and its service call) for an in-budget query', async () => {
    const res = await gqlRequest(
      app,
      '{ compileStats { totalCompiles } }',
      'guest'
    );
    expect(res.status).toBe(200);
    expect(getCompileSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rejects an over-budget query with a precise breakdown and skips resolvers/DB', async () => {
    // compileStats{totalCompiles}=2 + deployHistory(first:30){totalCount}=(3+1)*30=120 => 122
    const query =
      '{ compileStats { totalCompiles } deployHistory(first: 30) { totalCount } }';
    const res = await gqlRequest(app, query, 'guest');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    const err = res.body.errors[0];
    expect(err.extensions.code).toBe('QUERY_COMPLEXITY_EXCEEDED');
    expect(err.extensions.complexity).toEqual({
      score: 122,
      max: 100,
      role: 'guest',
    });
    expect(err.message).toContain(
      'exceeds the maximum allowed complexity of 100'
    );
    // Rejected before execution -> no resolver, no DB/service access.
    expect(getCompileSnapshot).not.toHaveBeenCalled();
  });

  it('applies a higher ceiling for privileged roles', async () => {
    const query =
      '{ compileStats { totalCompiles } deployHistory(first: 30) { totalCount } }';
    const res = await gqlRequest(app, query, 'user');

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.extensions.complexity).toEqual({ score: 122, max: 500 });
    expect(getCompileSnapshot).toHaveBeenCalled();
  });
});

describe('GraphQL server — complexity breakdown survives production maskedErrors', () => {
  let app;
  const prevEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'production';
    app = express();
    app.use(express.json());
    mountYoga(app);
  });

  afterAll(() => {
    process.env.NODE_ENV = prevEnv;
  });

  it('keeps the QUERY_COMPLEXITY_EXCEEDED breakdown unmasked in production', async () => {
    const query = '{ deployHistory(first: 30) { totalCount } }'; // 120 > guest 100
    const res = await gqlRequest(app, query, 'guest');

    expect(res.status).toBe(200);
    const err = res.body.errors[0];
    expect(err.extensions.code).toBe('QUERY_COMPLEXITY_EXCEEDED');
    expect(err.extensions.complexity).toMatchObject({
      max: 100,
      role: 'guest',
    });
  });
});
