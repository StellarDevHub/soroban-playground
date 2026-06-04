import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  createHttpError,
  asyncHandler,
  notFoundHandler,
  errorHandler,
} from '../src/middleware/errorHandler.js';
import { alertManager } from '../src/utils/alerting.js';

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
  test('HttpError properties and inheritance', () => {
    const details = { field: 'username', issue: 'taken' };
    const err = new HttpError(409, 'Conflict', details);
    assert.equal(err instanceof Error, true);
    assert.equal(err instanceof HttpError, true);
    assert.equal(err.name, 'HttpError');
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, 'Conflict');
    assert.deepEqual(err.details, details);
    assert.ok(err.stack);
  });

  test('createHttpError returns HttpError shape', () => {
    const err = createHttpError(400, 'Validation failed', ['field required']);
    assert.equal(err instanceof HttpError, true);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, 'Validation failed');
    assert.deepEqual(err.details, ['field required']);
  });

  test('asyncHandler executes successfully and does not call next', async () => {
    let nextCalled = false;
    let handlerCalled = false;
    const req = { query: { name: 'test' } };
    const res = { send: () => {} };

    const handler = asyncHandler(async (q, s, next) => {
      assert.equal(q, req);
      assert.equal(s, res);
      handlerCalled = true;
      void next;
    });

    handler(req, res, () => {
      nextCalled = true;
    });

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(handlerCalled, true);
    assert.equal(nextCalled, false);
  });

  test('asyncHandler propagates synchronous errors synchronously', () => {
    const syncError = new Error('sync fail');
    const handler = asyncHandler(() => {
      throw syncError;
    });

    assert.throws(() => {
      handler({}, {}, () => {});
    }, (err) => err === syncError);
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

  test('notFoundHandler forwards 404 error', () => {
    let caughtError = null;
    notFoundHandler({}, {}, (err) => {
      caughtError = err;
    });
    assert.ok(caughtError);
    assert.equal(caughtError.statusCode, 404);
    assert.equal(caughtError.message, 'Route not found');
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
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const res = createMockRes();
      errorHandler(new Error('boom'), {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.message, 'boom');
      assert.equal(res.payload.statusCode, 500);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('errorHandler status code parsing and fallback logic', () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      // Status code < 400 falls back to 500
      let res = createMockRes();
      const err302 = createHttpError(302, 'Found');
      errorHandler(err302, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.statusCode, 500);

      // Negative status code falls back to 500
      res = createMockRes();
      const errNegative = createHttpError(-5, 'Negative');
      errorHandler(errNegative, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.statusCode, 500);

      // Non-integer status code falls back to 500
      res = createMockRes();
      errorHandler(new Error('no status'), {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.statusCode, 500);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('errorHandler behavior in development/test environment (NODE_ENV !== production)', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      // 500 error: returns original message and details
      let res = createMockRes();
      const err500 = createHttpError(500, 'DB connection failed', { stack: 'db:123' });
      errorHandler(err500, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.payload, {
        message: 'DB connection failed',
        statusCode: 500,
        details: { stack: 'db:123' },
      });

      // 400 error: returns details and original message
      res = createMockRes();
      const err400 = createHttpError(400, 'Invalid parameters', ['missing email']);
      errorHandler(err400, {}, res, () => {});
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.payload, {
        message: 'Invalid parameters',
        statusCode: 400,
        details: ['missing email'],
      });

      // Details undefined: no details key in payload
      res = createMockRes();
      errorHandler(createHttpError(400, 'Simple error'), {}, res, () => {});
      assert.equal(res.statusCode, 400);
      assert.equal('details' in res.payload, false);
    } finally {
      process.env.NODE_ENV = originalEnv;
      console.error = originalConsoleError;
    }
  });

  test('errorHandler hides internal details in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
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
    } finally {
      process.env.NODE_ENV = previous;
      console.error = originalConsoleError;
    }
  });

  test('errorHandler behavior in production environment (NODE_ENV === production) for 4xx errors', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      // 4xx error: does NOT mask message, but does exclude details
      const res = createMockRes();
      const err400 = createHttpError(400, 'Invalid parameters', ['missing email']);
      errorHandler(err400, {}, res, () => {});
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.payload, {
        message: 'Invalid parameters',
        statusCode: 400,
      });
    } finally {
      process.env.NODE_ENV = originalEnv;
      console.error = originalConsoleError;
    }
  });

  test('errorHandler server error alerting behavior', () => {
    const originalConsoleError = console.error;
    const originalAlert = alertManager.alert;
    console.error = () => {};

    let alertCalledWith = null;
    alertManager.alert = (type, details) => {
      alertCalledWith = { type, details };
    };

    const req = {
      path: '/api/test',
      method: 'POST',
    };

    try {
      // 500 error triggers an alert
      let res = createMockRes();
      const err500 = createHttpError(500, 'Crash error');
      errorHandler(err500, req, res, () => {});
      assert.ok(alertCalledWith);
      assert.equal(alertCalledWith.type, 'server_error');
      assert.deepEqual(alertCalledWith.details, {
        statusCode: 500,
        message: 'Crash error',
        path: '/api/test',
        method: 'POST',
      });

      // Reset alert spy
      alertCalledWith = null;

      // 400 error does NOT trigger an alert
      res = createMockRes();
      const err400 = createHttpError(400, 'Bad parameters');
      errorHandler(err400, req, res, () => {});
      assert.equal(alertCalledWith, null);
    } finally {
      console.error = originalConsoleError;
      alertManager.alert = originalAlert;
    }
  });

  test('errorHandler handling of empty / null / undefined errors', () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      // null error
      let res = createMockRes();
      errorHandler(null, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.message, 'Internal server error');

      // undefined error
      res = createMockRes();
      errorHandler(undefined, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.message, 'Internal server error');

      // empty object
      res = createMockRes();
      errorHandler({}, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.payload.message, 'Internal server error');
    } finally {
      console.error = originalConsoleError;
    }
  });
});
