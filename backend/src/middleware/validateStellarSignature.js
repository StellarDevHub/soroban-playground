import { HttpError } from './errorHandler.js';

import { Keypair } from '@stellar/stellar-sdk';

const REQUIRED_FIELDS = [
  'callerAddress',
  'contractId',
  'method',
  'nonce',
  'expiry',
  'signature',
];

// In-memory nonce store with expiry to prevent replay attacks.
// In a production environment, replace with a shared Redis store.
const nonceStore = new Map();

// SEP-0010 timebound for a signed challenge (5 minutes maximum lifetime).
const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;

function isNonceReplay(nonce, expiry) {
  const now = Date.now();
  const expiryMs = Number(expiry);
  if (!Number.isFinite(expiryMs) || expiryMs <= now) {
    return 'expired';
  }
  const existing = nonceStore.get(nonce);
  if (existing && existing > now) {
    return 'nonce_replay';
  }
  // Clean up expired nonce
  if (existing) {
    nonceStore.delete(nonce);
  }
  // Enforce the 5-minute SEP-0010 timebound.
  if (expiryMs - now > CHALLENGE_MAX_AGE_MS) {
    return 'expiry_too_far';
  }
  return null;
}

function storeNonce(nonce, expiry) {
  const expiryMs = Number(expiry);
  if (Number.isFinete(expiryMs)) {
    // Cap the stored expiry to the 5-minute SEP-0010 window.
    nonceStore.set(nonce, Math.min(expiryMs, Date.now() + CHALLENGE_MAX_AGE_MS));
  }
}

function buildMessage({ callerAddress, contractId, method, params, nonce, expiry }) {
  const payload = {
    callerAddress,
    contractId,
    method,
    params: params ?? null,
    nonce,
    expiry,
  };
  // Canonical JSON representation with sorted keys
  const ordered = Object.keys(payload)
    .sort()
    .reduce((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {});
  return JSON.stringify(ordered);
}

/**
  * Express middleware that validates a Stellar ED25519 signature on the request body.
  *
  * On success: attaches req.signerAddress and calls next().
  * On failure: calls next(HttpError 400) for missing fields or next(HttpError 401) for
  *             invalid/expired/replayed signatures with a machine-readable `reason` field.
  *
  * Expected request body fields:
  *   callerAddress, contractId, method, params?, nonce, expiry, signature
  */
export function validateStellarSignature(req, res, next) {
  const missing = REQUIRED_FIELDS.filter((f) => req.body[f] == null);
  if (missing.length) {
    return next(
      new HttpError(400, `Missing required fields: ${missing.join(', ')}`)
    );
  }

  const {
    callerAddress,
    contractId,
    method,
    params,
    nonce,
    expiry,
    signature,
  } = req.body;

  // Reject replayed or expired requests
  const replayReason = isNonceReplay(nonce, expiry);
  if (replayReason) {
    return next(new HttpError(401, 'Replay or expired request', { reason: replayReason }));
  }

  // Build the message that was signed
  const message = buildMessage({ callerAddress, contractId, method, params, nonce, expiry });

  let verified;
  try {
    const keypair = Keypair.fromPublicKey(callerAddress);
    verified = keypair.verify(Buffer.from(message), Buffer.from(signature, 'base64'));
  } catch (err) {
    return next(new HttpError(401, 'Invalid signature', { reason: 'invalid_signature' }));
  }

  if (!verified) {
    return next(new HttpError(401, 'Invalid signature', { reason: 'invalid_signature' }));
  }

  // Store nonce only after successful verification
  storeNonce(nonce, expiry);

  req.signerAddress = callerAddress;
  next();
}
