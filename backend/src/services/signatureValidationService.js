import crypto from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import redisService from './redisService.js';

/**
 * Signing request schema:
 * {
 *   callerAddress: string  — Stellar G… public key of the signing wallet
 *   contractId:   string  — Soroban contract ID being called
 *   method:       string  — contract method name
 *   params:       any     — method arguments (JSON-serialisable, may be null/omitted)
 *   nonce:        string  — unique value per request (UUIT or random hex)
 *   expiry:       number  — Unix timestamp in milliseconds; request is invalid after this
 *   signature:    string  — base64-encoded ED25519 signature over SHA-256 of canonical message
 * }
 */

// Maximum window between request creation and expiry. Prevents clients from
// setting expiry years in the future, which would keep nonce keys in Redis
// indefinitely and allow unbounded replay-prevention storage growth.
const MAX_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Maximum length for free-form string fields to bound canonical-message size
// and prevent memory-exhaustion abuse during hashing.
const MAX_FIELD_LENGTH = 4096;

// Maximum size of the JSON-serialised params payload.
const MAX_PARAMS_LENGTH = 65536;

class SignatureValidationService {
  /**
   * Builds a deterministic string representation of the request fields.
   * Fields are serialised in lexicographic key order to prevent ambiguity.
   */
  _buildCanonicalMessage({
    callerAddress,
    contractId,
    expiry,
    method,
    nonce,
    params,
  }) {
    return JSON.stringify({
      callerAddress,
      contractId,
      expiry,
      method,
      nonce,
      params: JSON.stringify(params ?? null),
    });
  }

  /**
   * Validates the structure and types of a signing request before any crypto
   * or Redis work is performed. Returns an error reason string or null when
   * the request is well-formed.
   */
  _validateRequest({
    callerAddress,
    contractId,
    method,
    nonce,
    expiry,
    signature,
    params,
  }) {
    if (typeof callerAddress !== 'string' || callerAddress.length === 0) {
      return 'invalid_address';
    }
    if (callerAddress.length > MAX_FIELD_LENGTH) {
      return 'invalid_address';
    }
    if (typeof contractId !== 'string' || contractId.length === 0) {
      return 'invalid_contract_id';
    }
    if (contractId.length > MAX_FIELD_LENGTH) {
      return 'invalid_contract_id';
    }
    if (typeof method !== 'string' || method.length === 0) {
      return 'invalid_method';
    }
    if (method.length > MAX_FIELD_LENGTH) {
      return 'invalid_method';
    }
    if (typeof nonce !== 'string' || nonce.length === 0) {
      return 'invalid_nonce';
    }
    if (nonce.length > MAX_FIELD_LENGTH) {
      return 'invalid_nonce';
    }
    if (typeof expiry !== 'number' || !Number.isFinite(expiry)) {
      return 'invalid_expiry';
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      return 'invalid_signature';
    }
    if (signature.length > MAX_FIELD_LENGTH) {
      return 'invalid_signature';
    }
    if (params !== undefined && params !== null) {
      let serialised;
      try {
        serialised = JSON.stringify(params);
      } catch {
        return 'invalid_params';
      }
      if (typeof serialised !== 'string') {
        return 'invalid_params';
      }
      if (serialised.length > MAX_PARAMS_LENGTH) {
        return 'invalid_params';
      }
    }
    return null;
  }

  /**
   * Verifies a Stellar ED25519 signature over a canonical request message.
   *
   * Returns { valid: true } on success.
   * Returns { valid: false, reason: 'expired' | 'bad_signature' | 'replay' } on failure.
   *
   * The expiry check and hash computation happen before the signature check so
   * that cheap operations gate the more expensive ED25519 verify call.
   */
  async verify({
    callerAddress,
    contractId,
    method,
    params,
    nonce,
    expiry,
    signature,
  }) {
    // 0. Reject malformed requests before any crypto or Redis work.
    const validationError = this._validateRequest({
      callerAddress,
      contractId,
      method,
      nonce,
      expiry,
      signature,
      params,
    });
    if (validationError) {
      return { valid: false, reason: validationError };
    }

    // 1. Reject stale requests immediately (no crypto work needed).
    //    Also reject requests whose expiry window exceeds the maximum to prevent
    //    clients from keeping nonce keys in Redis for an unbounded duration.
    const now = Date.now();
    if (expiry < now || expiry - now > MAX_EXPIRY_WINDOW_MS) {
      return { valid: false, reason: 'expired' };
    }

    // 2. Hash the canonical message (fast, pre-screens replay before touching Redis)
    const msgHash = crypto
      .createHash('sha256')
      .update(
        this._buildCanonicalMessage({
          callerAddress,
          contractId,
          expiry,
          method,
          nonce,
          params,
        })
      )
      .digest();

    // 3. Verify ED25519 signature using the Stellar public key
    try {
      const keypair = Keypair.fromPublicKey(callerAddress);
      const sigBuffer = Buffer.from(signature, 'base64');
      const valid = keypair.verify(msgHash, sigBuffer);
      if (!valid) {
        return { valid: false, reason: 'bad_signature' };
      }
    } catch {
      return { valid: false, reason: 'bad_signature' };
    }

    // 4. Atomically claim the nonce (set-if-not-exists) to prevent replay attacks.
    //    TTL is capped at MAX_EXPIRY_WINDOW_MS as a second line of defence so that
    //    even if the window check above is relaxed, Redis keys never live longer than
    //    24 hours.
    const nonceKey = `sig:nonce:${callerAddress}:${nonce}`;
    const remainingMs = expiry - Date.now();
    const ttlSeconds = Math.min(
      Math.ceil(MAX_EXPIRY_WINDOW_MS / 1000),
      Math.max(1, Math.ceil(remainingMs / 1000))
    );
    const stored = await redisService.setNX(nonceKey, '1', ttlSeconds);
    if (!stored) {
      return { valid: false, reason: 'replay' };
    }

    return { valid: true };
  }
}

const signatureValidationService = new SignatureValidationService();
export default signatureValidationService;
