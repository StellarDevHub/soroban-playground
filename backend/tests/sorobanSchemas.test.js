import express from 'express';
import request from 'supertest';
import {
  invokeBodyV1,
  invokeBodyV2,
  deployBodyV1,
  deployBatchBodyV1,
  compileBody,
  jobIdParams,
} from '../src/schemas/sorobanSchemas.js';
import {
  validateRequest,
  rejectPrototypePollution,
  findForbiddenKey,
} from '../src/middleware/validation.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Issue #1573 — Zod input validation & mass-assignment prevention.

jest.mock('../src/services/invokeService.js', () => ({
  invokeSorobanContract: jest.fn(),
}));
const { invokeSorobanContract } = require('../src/services/invokeService.js');

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('invoke schemas', () => {
  it('strips unknown keys (mass assignment)', () => {
    const parsed = invokeBodyV1.parse({
      contractId: CONTRACT_ID,
      functionName: 'hello',
      isAdmin: true,
      role: 'admin',
    });
    expect(parsed).toEqual({ contractId: CONTRACT_ID, functionName: 'hello' });
  });

  it('rejects contract ids outside the StrKey alphabet', () => {
    const result = invokeBodyV1.safeParse({
      contractId: 'C' + '0'.repeat(55),
      functionName: 'hello',
    });
    expect(result.success).toBe(false);
  });

  it('reports missing required fields with legacy messages', () => {
    const result = invokeBodyV1.safeParse({});
    const messages = result.error.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'contractId is required',
        'functionName is required',
      ])
    );
  });

  it.each([
    ['network', { network: '--help' }],
    ['sourceAccount', { sourceAccount: '--rpc-url=http://evil' }],
    ['args keys', { args: { '--flag': 1 } }],
    ['args type', { args: ['a'] }],
  ])('rejects CLI-flag injection via %s', (_label, extra) => {
    const result = invokeBodyV1.safeParse({
      contractId: CONTRACT_ID,
      functionName: 'hello',
      ...extra,
    });
    expect(result.success).toBe(false);
  });

  it('normalises null optionals to undefined', () => {
    const parsed = invokeBodyV2.parse({
      contract_id: CONTRACT_ID,
      function_name: 'hello',
      args: null,
      network: null,
    });
    expect(parsed.args).toBeUndefined();
    expect(parsed.network).toBeUndefined();
  });
});

describe('deploy & compile schemas', () => {
  it('rejects NUL bytes in wasmPath', () => {
    expect(
      deployBodyV1.safeParse({ wasmPath: 'a\0.wasm', contractName: 'x' })
        .success
    ).toBe(false);
  });

  it('strips unknown keys from batch items', () => {
    const parsed = deployBatchBodyV1.parse({
      contracts: [{ id: 'a', wasmPath: 'a.wasm', contractName: 'a', x: 1 }],
      extra: true,
    });
    expect(parsed).toEqual({
      contracts: [{ id: 'a', wasmPath: 'a.wasm', contractName: 'a' }],
    });
  });

  it('caps batch size', () => {
    const contracts = Array.from({ length: 21 }, (_, i) => ({ id: `${i}` }));
    expect(deployBatchBodyV1.safeParse({ contracts }).success).toBe(false);
  });

  it('keeps every compile field the handlers read', () => {
    const body = {
      code: 'a',
      source: 'b',
      sourceCode: 'c',
      contractName: 'd',
      dependencies: { 'soroban-sdk': '22.0.0' },
    };
    expect(compileBody.parse({ ...body, admin: true })).toEqual(body);
  });

  it('validates job id params', () => {
    expect(jobIdParams.safeParse({ jobId: '../../etc' }).success).toBe(false);
    expect(jobIdParams.safeParse({ jobId: 'deploy-job-1' }).success).toBe(true);
  });
});

