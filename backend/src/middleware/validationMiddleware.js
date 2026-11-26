// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { ValidationError } from '../utils/schemaValidator.js';

function isZodSchema(schema) {
  return Boolean(schema && typeof schema.safeParse === 'function');
}

function enforceStrict(schema, strict) {
  if (!strict || !schema) return schema;
  if (typeof schema.strict === 'function') {
    return schema.strict();
  }
  return schema;
}

export function formatZodIssues(error, location) {
  const issues = error?.issues ?? [];
  if (issues.length === 0) {
    return [
      {
        path: 'root',
        field: 'root',
        message: error?.message || 'Validation failed',
        code: 'custom',
        ...(location ? { location } : {}),
      },
    ];
  }
  return issues.map((issue) => {
    const path =
      Array.isArray(issue.path) && issue.path.length > 0
        ? issue.path.join('.')
        : 'root';
    return {
      path,
      field: path,
      message: issue.message,
      code: issue.code,
      ...(location ? { location } : {}),
    };
  });
}

function buildBadRequestPayload(issues, detailFormat = 'structured') {
  if (detailFormat === 'messages') {
    return {
      success: false,
      error: 'Bad Request',
      message: 'Validation failed',
      statusCode: 400,
      details: issues.map((i) => i.message),
      errors: issues,
    };
  }
  return {
    success: false,
    error: 'Bad Request',
    message: 'Validation failed',
    statusCode: 400,
    details: issues,
  };
}

/**
 * Express middleware factory that validates req.body, req.query, and/or
 * req.params against Zod schemas. Enforces `.strict()` by default to reject
 * unexpected object keys and returns a standardized 400 Bad Request payload.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 * @param {{ strict?: boolean, detailFormat?: 'structured' | 'messages' }} [options]
 */
export function validateZod(schemas = {}, options = {}) {
  const { strict = true, detailFormat = 'structured' } = options;
  const bodySchema = enforceStrict(schemas.body, strict);
  const querySchema = enforceStrict(schemas.query, strict);
  const paramsSchema = enforceStrict(schemas.params, strict);

  return (req, res, next) => {
    const issues = [];

    if (paramsSchema) {
      const result = paramsSchema.safeParse(req.params ?? {});
      if (!result.success) {
        issues.push(...formatZodIssues(result.error, 'params'));
      } else {
        req.params = result.data;
      }
    }

    if (querySchema) {
      const result = querySchema.safeParse(req.query ?? {});
      if (!result.success) {
        issues.push(...formatZodIssues(result.error, 'query'));
      } else {
        Object.defineProperty(req, 'query', {
          configurable: true,
          enumerable: true,
          value: result.data,
          writable: true,
        });
      }
    }

    if (bodySchema) {
      const result = bodySchema.safeParse(req.body ?? {});
      if (!result.success) {
        issues.push(...formatZodIssues(result.error, 'body'));
      } else {
        req.body = result.data;
      }
    }

    if (issues.length > 0) {
      return res.status(400).json(buildBadRequestPayload(issues, detailFormat));
    }

    return next();
  };
}

/**
 * Express middleware factory that validates req.body against a Zod schema
 * (returns 400 Bad Request with structured field details) or a legacy
 * ObjectSchema (returns 422).
 *
 * @param {import('zod').ZodTypeAny | import('../utils/schemaValidator.js').ObjectSchema} schema
 */
export function validateBody(schema) {
  if (isZodSchema(schema)) {
    return validateZod({ body: schema });
  }
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(422).json(formatErrors(err.errors));
      }
      next(err);
    }
  };
}

/**
 * Express middleware factory that validates req.query against a Zod schema
 * (returns 400 Bad Request with structured field details) or a legacy
 * ObjectSchema (returns 422).
 *
 * @param {import('zod').ZodTypeAny | import('../utils/schemaValidator.js').ObjectSchema} schema
 */
export function validateQuery(schema) {
  if (isZodSchema(schema)) {
    return validateZod({ query: schema });
  }
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(422).json(formatErrors(err.errors));
      }
      next(err);
    }
  };
}

/**
 * Express middleware factory that validates req.params against a Zod schema.
 *
 * @param {import('zod').ZodTypeAny} schema
 */
export function validateParams(schema) {
  return validateZod({ params: schema });
}

function formatErrors(errors) {
  return {
    error: 'Validation Error',
    status: 422,
    details: errors.map(({ path, message }) => ({ field: path, message })),
  };
}
