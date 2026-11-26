// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// Pure utility functions for the webhook engine — no database or I/O imports,
// so they can be imported and tested in isolation without mocking side-effects.

import crypto from 'crypto';

export const MAX_ATTEMPTS = 5;
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000];
export const TIMEOUT_MS = 5_000;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

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

export function generateTimestampedSignature(payload, secret, timestamp) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function verifyTimestampedSignature(
  payload,
  secret,
  received,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (!received || !secret) return false;
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(received);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const expected = generateTimestampedSignature(payload, secret, timestamp);
  return crypto.timingSafeEqual(
    Buffer.from(expected.slice(expected.indexOf('v1=') + 3), 'hex'),
    Buffer.from(match[2], 'hex')
  );
}

// Schedule the four configured retries, then continue using the final delay.
export function retryDelayMs(attempt) {
  return RETRY_DELAYS_MS[
    Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)
  ];
}

// Return an ISO-string timestamp for when the next retry should be scheduled.
export function nextAttemptAt(attempt, nowMs = Date.now()) {
  return new Date(nowMs + retryDelayMs(attempt)).toISOString();
}

// Build the custom webhook headers for a single delivery.
export function buildDeliveryHeaders(
  payload,
  secret,
  deliveryId,
  timestamp = Math.floor(Date.now() / 1000)
) {
  const signature = generateSignature(payload, secret);
  return {
    'Content-Type': 'application/json',
    'Stellar-Signature': generateTimestampedSignature(
      payload,
      secret,
      timestamp
    ),
    'X-Soroban-Signature': signature,
    'X-Playground-Signature': signature,
    'X-Soroban-Delivery': deliveryId,
    'X-Playground-Delivery': deliveryId,
  };
}
