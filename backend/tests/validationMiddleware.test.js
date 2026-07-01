import {
  validateBody,
  validateQuery,
} from '../src/middleware/validationMiddleware.js';
import { v } from '../src/utils/schemaValidator.js';
import {
  authLoginSchema,
  authRegisterSchema,
  templateCreateSchema,
  projectCreateSchema,
  querySchema,
} from '../src/schemas/validationSchemas.js';

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

function makeReq(body = {}, query = {}) {
  return { body, query };
}

describe('validateBody middleware', () => {
  const schema = authLoginSchema;

  it('calls next() for a valid body', () => {
    const mw = validateBody(schema);
    const next = jest.fn();
    const req = makeReq({ email: 'user@example.com', password: 'securepass' });
    mw(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 422 for missing required fields', () => {
    const mw = validateBody(schema);
    const res = makeRes();
    mw(makeReq({}), res, jest.fn());
    expect(res._status).toBe(422);
    expect(res._body.error).toBe('Validation Error');
    expect(res._body.details.length).toBeGreaterThan(0);
  });

  it('returns 422 for invalid email', () => {
    const mw = validateBody(schema);
    const res = makeRes();
    mw(
      makeReq({ email: 'not-an-email', password: 'securepass' }),
      res,
      jest.fn()
    );
    expect(res._status).toBe(422);
    expect(res._body.details[0].field).toBe('email');
  });

  it('rejects undeclared fields in strict mode', () => {
    const mw = validateBody(schema);
    const res = makeRes();
    mw(
      makeReq({
        email: 'user@example.com',
        password: 'securepass',
        extra: 'field',
      }),
      res,
      jest.fn()
    );
    expect(res._status).toBe(422);
    expect(res._body.details.some((d) => d.field === 'extra')).toBe(true);
  });

  it('replaces req.body with coerced/stripped value on success', () => {
    const mw = validateBody(schema);
    const next = jest.fn();
    const req = makeReq({ email: 'user@example.com', password: 'securepass' });
    mw(req, makeRes(), next);
    expect(req.body).toEqual({
      email: 'user@example.com',
      password: 'securepass',
    });
  });
});

describe('validateQuery middleware', () => {
  it('coerces string limit to number', () => {
    const mw = validateQuery(querySchema);
    const next = jest.fn();
    const req = makeReq({}, { limit: '50', offset: '10', sort: 'asc' });
    mw(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.limit).toBe(50);
    expect(req.query.offset).toBe(10);
  });

  it('uses defaults for missing optional fields', () => {
    const mw = validateQuery(querySchema);
    const next = jest.fn();
    const req = makeReq({}, {});
    mw(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.limit).toBe(20);
    expect(req.query.sort).toBe('desc');
  });

  it('returns 422 for out-of-range limit', () => {
    const mw = validateQuery(querySchema);
    const res = makeRes();
    mw(makeReq({}, { limit: '999' }), res, jest.fn());
    expect(res._status).toBe(422);
  });
});

describe('authRegisterSchema', () => {
  it('validates a correct registration payload', () => {
    const { errors } = authRegisterSchema.validate({
      username: 'dev_user',
      email: 'dev@example.com',
      password: 'strongpass',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid username characters', () => {
    const { errors } = authRegisterSchema.validate({
      username: 'bad user!',
      email: 'dev@example.com',
      password: 'strongpass',
    });
    expect(errors.some((e) => e.path === 'username')).toBe(true);
  });

  it('defaults role to user', () => {
    const { value } = authRegisterSchema.validate({
      username: 'alice',
      email: 'alice@example.com',
      password: 'strongpass123',
    });
    expect(value.role).toBe('user');
  });
});

describe('templateCreateSchema', () => {
  it('validates a complete template', () => {
    const { errors } = templateCreateSchema.validate({
      name: 'My Template',
      content: 'fn main() {}',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty name', () => {
    const { errors } = templateCreateSchema.validate({
      name: '',
      content: 'code',
    });
    expect(errors.some((e) => e.path === 'name')).toBe(true);
  });
});

describe('projectCreateSchema', () => {
  it('defaults network to testnet', () => {
    const { value } = projectCreateSchema.validate({ name: 'MyProject' });
    expect(value.network).toBe('testnet');
  });

  it('rejects unknown network', () => {
    const { errors } = projectCreateSchema.validate({
      name: 'P',
      network: 'devnet',
    });
    expect(errors.some((e) => e.path === 'network')).toBe(true);
  });
});

describe('schemaValidator v.object strict mode', () => {
  it('strips unknown fields from output', () => {
    const schema = v.object({ a: v.string().required() });
    const { value, errors } = schema.validate({ a: 'hello', b: 'extra' });
    expect(errors.some((e) => e.path === 'b')).toBe(true);
    expect(value.b).toBeUndefined();
  });
});
