import { jest } from '@jest/globals';
import { z } from 'zod';
import {
  validateBody,
  validateQuery,
  validateParams,
  validateZod,
} from '../src/middleware/validationMiddleware.js';

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = jest.fn((s) => {
    res._status = s;
    return res;
  });
  res.json = jest.fn((b) => {
    res._body = b;
    return res;
  });
  return res;
}

describe('Zod validationMiddleware (validateZod / validateBody / validateQuery / validateParams)', () => {
  const hashSchema = z
    .object({
      fileHash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Invalid 64-char hex'),
      metadata: z.string().min(1).max(500),
    })
    .strict();

  it('passes valid body and replaces req.body with parsed data', () => {
    const mw = validateBody(hashSchema);
    const next = jest.fn();
    const req = { body: { fileHash: 'a'.repeat(64), metadata: 'ok' } };
    mw(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ fileHash: 'a'.repeat(64), metadata: 'ok' });
  });

  it('returns standardized 400 Bad Request with structured field path and details', () => {
    const mw = validateBody(hashSchema);
    const res = makeRes();
    const next = jest.fn();
    mw({ body: { fileHash: 'short', metadata: '' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('Bad Request');
    expect(res._body.message).toBe('Validation failed');
    expect(res._body.statusCode).toBe(400);
    expect(res._body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'fileHash',
          field: 'fileHash',
          message: 'Invalid 64-char hex',
          location: 'body',
        }),
      ])
    );
  });

  it('enforces strict mode and rejects unexpected keys with 400', () => {
    const looseSchema = z.object({ name: z.string().min(1) });
    const mw = validateZod({ body: looseSchema });
    const res = makeRes();
    const next = jest.fn();
    mw({ body: { name: 'test', smuggled: true } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.details[0].code).toBe('unrecognized_keys');
  });

  it('validates req.query with validateQuery(zodSchema)', () => {
    const mw = validateQuery(
      z.object({ page: z.coerce.number().int().min(1) }).strict()
    );
    const res = makeRes();
    const next = jest.fn();
    mw({ query: { page: '0' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.details[0].location).toBe('query');
    expect(res._body.details[0].path).toBe('page');
  });

  it('validates req.params with validateParams', () => {
    const mw = validateParams(
      z.object({ id: z.string().regex(/^[0-9]+$/) }).strict()
    );
    const res = makeRes();
    const next = jest.fn();
    mw({ params: { id: 'abc' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.details[0].location).toBe('params');
    expect(res._body.details[0].path).toBe('id');
  });
});
