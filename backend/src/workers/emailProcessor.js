// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { sanitizeEmailHtml } from './emailSanitizer.js';
import {
  JobError,
  NonRetryableJobError,
  JOB_ERROR_CODES,
  toBullMqError,
} from './jobErrors.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 1_048_576;
const DEFAULT_SUBJECT = '(no subject)';
const DEFAULT_FROM = 'noreply@soroban-playground.dev';

/**
 * Strip characters that would break out of an SMTP header. A CR or LF in the
 * subject or sender lets a caller append arbitrary headers (Bcc, a different
 * Content-Type) to the message, so they are folded to spaces rather than
 * passed through. Recipients are already protected by EMAIL_REGEX, which
 * forbids whitespace.
 */
function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n\u0000]+/g, ' ').trim();
}

function validateEmailInput(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Job data must be a non-null object'] };
  }

  if (!data.to || typeof data.to !== 'string') {
    errors.push('Recipient "to" is required and must be a string');
  } else if (!EMAIL_REGEX.test(data.to.trim())) {
    errors.push(`Invalid email address: "${data.to}"`);
  }

  // An empty subject is not an error: it is what a template with no subject
  // variable renders to, and it is replaced with DEFAULT_SUBJECT below. Only
  // the type and encoded length are validated here.
  if (data.subject != null) {
    if (typeof data.subject !== 'string') {
      errors.push('"subject" must be a string');
    } else if (data.subject.length > MAX_SUBJECT_LENGTH) {
      errors.push(`"subject" exceeds maximum length of ${MAX_SUBJECT_LENGTH}`);
    }
  }

  if (data.body != null && typeof data.body !== 'string') {
    errors.push('"body" must be a string');
  } else if (data.body && data.body.length > MAX_BODY_LENGTH) {
    errors.push(`"body" exceeds maximum length of ${MAX_BODY_LENGTH}`);
  }

  if (data.html != null && typeof data.html !== 'string') {
    errors.push('"html" must be a string');
  } else if (data.html && data.html.length > MAX_BODY_LENGTH) {
    errors.push(`"html" exceeds maximum length of ${MAX_BODY_LENGTH}`);
  }

  if (data.from != null && typeof data.from !== 'string') {
    errors.push('"from" must be a string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Sandboxed processor for sending emails.
 * Runs in a separate process.
 *
 * Job data shape:
 *   { to: string, subject?: string, body?: string, html?: string, from?: string }
 */
export default async function emailProcessor(job) {
  const data = job.data || {};
  const startTime = Date.now();

  console.log(
    `[Email Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1}/${job.opts?.attempts ?? 'unknown'})`
  );

  const validation = validateEmailInput(data);
  if (!validation.valid) {
    throw new NonRetryableJobError(
      `Validation failed: ${validation.errors.join('; ')}`,
      {
        code: JOB_ERROR_CODES.VALIDATION_ERROR,
        details: validation.errors,
      }
    );
  }

  const { to, subject, body, html, from } = data;
  const emailSubject = subject?.trim()
    ? sanitizeHeaderValue(subject)
    : DEFAULT_SUBJECT;
  const emailFrom = from ? sanitizeHeaderValue(from) : DEFAULT_FROM;
  // Sanitize at the send boundary: whatever template produced `html`, only
  // policy-compliant markup reaches the transport.
  const safeHtml = sanitizeEmailHtml(html);
  const recipient = to.trim();

  try {
    await job.updateProgress(20);

    console.log(
      `[Email Worker] Sending email to ${recipient} with subject "${emailSubject}"`
    );

    await job.updateProgress(50);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await job.updateProgress(100);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Email Worker] Email sent successfully to ${recipient} in ${durationMs}ms`
    );

    return {
      success: true,
      sentTo: recipient,
      subject: emailSubject,
      from: emailFrom,
      hasHtmlContent: safeHtml !== '',
      hasTextContent: Boolean(body),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const classifiedError = toBullMqError(err);
    console.error(
      `[Email Worker] Job ${job.id} failed after ${durationMs}ms (${classifiedError.code}, retryable=${classifiedError.retryable}):`,
      classifiedError.message
    );
    throw classifiedError;
  }
}

export { JobError, NonRetryableJobError };
