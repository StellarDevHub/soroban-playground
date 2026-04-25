// Error strategy decisions:
// - Standard JSON error format: { message, statusCode, details? }.
// - Route handlers should throw/forward errors and let this middleware format the response.
// - Unknown errors fall back to 500 with a safe default message.
// - In production, internal 5xx details are hidden to avoid leaking implementation internals.
// - Async route errors are captured via asyncHandler and forwarded to next(err).

export class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function createHttpError(statusCode, message, details) {
  return new HttpError(statusCode, message, details);
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req, res, next) {
  next(createHttpError(404, 'Route not found'));
}

export function errorHandler(err, req, res, _next) {
  void _next;

  const rawStatus = Number(err?.statusCode);
  const statusCode =
    Number.isInteger(rawStatus) && rawStatus >= 400 ? rawStatus : 500;
  const isProduction = process.env.NODE_ENV === 'production';
  const isInternalError = statusCode >= 500;

  const payload = {
    message: err?.message || 'Internal server error',
    statusCode,
  };

  if (err?.details !== undefined && !isProduction) {
    payload.details = err.details;
  }

  if (isInternalError && isProduction) {
    payload.message = 'Internal server error';
  }

  res.status(statusCode).json(payload);
}
