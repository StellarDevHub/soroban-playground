import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const revokedStore = new Map();

jest.unstable_mockModule('../src/services/redisService.js', () => ({
  __esModule: true,
  default: {
    client: null,
    isFallbackMode: true,
    async get(key) {
      return revokedStore.get(key) || null;
    },
    async set(key, value) {
      revokedStore.set(key, value);
      return 'OK';
    },
    async del(key) {
      revokedStore.delete(key);
      return 1;
    },
  },
}));

jest.unstable_mockModule('../src/database/connection.js', () => ({
  __esModule: true,
  getDatabase: () => null,
}));

const { authenticate } = await import('../src/middleware/auth.js');

function mockRes() {
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe('JWT revocation engine', () => {
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRETS || 'dev-secret-change-me';

  beforeEach(() => {
    revokedStore.clear();
  });

  it('rejects revoked tokens immediately with HTTP 401', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = jwt.sign(
      {
        sub: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        jti: 'revoked-jti-1',
        type: 'access',
      },
      secret,
      { algorithm: 'HS256', expiresIn: 900 }
    );

    revokedStore.set('revoked:jti:revoked-jti-1', '1');

    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
    };
    const next = jest.fn();

    await authenticate(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeTruthy();
    expect(err.status || err.statusCode).toBe(401);
  });

  it('rejects legacy blacklisted tokens immediately with HTTP 401', async () => {
    const token = jwt.sign(
      {
        sub: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        jti: 'legacy-jti-1',
        type: 'access',
      },
      secret,
      { algorithm: 'HS256', expiresIn: 900 }
    );

    revokedStore.set('bl_access:legacy-jti-1', '1');

    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
    };
    const next = jest.fn();

    await authenticate(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeTruthy();
    expect(err.status || err.statusCode).toBe(401);
  });
});
