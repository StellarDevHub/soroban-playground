// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import * as bullmq from 'bullmq';

const BaseUnrecoverableError = bullmq.UnrecoverableError || Error;

export const JOB_ERROR_CODES = Object.freeze({
  // Retryable transient errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',

  // Non-retryable permanent errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MALFORMED_INPUT: 'MALFORMED_INPUT',
  MISSING_SOURCE: 'MISSING_SOURCE',
  MISSING_WASM_PATH: 'MISSING_WASM_PATH',
  MISSING_CONTRACT_NAME: 'MISSING_CONTRACT_NAME',
});

export const RETRYABLE_ERROR_CODES = new Set([
  JOB_ERROR_CODES.NETWORK_ERROR,
  JOB_ERROR_CODES.TIMEOUT,
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ABORT_ERR',
]);

export const NON_RETRYABLE_ERROR_CODES = new Set([
  JOB_ERROR_CODES.VALIDATION_ERROR,
  JOB_ERROR_CODES.MALFORMED_INPUT,
  JOB_ERROR_CODES.MISSING_SOURCE,
  JOB_ERROR_CODES.MISSING_WASM_PATH,
  JOB_ERROR_CODES.MISSING_CONTRACT_NAME,
]);

const NETWORK_SYSTEM_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  JOB_ERROR_CODES.NETWORK_ERROR,
]);

const TIMEOUT_SYSTEM_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ABORT_ERR',
  JOB_ERROR_CODES.TIMEOUT,
]);

/**
 * Structured job error with retryability classification.
 */
export class JobError extends Error {
  constructor(
    message,
    { retryable, code = 'UNKNOWN', details = null, cause = null } = {}
  ) {
    super(message);
    this.name = 'JobError';
    this.code = code;
    this.retryable =
      typeof retryable === 'boolean'
        ? retryable
        : !NON_RETRYABLE_ERROR_CODES.has(code);
    this.details = details;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Non-retryable job error extending BullMQ's UnrecoverableError so BullMQ
 * immediately aborts retries and routes the job to the Dead-Letter Queue.
 */
export class NonRetryableJobError extends BaseUnrecoverableError {
  constructor(
    message,
    {
      code = JOB_ERROR_CODES.VALIDATION_ERROR,
      details = null,
      cause = null,
    } = {}
  ) {
    super(message);
    this.name = 'UnrecoverableError';
    this.retryable = false;
    this.unrecoverable = true;
    this.code = code;
    this.details = details;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Classify an error thrown by a BullMQ processor into retryable
 * (NETWORK_ERROR, TIMEOUT) or non-retryable (VALIDATION_ERROR, MALFORMED_INPUT).
 *
 * @param {Error|any} err
 * @returns {{ retryable: boolean, code: string, reason: string }}
 */
export function classifyJobError(err) {
  if (!err) {
    return { retryable: true, code: 'UNKNOWN', reason: 'default_retryable' };
  }

  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';

  if (
    err instanceof NonRetryableJobError ||
    (bullmq.UnrecoverableError && err instanceof bullmq.UnrecoverableError) ||
    err.name === 'UnrecoverableError' ||
    err.unrecoverable === true ||
    err.retryable === false ||
    NON_RETRYABLE_ERROR_CODES.has(code)
  ) {
    return {
      retryable: false,
      code: code || JOB_ERROR_CODES.VALIDATION_ERROR,
      reason: 'non_retryable',
    };
  }

  if (
    TIMEOUT_SYSTEM_CODES.has(code) ||
    err.name === 'TimeoutError' ||
    /\b(timeout|timed out)\b/i.test(message)
  ) {
    return {
      retryable: true,
      code: JOB_ERROR_CODES.TIMEOUT,
      reason: 'transient_timeout',
    };
  }

  if (
    NETWORK_SYSTEM_CODES.has(code) ||
    /\b(network|econnreset|econnrefused|enotfound|socket hang up|fetch failed)\b/i.test(
      message
    )
  ) {
    return {
      retryable: true,
      code: JOB_ERROR_CODES.NETWORK_ERROR,
      reason: 'transient_network',
    };
  }

  if (
    err instanceof SyntaxError ||
    /\b(malformed|invalid json|unexpected token)\b/i.test(message)
  ) {
    return {
      retryable: false,
      code: JOB_ERROR_CODES.MALFORMED_INPUT,
      reason: 'non_retryable',
    };
  }

  if (
    err.name === 'ValidationError' ||
    /\bvalidation failed\b/i.test(message)
  ) {
    return {
      retryable: false,
      code: JOB_ERROR_CODES.VALIDATION_ERROR,
      reason: 'non_retryable',
    };
  }

  return {
    retryable: true,
    code: code || 'UNKNOWN',
    reason: 'default_retryable',
  };
}

/**
 * Returns true if the error is non-retryable and should be sent directly to DLQ.
 * @param {Error|any} err
 * @returns {boolean}
 */
export function isNonRetryableError(err) {
  return !classifyJobError(err).retryable;
}

/**
 * Convert any error into a BullMQ-aware error:
 * - Non-retryable errors become NonRetryableJobError (UnrecoverableError)
 * - Retryable errors become JobError with classified code (NETWORK_ERROR / TIMEOUT)
 *
 * @param {Error|any} err
 * @returns {JobError|NonRetryableJobError}
 */
export function toBullMqError(err) {
  if (err instanceof NonRetryableJobError) {
    return err;
  }

  const classification = classifyJobError(err);
  const message = err?.message || 'Job failed';
  const details = err?.details ?? null;

  if (!classification.retryable) {
    return new NonRetryableJobError(message, {
      code: classification.code,
      details,
      cause: err,
    });
  }

  if (err instanceof JobError) {
    err.code = classification.code;
    err.retryable = true;
    return err;
  }

  return new JobError(message, {
    retryable: true,
    code: classification.code,
    details,
    cause: err,
  });
}
