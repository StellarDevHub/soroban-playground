// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// Pure utility functions for the webhook engine — no database or I/O imports,
// so they can be imported and tested in isolation without mocking side-effects.

import crypto from 'crypto';

export const MAX_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 64_000;
export const TIMEOUT_MS = 5_000;

// Generate the HMAC-SHA256 signature for a webhook payload.
// Format: "sha256=<hex-digest>" — matches GitHub's webhook signature scheme.
export function generateSignature(payload, secret) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(payload).digest('hex')
  );
}

// Verify a received signature against the expected one using a timing-safe comparison.
export function verifySignature(payload, secret, received) {
  const expected = generateSignature(payload, secret);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(received, 'utf8')
    );
  } catch {
    return false;
  }
}

// Compute the exponential back-off delay for a given attempt number (0-based).
export function retryDelayMs(attempt) {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

// Return an ISO-string timestamp for when the next retry should be scheduled.
export function nextAttemptAt(attempt, nowMs = Date.now()) {
  return new Date(nowMs + retryDelayMs(attempt)).toISOString();
}

// Build the custom webhook headers for a single delivery.
export function buildDeliveryHeaders(payload, secret, deliveryId) {
  return {
    'Content-Type': 'application/json',
    'X-Playground-Signature': generateSignature(payload, secret),
    'X-Playground-Delivery': deliveryId,
  };
}
