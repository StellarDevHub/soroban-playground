// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { ValidationError } from '../utils/schemaValidator.js';

/**
 * Express middleware factory that validates req.body against an ObjectSchema.
 * Replaces req.body with the parsed (coerced + stripped) value on success.
 * Returns 422 with a standardized error envelope on failure.
 *
 * @param {import('../utils/schemaValidator.js').ObjectSchema} schema
 */
export function validateBody(schema) {
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
 * Express middleware factory that validates req.query against an ObjectSchema.
 * Replaces req.query with the parsed value on success.
 *
 * @param {import('../utils/schemaValidator.js').ObjectSchema} schema
 */
export function validateQuery(schema) {
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

function formatErrors(errors) {
  return {
    error: 'Validation Error',
    status: 422,
    details: errors.map(({ path, message }) => ({ field: path, message })),
  };
}
