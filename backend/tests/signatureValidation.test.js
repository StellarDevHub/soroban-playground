import { jest } from '@jest/globals';
import crypto from 'crypto';

// Mock redisService before importing the service under test.
// Use jest.fn() inline (not a variable) to avoid TDZ issues with jest.mock() hoisting.
jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    setNX: jest.fn(),
    delete: jest.fn(),
  },
}));

import { Keypair } from '@stellar/stellar-sdk';
import redisService from '../src/services/redisService.js';
import signatureValidationService from '../src/services/signatureValidationService.js';
import { validateStellarSignature } from '../src/middleware/validateStellarSignature.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

let keypair;
let publicKey;

function buildPayload(overrides = {}) {
  const base = {
    callerAddress: publicKey,
    contractId: 'CABC123',
    method: 'transfer',
    params: { amount: 100 },
    nonce: 'unique-nonce-001',
    expiry: Date.now() + 60_000,
  };
  return { ...base, ...overrides };
}

function signPayload(payload, kp = keypair) {
  const canonical = JSON.stringify({
    callerAddress: payload.callerAddress,
    contractId: payload.contractId,
    expiry: payload.expiry,
    method: payload.method,
    nonce: payload.nonce,
    params: JSON.stringify(payload.params ?? null),
  });
  const msgHash = crypto.createHash('sha256').update(canonical).digest();
  return Buffer.from(kp.sign(msgHash)).toString('base64');
}

beforeAll(() => {
  keypair = Keypair.random();
  publicKey = keypair.publicKey();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: setNX succeeds (nonce not yet seen)
  redisService.setNX.mockResolvedValue('OK');
});

// ──────────────────────────────────────────────────────────────────────────────
// SignatureValidationService
// ──────────────────────────────────────────────────────────────────────────────

describe('signatureValidationService.verify()', () => {
  it('returns { valid: true } for a correctly signed request', async () => {
    const payload = buildPayload();
    const signature = signPayload(payload);
    const result = await signatureValidationService.verify({
      ...payload,
      signature,
    });
    expect(result).toEqual({ valid: true });
  });

  it('returns { valid: false, reason: "expired" } when expiry is in the past', async () => {
    const payload = buildPayload({ expiry: Date.now() - 1000 });
    const signature = signPayload(payload);
    const result = await signatureValidationService.verify({
      ...payload,
      signature,
    });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('returns { valid: false, reason: "expired" } when expiry window exceeds 24 hours', async () => {
    // Prevents clients from keeping nonce keys in Redis indefinitely
    const payload = buildPayload({ expiry: Date.now() + 25 * 60 * 60 * 1000 });
    const signature = signPayload(payload);
    const result = await signatureValidationService.verify({
      ...payload,
      signature,
    });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('returns { valid: false, reason: "replay" } when nonce has been used', async () => {
    redisService.setNX.mockResolvedValue(null); // NX condition not met → key already exists
    const payload = buildPayload();
    const signature = signPayload(payload);
    const result = await signatureValidationService.verify({
      ...payload,
      signature,
    });
    expect(result).toEqual({ valid: false, reason: 'replay' });
  });

  it('returns { valid: false, reason: "bad_signature" } for a tampered payload', async () => {
    const payload = buildPayload();
    const signature = signPayload(payload);
    // Tamper: change the method after signing
    const result = await signatureValidationService.verify({
      ...payload,
      method: 'withdraw', // different from what was signed
      signature,
    });
    expect(result).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('returns { valid: false, reason: "bad_signature" } for an invalid public key', async () => {
    const payload = buildPayload({ callerAddress: 'INVALID_PUBLIC_KEY' });
    const result = await signatureValidationService.verify({
      ...payload,
      signature: 'invalidsig',
    });
    expect(result).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('stores nonce in Redis after successful verification', async () => {
    const payload = buildPayload();
    const signature = signPayload(payload);
    await signatureValidationService.verify({ ...payload, signature });
    expect(redisService.setNX).toHaveBeenCalledWith(
      expect.stringContaining(`sig:nonce:${publicKey}:`),
      '1',
      expect.any(Number)
    );
  });

  it('does not store nonce when signature is invalid', async () => {
    const payload = buildPayload();
    await signatureValidationService.verify({
      ...payload,
      signature: 'badsig==',
    });
    expect(redisService.setNX).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// validateStellarSignature middleware
// ──────────────────────────────────────────────────────────────────────────────

describe('validateStellarSignature middleware', () => {
  function makeReqRes(body) {
    return {
      req: { body },
      res: {},
      next: jest.fn(),
    };
  }

  it('calls next() with no error and attaches req.signerAddress on valid signature', async () => {
    const payload = buildPayload();
    const signature = signPayload(payload);
    const { req, res, next } = makeReqRes({ ...payload, signature });

    validateStellarSignature(req, res, next);
    // Wait for the async verify to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(next).toHaveBeenCalledWith(); // no argument = success
    expect(req.signerAddress).toBe(publicKey);
  });

  it('calls next(HttpError 400) when required fields are missing', () => {
    const { req, res, next } = makeReqRes({ callerAddress: publicKey });
    validateStellarSignature(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it('calls next(HttpError 401) when signature is invalid', async () => {
    const payload = buildPayload();
    const { req, res, next } = makeReqRes({
      ...payload,
      signature: 'badsig==',
    });

    validateStellarSignature(req, res, next);
    await new Promise((r) => setTimeout(r, 50));

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 })
    );
  });
});
