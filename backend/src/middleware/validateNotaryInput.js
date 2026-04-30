// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { createHttpError } from './errorHandler.js';

/**
 * Validate notary input:
 * - fileHash must be a 64-char hex string
 * - metadata must be a non-empty string (max 500 chars)
 */
export function validateNotaryInput(req, res, next) {
  const { fileHash, metadata } = req.body ?? {};
  const errors = [];

  if (!fileHash || typeof fileHash !== 'string') {
    errors.push('fileHash is required and must be a string');
  } else if (!/^[0-9a-fA-F]{64}$/.test(fileHash)) {
    errors.push('fileHash must be a 64-character hex string');
  }

  if (!metadata || typeof metadata !== 'string') {
    errors.push('metadata is required and must be a string');
  } else if (metadata.length === 0) {
    errors.push('metadata must not be empty');
  } else if (metadata.length > 500) {
    errors.push('metadata must not exceed 500 characters');
  }

  if (errors.length > 0) {
    return next(createHttpError(400, 'Validation failed', errors));
  }

  next();
}
