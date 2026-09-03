// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { z } from 'zod';

export const commonSchemas = {
  stellarAddress: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key format'),
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
    return [{ field: 'unknown', message: error?.message || 'Validation failed' }];
  }
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));
}

export function validateRequest(schemas = {}) {
  const { body: bodySchema, query: querySchema, params: paramsSchema } = schemas;

  return (req, res, next) => {
    const errors = [];

    if (bodySchema) {
      const result = bodySchema.safeParse(req.body || {});
      if (!result.success) {
        errors.push(...formatZodError(result.error).map((e) => ({ ...e, location: 'body' })));
      } else {
        req.body = result.data;
      }
    }

    if (querySchema) {
      const result = querySchema.safeParse(req.query || {});
      if (!result.success) {
        errors.push(...formatZodError(result.error).map((e) => ({ ...e, location: 'query' })));
      } else {
        req.query = result.data;
      }
    }

    if (paramsSchema) {
      const result = paramsSchema.safeParse(req.params || {});
      if (!result.success) {
        errors.push(...formatZodError(result.error).map((e) => ({ ...e, location: 'params' })));
      } else {
        req.params = result.data;
      }
    }

    if (errors.length > 0) {
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

export default {
  validateRequest,
  validateInput,
  commonSchemas,
  formatZodError,
};
