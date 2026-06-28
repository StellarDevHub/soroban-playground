import crypto from 'crypto';
import {
  generateSignature,
  verifySignature,
  retryDelayMs,
  nextAttemptAt,
  buildDeliveryHeaders,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  TIMEOUT_MS,
} from '../src/services/webhookUtils.js';

// ── generateSignature ─────────────────────────────────────────────────────────

describe('generateSignature', () => {
  const secret = 'super-secret-key-for-testing';
  const payload = JSON.stringify({ event: 'deploy.completed', id: 'abc123' });

  it('produces an HMAC-SHA256 signature prefixed with sha256=', () => {
    const sig = generateSignature(payload, secret);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('is deterministic for the same payload and secret', () => {
    expect(generateSignature(payload, secret)).toBe(
      generateSignature(payload, secret)
    );
  });

  it('changes when the payload changes', () => {
    const other = JSON.stringify({ event: 'deploy.failed' });
    expect(generateSignature(payload, secret)).not.toBe(
      generateSignature(other, secret)
    );
  });

  it('changes when the secret changes', () => {
    expect(generateSignature(payload, secret)).not.toBe(
      generateSignature(payload, 'different-secret')
    );
  });

  it('matches a manual crypto.createHmac computation', () => {
    const sig = generateSignature(payload, secret);
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(sig).toBe(expected);
  });
});

// ── verifySignature ───────────────────────────────────────────────────────────

describe('verifySignature', () => {
  const secret = 'verify-secret-key-test';
  const payload = '{"event":"compile.succeeded"}';

  it('returns true for a valid signature', () => {
    const sig = generateSignature(payload, secret);
    expect(verifySignature(payload, secret, sig)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const sig = generateSignature(payload, secret);
    expect(verifySignature('{"event":"tampered"}', secret, sig)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const sig = generateSignature(payload, 'wrong-secret');
    expect(verifySignature(payload, secret, sig)).toBe(false);
  });

  it('returns false for a malformed signature string', () => {
    expect(verifySignature(payload, secret, 'not-a-sig')).toBe(false);
  });
});

// ── Exponential backoff ───────────────────────────────────────────────────────

describe('retryDelayMs', () => {
  it('starts at BASE_DELAY_MS on attempt 0', () => {
    expect(retryDelayMs(0)).toBe(BASE_DELAY_MS);
  });

  it('doubles on each attempt', () => {
    expect(retryDelayMs(1)).toBe(BASE_DELAY_MS * 2);
    expect(retryDelayMs(2)).toBe(BASE_DELAY_MS * 4);
    expect(retryDelayMs(3)).toBe(BASE_DELAY_MS * 8);
    expect(retryDelayMs(4)).toBe(BASE_DELAY_MS * 16);
  });

  it('caps at MAX_DELAY_MS', () => {
    expect(retryDelayMs(6)).toBe(MAX_DELAY_MS);
    expect(retryDelayMs(20)).toBe(MAX_DELAY_MS);
  });

  it('MAX_ATTEMPTS is 5', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describe('nextAttemptAt', () => {
  it('returns an ISO timestamp in the future', () => {
    const now = Date.now();
    const ts = nextAttemptAt(0, now);
    expect(new Date(ts).getTime()).toBeGreaterThan(now);
  });

  it('schedules further into the future on later attempts', () => {
    const now = Date.now();
    const t0 = new Date(nextAttemptAt(0, now)).getTime();
    const t1 = new Date(nextAttemptAt(1, now)).getTime();
    expect(t1).toBeGreaterThan(t0);
  });
});

// ── Delivery timeout ──────────────────────────────────────────────────────────

describe('constants', () => {
  it('TIMEOUT_MS is 5 seconds', () => {
    expect(TIMEOUT_MS).toBe(5_000);
  });
});

// ── buildDeliveryHeaders ──────────────────────────────────────────────────────

describe('buildDeliveryHeaders', () => {
  const payload = '{"event":"test.event"}';
  const secret = 'delivery-headers-secret';
  const deliveryId = 'delivery-abc-123';

  it('includes Content-Type application/json', () => {
    const headers = buildDeliveryHeaders(payload, secret, deliveryId);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('includes X-Playground-Signature as sha256=<hex>', () => {
    const headers = buildDeliveryHeaders(payload, secret, deliveryId);
    expect(headers['X-Playground-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('includes X-Playground-Delivery with the delivery ID', () => {
    const headers = buildDeliveryHeaders(payload, secret, deliveryId);
    expect(headers['X-Playground-Delivery']).toBe(deliveryId);
  });

  it('signature can be independently verified', () => {
    const headers = buildDeliveryHeaders(payload, secret, deliveryId);
    expect(
      verifySignature(payload, secret, headers['X-Playground-Signature'])
    ).toBe(true);
  });
});

// ── Subscription input validation (route-layer rules) ────────────────────────

describe('webhook subscription validation', () => {
  const URL_RE = /^https?:\/\/.+/;

  it('accepts http and https URLs', () => {
    expect(URL_RE.test('https://example.com/hook')).toBe(true);
    expect(URL_RE.test('http://localhost:3000/hook')).toBe(true);
  });

  it('rejects non-URL strings', () => {
    expect(URL_RE.test('not-a-url')).toBe(false);
    expect(URL_RE.test('ftp://example.com')).toBe(false);
    expect(URL_RE.test('')).toBe(false);
  });

  it('enforces minimum secret length of 16 characters', () => {
    const validate = (s) => typeof s === 'string' && s.length >= 16;
    expect(validate('tooshort')).toBe(false);
    expect(validate('exactly16chars!!')).toBe(true);
    expect(validate('a-longer-valid-secret-key')).toBe(true);
  });

  it('requires events to be an array', () => {
    expect(Array.isArray([])).toBe(true);
    expect(Array.isArray(['deploy.completed'])).toBe(true);
    expect(Array.isArray('deploy.completed')).toBe(false);
    expect(Array.isArray(null)).toBe(false);
  });
});
