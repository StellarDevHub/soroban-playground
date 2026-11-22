import express from 'express';
import request from 'supertest';
import {
  errorHandler,
  asyncHandler,
  createHttpError,
  BadRequestError,
} from '../src/middleware/errorHandler.js';
import {
  redactSensitiveData,
  redactString,
  isSensitiveKey,
} from '../src/utils/redaction.js';
import { alertManager } from '../src/utils/alerting.js';

jest.mock('../src/utils/alerting.js', () => ({
  alertManager: { alert: jest.fn() },
}));

describe('Sensitive Data Redaction & Unified Error Handling (OWASP CWE-209)', () => {
  describe('redactString', () => {
    it('masks database URI passwords', () => {
      const uri =
        'postgres://admin:super_secret_password_123@db.prod.internal:5432/main';
      const redacted = redactString(uri);
      expect(redacted).not.toContain('super_secret_password_123');
      expect(redacted).toContain(
        'postgres://admin:[REDACTED]@db.prod.internal:5432/main'
      );
    });

    it('masks Stellar secret seeds', () => {
      const seed = 'SCZANGBA5YHTNYVVV4C3U252E2B6P6IRKDMPWAIBD4NTG2FKAAAACVVV';
      const msg = `Failed to sign using key ${seed}`;
      const redacted = redactString(msg);
      expect(redacted).not.toContain(seed);
      expect(redacted).toContain('S[REDACTED]');
    });

    it('masks 64-char hex private keys', () => {
      const hexKey =
        '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
      const msg = `Transaction rejected for key ${hexKey}`;
      const redacted = redactString(msg);
      expect(redacted).not.toContain(hexKey);
      expect(redacted).toContain('[REDACTED_KEY]');
    });

    it('masks Bearer authorization tokens', () => {
      const authHeader =
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_payload.dummy_signature';
      const redacted = redactString(authHeader);
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(redacted).toContain('Bearer [REDACTED]');
    });
  });

  describe('isSensitiveKey', () => {
    it('detects sensitive field names case-insensitively', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('userPassword')).toBe(true);
      expect(isSensitiveKey('SECRET_KEY')).toBe(true);
      expect(isSensitiveKey('authToken')).toBe(true);
      expect(isSensitiveKey('connectionString')).toBe(true);
      expect(isSensitiveKey('DATABASE_URL')).toBe(true);
      expect(isSensitiveKey('username')).toBe(false);
      expect(isSensitiveKey('status')).toBe(false);
    });
  });

  describe('redactSensitiveData', () => {
    it('redacts nested sensitive keys and preserves non-sensitive keys', () => {
      const raw = {
        user: 'alice',
        credentials: {
          password: 'plain_password',
          api_key: 'sk_live_12345678',
        },
        metadata: {
          connectionString: 'mysql://root:secretPass@localhost:3306/app',
          attempts: 3,
        },
      };

      const sanitized = redactSensitiveData(raw);
      expect(sanitized.user).toBe('alice');
      expect(sanitized.credentials.password).toBe('[REDACTED]');
      expect(sanitized.credentials.api_key).toBe('[REDACTED]');
      expect(sanitized.metadata.connectionString).toBe('[REDACTED]');
      expect(sanitized.metadata.attempts).toBe(3);
    });

    it('handles circular references without infinite recursion', () => {
      const cyclic = { name: 'root' };
      cyclic.self = cyclic;

      const sanitized = redactSensitiveData(cyclic);
      expect(sanitized.name).toBe('root');
      expect(sanitized.self).toBe('[CIRCULAR]');
    });

    it('redacts error messages inside Error objects', () => {
      const err = new Error(
        'Connection failed to postgres://user:mypassword@cluster:5432/db'
      );
      const sanitized = redactSensitiveData(err);
      expect(sanitized.message).not.toContain('mypassword');
      expect(sanitized.message).toContain('[REDACTED]');
    });
  });

  describe('errorHandler middleware integration', () => {
    function buildApp(routeFn) {
      const app = express();
      app.use(express.json());
      app.get('/test', routeFn);
      app.use(errorHandler);
      return app;
    }

    it('injects unique traceId in error response', async () => {
      const app = buildApp(
        asyncHandler(() => {
          throw new BadRequestError('Invalid input payload');
        })
      );
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid input payload');
      expect(res.body.statusCode).toBe(400);
      expect(res.body.traceId).toBeDefined();
      expect(typeof res.body.traceId).toBe('string');
      expect(res.body.traceId.length).toBeGreaterThan(0);
    });

    it('redacts connection strings from error messages', async () => {
      const app = buildApp(
        asyncHandler(() => {
          throw createHttpError(
            400,
            'Failed connecting to postgres://usr:secret_pass_123@prod-db:5432/app'
          );
        })
      );
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.message).not.toContain('secret_pass_123');
      expect(res.body.message).toContain(
        'postgres://usr:[REDACTED]@prod-db:5432/app'
      );
    });

    it('hides internal error details and returns standard message in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const app = buildApp(
          asyncHandler(() => {
            const err = new Error(
              'Database syntax error in table users at /var/www/internal.js:42'
            );
            err.statusCode = 500;
            err.details = {
              secretQuery: 'SELECT * FROM secrets WHERE key="abc"',
            };
            throw err;
          })
        );
        const res = await request(app).get('/test');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Internal server error');
        expect(res.body.details).toBeUndefined();
        expect(res.body.traceId).toBeDefined();
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('sanitizes alert details forwarded to alertManager on 500 errors', async () => {
      const app = buildApp(
        asyncHandler(() => {
          const err = new Error('Internal failure');
          err.statusCode = 503;
          err.details = {
            authToken: 'Bearer secret_auth_token_999',
            database_url: 'postgres://admin:pass@host:5432/db',
          };
          throw err;
        })
      );
      await request(app).get('/test');
      expect(alertManager.alert).toHaveBeenCalledWith(
        'server_error',
        expect.objectContaining({
          statusCode: 503,
          traceId: expect.any(String),
          details: expect.objectContaining({
            authToken: '[REDACTED]',
            database_url: '[REDACTED]',
          }),
        })
      );
    });
  });
});
