/**
 * Tests for custom error classes and error handler middleware (#736)
 */
import express from 'express';
import request from 'supertest';
import {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  errorHandler,
  asyncHandler,
  notFoundHandler,
} from '../src/middleware/errorHandler.js';

jest.mock('../src/utils/alerting.js', () => ({
  alertManager: { alert: jest.fn() },
}));

function buildApp(routeFn) {
  const app = express();
  app.use(express.json());
  app.get('/test', routeFn);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('Custom error classes (#736)', () => {
  describe('HttpError', () => {
    it('sets statusCode, message, and name', () => {
      const err = new HttpError(418, "I'm a teapot", { hint: 'x' });
      expect(err.statusCode).toBe(418);
      expect(err.message).toBe("I'm a teapot");
      expect(err.name).toBe('HttpError');
      expect(err.details).toEqual({ hint: 'x' });
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('BadRequestError', () => {
    it('has statusCode 400 and correct name', () => {
      const err = new BadRequestError('missing field');
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe('BadRequestError');
      expect(err.message).toBe('missing field');
      expect(err instanceof HttpError).toBe(true);
    });

    it('uses default message when none supplied', () => {
      expect(new BadRequestError().message).toBe('Bad Request');
    });
  });

  describe('UnauthorizedError', () => {
    it('has statusCode 401 and correct name', () => {
      const err = new UnauthorizedError('token expired');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('UnauthorizedError');
      expect(err instanceof HttpError).toBe(true);
    });

    it('uses default message when none supplied', () => {
      expect(new UnauthorizedError().message).toBe('Unauthorized');
    });
  });

  describe('NotFoundError', () => {
    it('has statusCode 404 and correct name', () => {
      const err = new NotFoundError('resource gone');
      expect(err.statusCode).toBe(404);
      expect(err.name).toBe('NotFoundError');
      expect(err instanceof HttpError).toBe(true);
    });

    it('uses default message when none supplied', () => {
      expect(new NotFoundError().message).toBe('Not Found');
    });
  });

  describe('errorHandler middleware', () => {
    it('returns 400 JSON for BadRequestError', async () => {
      const app = buildApp(
        asyncHandler(() => {
          throw new BadRequestError('bad input');
        })
      );
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('bad input');
      expect(res.body.statusCode).toBe(400);
    });

    it('returns 401 JSON for UnauthorizedError', async () => {
      const app = buildApp(
        asyncHandler(() => {
          throw new UnauthorizedError();
        })
      );
      const res = await request(app).get('/test');
      expect(res.status).toBe(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('returns 404 JSON for NotFoundError', async () => {
      const app = buildApp(
        asyncHandler(() => {
          throw new NotFoundError('not here');
        })
      );
      const res = await request(app).get('/test');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('not here');
    });

    it('returns 404 for unmatched routes via notFoundHandler', async () => {
      const app = express();
      app.use(notFoundHandler);
      app.use(errorHandler);
      const res = await request(app).get('/nowhere');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Route not found');
    });

    it('returns 500 for unknown errors', async () => {
      const app = buildApp(
        asyncHandler(() => {
          throw new Error('boom');
        })
      );
      const res = await request(app).get('/test');
      expect(res.status).toBe(500);
    });
  });
});
