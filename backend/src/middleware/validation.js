// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { z } from 'zod';
import { createHttpError } from './errorHandler.js';

// Keys that can rewrite an object's prototype when copied with `obj[key] = v`
// or `for...in` loops (see versionTransformer's transformToV2).
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_INSPECT_DEPTH = 64;

export const commonSchemas = {
  stellarAddress: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key format'),
  idParam: z.object({
    id: z.string().min(1, 'ID parameter is required'),
  }),
  paginationQuery: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
};

export function formatZodError(error) {
  if (!error || !error.issues) {
    return [
      { field: 'unknown', message: error?.message || 'Validation failed' },
    ];
  }
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validate and sanitise req.body / req.query / req.params with Zod schemas.
 * On success the parsed value replaces the original, so unknown keys
 * (stripped by z.object) never reach the handler.
 *
 * @param {{body?: z.ZodTypeAny, query?: z.ZodTypeAny, params?: z.ZodTypeAny}} schemas
 * @param {Object} [options]
 * @param {'envelope'|'httpError'} [options.format='envelope'] - 'envelope'
 *   responds 422 with field-level details; 'httpError' forwards a
 *   createHttpError(statusCode, 'Validation failed', messages[]) to the error
 *   handler, matching the legacy hand-written validators.
 * @param {number} [options.statusCode=400] - Status used with format 'httpError'.
 */
export function validateRequest(schemas = {}, options = {}) {
  const {
    body: bodySchema,
    query: querySchema,
    params: paramsSchema,
  } = schemas;
  const { format = 'envelope', statusCode = 400 } = options;

  return (req, res, next) => {
    const errors = [];

    if (bodySchema) {
      const result = bodySchema.safeParse(req.body || {});
      if (!result.success) {
        errors.push(
          ...formatZodError(result.error).map((e) => ({
            ...e,
            location: 'body',
          }))
        );
      } else {
        req.body = result.data;
      }
    }

    if (querySchema) {
      const result = querySchema.safeParse(req.query || {});
      if (!result.success) {
        errors.push(
          ...formatZodError(result.error).map((e) => ({
            ...e,
            location: 'query',
          }))
        );
      } else {
        req.query = result.data;
      }
    }

    if (paramsSchema) {
      const result = paramsSchema.safeParse(req.params || {});
      if (!result.success) {
        errors.push(
          ...formatZodError(result.error).map((e) => ({
            ...e,
            location: 'params',
          }))
        );
      } else {
        req.params = result.data;
      }
    }

    if (errors.length > 0) {
      if (format === 'httpError') {
        return next(
          createHttpError(
            statusCode,
            'Validation failed',
            errors.map((e) => e.message)
          )
        );
      }
      return res.status(422).json({
        success: false,
        error: 'Unprocessable Entity',
        message: 'Validation failed for request parameters',
        details: errors,
      });
    }

    return next();
  };
}

export function validateInput(req, res, next) {
  return next();
}

/**
 * Return a description of the first prototype-pollution key found in
 * `value` (or of excessive nesting), else null. Iterative so hostile,
 * deeply nested payloads cannot blow the stack.
 */
export function findForbiddenKey(value) {
  const stack = [{ node: value, path: '', depth: 0 }];
  while (stack.length > 0) {
    const { node, path, depth } = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (depth > MAX_INSPECT_DEPTH) {
      return `${path || 'root'} exceeds the maximum nesting depth`;
    }
    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key)) return `${childPath} is not an allowed key`;
      stack.push({ node: node[key], path: childPath, depth: depth + 1 });
    }
  }
  return null;
}

/**
 * Global guard: reject any request whose body or query contains
 * `__proto__`, `constructor` or `prototype` keys at any depth.
 */
export function rejectPrototypePollution(req, _res, next) {
  for (const [location, value] of [
    ['body', req.body],
    ['query', req.query],
  ]) {
    const offending = findForbiddenKey(value);
    if (offending) {
      return next(
        createHttpError(400, 'Validation failed', [`${location}.${offending}`])
      );
    }
  }
  return next();
}

export default {
  validateRequest,
  validateInput,
  rejectPrototypePollution,
  findForbiddenKey,
  commonSchemas,
  formatZodError,
};
