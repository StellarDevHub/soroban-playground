import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  createHttpError,
  asyncHandler,
  notFoundHandler,
  errorHandler,
} from '../src/middleware/errorHandler.js';

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

describe('error middleware', () => {
  test('createHttpError returns HttpError shape', () => {
    const err = createHttpError(400, 'Validation failed', ['field required']);
    assert.equal(err instanceof HttpError, true);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, 'Validation failed');
    assert.deepEqual(err.details, ['field required']);
  });

  test('errorHandler formats known errors consistently', () => {
    const res = createMockRes();
    errorHandler(
      createHttpError(422, 'Invalid input', ['code is required']),
      {},
      res,
      () => {}
    );
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.payload, {
      message: 'Invalid input',
      statusCode: 422,
      details: ['code is required'],
    });
  });

  test('errorHandler falls back to 500 for unknown errors', () => {
    const res = createMockRes();
    errorHandler(new Error('boom'), {}, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.message, 'boom');
    assert.equal(res.payload.statusCode, 500);
  });

  test('errorHandler hides internal details in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const res = createMockRes();
    errorHandler(
      createHttpError(500, 'Raw internal error', { stack: 'details' }),
      {},
      res,
      () => {}
    );
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.payload, {
      message: 'Internal server error',
      statusCode: 500,
    });
    process.env.NODE_ENV = previous;
  });

  test('notFoundHandler forwards 404 error', () => {
    let caughtError = null;
    notFoundHandler({}, {}, (err) => {
      caughtError = err;
    });
    assert.ok(caughtError);
    assert.equal(caughtError.statusCode, 404);
    assert.equal(caughtError.message, 'Route not found');
  });

  test('asyncHandler forwards rejected async errors', async () => {
    const wrapped = asyncHandler(async () => {
      throw createHttpError(400, 'Rejected async handler');
    });
    const forwarded = await new Promise((resolve) => {
      wrapped({}, {}, (err) => resolve(err));
    });
    assert.ok(forwarded);
    assert.equal(forwarded.statusCode, 400);
    assert.equal(forwarded.message, 'Rejected async handler');
  });
});
