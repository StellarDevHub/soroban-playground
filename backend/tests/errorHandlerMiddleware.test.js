import {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  createHttpError,
  asyncHandler,
  notFoundHandler,
  errorHandler,
} from '../src/middleware/errorHandler.js';
import { alertManager } from '../src/utils/alerting.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

function mockReq(overrides = {}) {
  return { path: '/test', method: 'GET', ...overrides };
}

// ---------------------------------------------------------------------------
// HttpError class
// ---------------------------------------------------------------------------

describe('HttpError', () => {
  it('extends Error and sets all properties', () => {
    const details = { field: 'email', reason: 'required' };
    const err = new HttpError(422, 'Unprocessable Entity', details);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.name).toBe('HttpError');
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Unprocessable Entity');
    expect(err.details).toEqual(details);
    expect(err.stack).toBeDefined();
  });

  it('accepts undefined details', () => {
    const err = new HttpError(404, 'Not Found');
    expect(err.details).toBeUndefined();
  });

  it('accepts array details', () => {
    const err = new HttpError(400, 'Bad Request', ['field required']);
    expect(err.details).toEqual(['field required']);
  });
});

// ---------------------------------------------------------------------------
// Built-in sub-classes
// ---------------------------------------------------------------------------

describe('BadRequestError', () => {
  it('has statusCode 400 and default message', () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad Request');
    expect(err.name).toBe('BadRequestError');
    expect(err).toBeInstanceOf(HttpError);
  });

  it('accepts a custom message and details', () => {
    const err = new BadRequestError('Invalid input', ['missing name']);
    expect(err.message).toBe('Invalid input');
    expect(err.details).toEqual(['missing name']);
  });
});

describe('UnauthorizedError', () => {
  it('has statusCode 401 and default message', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Unauthorized');
    expect(err.name).toBe('UnauthorizedError');
    expect(err).toBeInstanceOf(HttpError);
  });

  it('accepts a custom message', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });
});

describe('NotFoundError', () => {
  it('has statusCode 404 and default message', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not Found');
    expect(err.name).toBe('NotFoundError');
    expect(err).toBeInstanceOf(HttpError);
  });

  it('accepts a custom message', () => {
    const err = new NotFoundError('Contract not found');
    expect(err.message).toBe('Contract not found');
  });
});

// ---------------------------------------------------------------------------
// createHttpError factory
// ---------------------------------------------------------------------------

