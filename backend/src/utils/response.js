export function successResponse({
  data = null,
  message = 'Success',
  meta = null,
} = {}) {
  return {
    success: true,
    status: 'success',
    message,
    data: data === undefined ? null : data,
    ...(meta ? { meta } : {}),
  };
}

export function errorResponse({
  message = 'An error occurred',
  details = null,
  errors = null,
} = {}) {
  return {
    success: false,
    status: 'error',
    message,
    data: null,
    ...(details ? { details } : {}),
    ...(errors ? { errors } : {}),
  };
}

export function sendSuccess(
  res,
  { data = null, message = 'Success', statusCode = 200, meta = null } = {}
) {
  return res.status(statusCode).json(successResponse({ data, message, meta }));
}

export function sendError(
  res,
  {
    message = 'An error occurred',
    statusCode = 500,
    details = null,
    errors = null,
  } = {}
) {
  return res
    .status(statusCode)
    .json(errorResponse({ message, details, errors }));
}
