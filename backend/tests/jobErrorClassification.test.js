// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  JOB_ERROR_CODES,
  JobError,
  NonRetryableJobError,
  classifyJobError,
  isNonRetryableError,
  toBullMqError,
} from '../src/workers/jobErrors.js';
import { routeFailedJobToDlq } from '../src/services/bullmqDlqService.js';

describe('Job error classification and immediate DLQ routing', () => {
  it('classifies transient network errors as retryable NETWORK_ERROR', () => {
    const err = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    const result = classifyJobError(err);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe(JOB_ERROR_CODES.NETWORK_ERROR);
    expect(isNonRetryableError(err)).toBe(false);
  });

  it('classifies timeout errors as retryable TIMEOUT', () => {
    const err = Object.assign(new Error('request timed out'), {
      code: 'ETIMEDOUT',
    });
    const result = classifyJobError(err);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe(JOB_ERROR_CODES.TIMEOUT);
    expect(isNonRetryableError(err)).toBe(false);
  });

  it('classifies validation and malformed input errors as non-retryable', () => {
    const validationErr = new NonRetryableJobError('Validation failed', {
      code: JOB_ERROR_CODES.VALIDATION_ERROR,
    });
    const malformedErr = new SyntaxError('Unexpected token in JSON');

    expect(classifyJobError(validationErr)).toMatchObject({
      retryable: false,
      code: JOB_ERROR_CODES.VALIDATION_ERROR,
    });
    expect(classifyJobError(malformedErr)).toMatchObject({
      retryable: false,
      code: JOB_ERROR_CODES.MALFORMED_INPUT,
    });
    expect(isNonRetryableError(validationErr)).toBe(true);
    expect(isNonRetryableError(malformedErr)).toBe(true);
  });

  it('wraps non-retryable errors into NonRetryableJobError via toBullMqError', () => {
    const err = new JobError('Invalid payload', {
      retryable: false,
      code: JOB_ERROR_CODES.MALFORMED_INPUT,
    });
    const wrapped = toBullMqError(err);
    expect(wrapped).toBeInstanceOf(NonRetryableJobError);
    expect(wrapped.retryable).toBe(false);
    expect(wrapped.unrecoverable).toBe(true);
    expect(wrapped.code).toBe(JOB_ERROR_CODES.MALFORMED_INPUT);
  });

  it('routes non-retryable jobs immediately to DLQ on first attempt', async () => {
    const dlqAdd = jest.fn().mockResolvedValue({ id: 'email:job-1' });
    const job = {
      id: 'job-1',
      name: 'send-email',
      queueName: 'email',
      attemptsMade: 1,
      opts: { attempts: 3 },
      data: { to: 'bad-email' },
      updateData: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const err = new NonRetryableJobError('Validation failed: invalid email', {
      code: JOB_ERROR_CODES.VALIDATION_ERROR,
    });

    const outcome = await routeFailedJobToDlq({
      job,
      error: err,
      dlqQueue: { add: dlqAdd },
      removeOriginal: true,
    });

    expect(outcome.routed).toBe(true);
    expect(outcome.routedReason).toBe('non_retryable');
    expect(dlqAdd).toHaveBeenCalledTimes(1);
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('does not route retryable jobs to DLQ before attempts are exhausted', async () => {
    const dlqAdd = jest.fn();
    const job = {
      id: 'job-2',
      name: 'send-email',
      queueName: 'email',
      attemptsMade: 1,
      opts: { attempts: 3 },
      data: { to: 'user@example.com' },
      updateData: jest.fn().mockResolvedValue(undefined),
    };

    const err = Object.assign(new Error('Connection timed out'), {
      code: 'ETIMEDOUT',
    });

    const outcome = await routeFailedJobToDlq({
      job,
      error: err,
      dlqQueue: { add: dlqAdd },
    });

    expect(outcome.routed).toBe(false);
    expect(outcome.reason).toBe('not_final_attempt');
    expect(dlqAdd).not.toHaveBeenCalled();
  });
});