describe('prototype pollution guard', () => {
  it('finds forbidden keys at any depth', () => {
    const payload = JSON.parse('{"a":{"b":[{"__proto__":{"x":1}}]}}');
    expect(findForbiddenKey(payload)).toMatch(/a\.b\.0\.__proto__/);
    expect(findForbiddenKey({ constructor: { prototype: {} } })).toMatch(
      /constructor/
    );
    expect(findForbiddenKey({ ok: { nested: [1, 2] } })).toBeNull();
  });

  it('bounds nesting depth', () => {
    let deep = {};
    const root = deep;
    for (let i = 0; i < 200; i += 1) {
      deep.n = {};
      deep = deep.n;
    }
    expect(findForbiddenKey(root)).toMatch(/nesting depth/);
  });

  it('rejects polluting requests with 400 before any handler runs', async () => {
    const handler = jest.fn((_req, res) => res.json({ ok: true }));
    const app = express();
    app.use(express.json());
    app.use(rejectPrototypePollution);
    app.post('/x', handler);
    app.use(errorHandler);

    const res = await request(app)
      .post('/x')
      .set('Content-Type', 'application/json')
      .send('{"args":{"__proto__":{"isAdmin":true}}}');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(handler).not.toHaveBeenCalled();
    expect({}.isAdmin).toBeUndefined();
  });

  it('checks the query string too', async () => {
    const app = express();
    app.use(rejectPrototypePollution);
    app.get('/x', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const res = await request(app).get('/x?constructor[prototype][a]=1');
    expect(res.status).toBe(400);
  });
});

describe('validateRequest middleware', () => {
  it('replaces req.body with the stripped value', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/invoke',
      validateRequest({ body: invokeBodyV1 }, { format: 'httpError' }),
      (req, res) => res.json(req.body)
    );
    app.use(errorHandler);

    const res = await request(app).post('/invoke').send({
      contractId: CONTRACT_ID,
      functionName: 'hello',
      sourceAccountSecret: 'SXXXX',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      contractId: CONTRACT_ID,
      functionName: 'hello',
    });
  });

  it('keeps the default 422 envelope for existing callers', async () => {
    const app = express();
    app.use(express.json());
    app.post('/x', validateRequest({ body: deployBodyV1 }), (_q, s) =>
      s.json({})
    );
    const res = await request(app).post('/x').send({});
    expect(res.status).toBe(422);
    expect(res.body.details[0]).toMatchObject({ location: 'body' });
  });
});

describe('POST /api/invoke (route integration)', () => {
  const { default: invokeRoute } = require('../src/routes/v1/invoke.js');
  const app = express();
  app.use(express.json());
  app.use('/api/invoke', invokeRoute);
  app.use(errorHandler);

  beforeEach(() => {
    invokeSorobanContract.mockReset();
    invokeSorobanContract.mockResolvedValue({
      contractId: CONTRACT_ID,
      functionName: 'hello',
      parsed: null,
      stdout: '',
      stderr: '',
      endedAt: 'now',
    });
  });

  it('does not forward unknown body fields to the service', async () => {
    const res = await request(app).post('/api/invoke').send({
      contractId: CONTRACT_ID,
      functionName: 'hello',
      injected: 'value',
    });
    expect(res.status).toBe(200);
    const [payload] = invokeSorobanContract.mock.calls[0];
    expect(payload).not.toHaveProperty('injected');
  });

  it('rejects flag injection before reaching the CLI layer', async () => {
    const res = await request(app).post('/api/invoke').send({
      contractId: CONTRACT_ID,
      functionName: 'hello',
      network: '--help',
    });
    expect(res.status).toBe(400);
    expect(invokeSorobanContract).not.toHaveBeenCalled();
  });

  it('sets rate limit headers from the invoke bucket', async () => {
    const res = await request(app).post('/api/invoke').send({
      contractId: CONTRACT_ID,
      functionName: 'hello',
    });
    expect(res.headers['x-ratelimit-limit']).toBe('30');
  });
});