describe('createHttpError', () => {
  it('returns an HttpError instance with the given properties', () => {
    const err = createHttpError(503, 'Service Unavailable', { retry: true });
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(503);
    expect(err.message).toBe('Service Unavailable');
    expect(err.details).toEqual({ retry: true });
  });

  it('returns an HttpError with no details when omitted', () => {
    const err = createHttpError(400, 'Bad Request');
    expect(err.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// asyncHandler
// ---------------------------------------------------------------------------

describe('asyncHandler', () => {
  it('calls the handler and does not invoke next on success', async () => {
    const next = jest.fn();
    const res = mockRes();
    const handler = asyncHandler(async (req, r, n) => {
      void n;
      r.json({ ok: true });
    });

    handler(mockReq(), res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res._body).toEqual({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards async errors to next', async () => {
    const next = jest.fn();
    const thrownError = createHttpError(400, 'Async failure');
    const handler = asyncHandler(async () => {
      throw thrownError;
    });

    handler(mockReq(), mockRes(), next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(thrownError);
  });

  it('forwards synchronous errors thrown inside the handler', async () => {
    const next = jest.fn();
    const syncError = new Error('sync boom');
    const handler = asyncHandler(() => {
      throw syncError;
    });

    handler(mockReq(), mockRes(), next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(syncError);
  });

  it('passes req, res, and next through to the wrapped handler', async () => {
    const req = mockReq({ path: '/hello' });
    const res = mockRes();
    const next = jest.fn();
    let receivedReq, receivedRes, receivedNext;

    const handler = asyncHandler(async (r, s, n) => {
      receivedReq = r;
      receivedRes = s;
      receivedNext = n;
    });

    handler(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(receivedReq).toBe(req);
    expect(receivedRes).toBe(res);
    expect(receivedNext).toBe(next);
  });
});

// ---------------------------------------------------------------------------
// notFoundHandler
// ---------------------------------------------------------------------------

describe('notFoundHandler', () => {
  it('calls next with a 404 HttpError', () => {
    const next = jest.fn();
    notFoundHandler(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Route not found');
  });
});

// ---------------------------------------------------------------------------
// errorHandler — status code resolution
// ---------------------------------------------------------------------------

describe('errorHandler — status code resolution', () => {
  it('uses the error statusCode for 4xx errors', () => {
    const res = mockRes();
    errorHandler(createHttpError(400, 'Bad'), mockReq(), res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._body.statusCode).toBe(400);
  });

  it('uses the error statusCode for 5xx errors', () => {
    const res = mockRes();
    errorHandler(
      createHttpError(503, 'Unavailable'),
      mockReq(),
      res,
      jest.fn()
    );
    expect(res._status).toBe(503);
    expect(res._body.statusCode).toBe(503);
  });

  it('falls back to 500 when statusCode is below 400', () => {
    const res = mockRes();
    const err = createHttpError(302, 'Redirect');
    errorHandler(err, mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
    expect(res._body.statusCode).toBe(500);
  });

  it('falls back to 500 when statusCode is negative', () => {
    const res = mockRes();
    errorHandler(createHttpError(-1, 'Negative'), mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
  });

  it('falls back to 500 when statusCode is a float', () => {
    const res = mockRes();
    const err = new Error('float');
    err.statusCode = 404.5;
    errorHandler(err, mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
  });

  it('falls back to 500 when there is no statusCode', () => {
    const res = mockRes();
    errorHandler(new Error('plain'), mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
  });

  it('falls back to 500 for null error', () => {
    const res = mockRes();
    errorHandler(null, mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
    expect(res._body.message).toBe('Internal server error');
  });

  it('falls back to 500 for undefined error', () => {
    const res = mockRes();
    errorHandler(undefined, mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
    expect(res._body.message).toBe('Internal server error');
  });

  it('falls back to 500 for empty object error', () => {
    const res = mockRes();
    errorHandler({}, mockReq(), res, jest.fn());
    expect(res._status).toBe(500);
    expect(res._body.message).toBe('Internal server error');
  });
});

// ---------------------------------------------------------------------------
// errorHandler — response payload
// ---------------------------------------------------------------------------

describe('errorHandler — response payload (development/test mode)', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('includes message, statusCode, and details for 4xx errors', () => {
    const res = mockRes();
    errorHandler(
      createHttpError(400, 'Validation error', ['name is required']),
      mockReq(),
      res,
      jest.fn()
    );
    expect(res._body).toEqual({
      message: 'Validation error',
      statusCode: 400,
      details: ['name is required'],
    });
  });

  it('includes message, statusCode, and details for 5xx errors', () => {
    const res = mockRes();
    errorHandler(
      createHttpError(500, 'DB crash', { table: 'users' }),
      mockReq(),
      res,
      jest.fn()
    );
    expect(res._body).toEqual({
      message: 'DB crash',
      statusCode: 500,
      details: { table: 'users' },
    });
  });

  it('omits details key when details is undefined', () => {
    const res = mockRes();
    errorHandler(createHttpError(400, 'No details'), mockReq(), res, jest.fn());
    expect('details' in res._body).toBe(false);
  });

  it('uses the error message when provided', () => {
    const res = mockRes();
    errorHandler(new Error('custom message'), mockReq(), res, jest.fn());
    expect(res._body.message).toBe('custom message');
  });
});

// ---------------------------------------------------------------------------
// errorHandler — production mode
// ---------------------------------------------------------------------------

describe('errorHandler — production mode', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('masks 5xx message and omits details in production', () => {
    const res = mockRes();
    errorHandler(
      createHttpError(500, 'Raw internal error', { stack: 'private' }),
      mockReq(),
      res,
      jest.fn()
    );
    expect(res._body).toEqual({
      message: 'Internal server error',
      statusCode: 500,
    });
    expect('details' in res._body).toBe(false);
  });

  it('keeps 4xx message visible but strips details in production', () => {
    const res = mockRes();
    errorHandler(
      createHttpError(401, 'Token expired', { token: 'abc' }),
      mockReq(),
      res,
      jest.fn()
    );
    expect(res._body.message).toBe('Token expired');
    expect(res._body.statusCode).toBe(401);
    expect('details' in res._body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// errorHandler — alerting
// ---------------------------------------------------------------------------

describe('errorHandler — server error alerting', () => {
  let originalAlert;
  let alertSpy;

  beforeEach(() => {
    originalAlert = alertManager.alert;
    alertSpy = jest.fn();
    alertManager.alert = alertSpy;
  });

  afterEach(() => {
    alertManager.alert = originalAlert;
  });

  it('fires an alert for 5xx errors', () => {
    const req = mockReq({ path: '/api/compile', method: 'POST' });
    const res = mockRes();

    errorHandler(createHttpError(500, 'Crash'), req, res, jest.fn());

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('server_error', {
      statusCode: 500,
      message: 'Crash',
      path: '/api/compile',
      method: 'POST',
    });
  });

  it('does not fire an alert for 4xx errors', () => {
    const res = mockRes();
    errorHandler(createHttpError(400, 'Bad input'), mockReq(), res, jest.fn());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not fire an alert for errors that fall back to a 4xx code', () => {
    const res = mockRes();
    errorHandler(createHttpError(404, 'Gone'), mockReq(), res, jest.fn());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
