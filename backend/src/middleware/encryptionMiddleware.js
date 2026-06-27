// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { aesDecrypt, verifySignature, sha256Hex, generateRsaKeyPair, generateSessionKey, aesEncrypt } from '../utils/cryptoUtils.js';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5-minute replay window

// In-memory nonce store — production deployments should use Redis for multi-instance safety.
const usedNonces = new Map();

function pruneNonces() {
  const cutoff = Date.now() - REPLAY_WINDOW_MS;
  for (const [nonce, ts] of usedNonces) {
    if (ts < cutoff) usedNonces.delete(nonce);
  }
}

function isReplay(nonce, timestamp) {
  pruneNonces();
  if (usedNonces.has(nonce)) return true;
  const ts = Date.parse(timestamp);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) return true;
  usedNonces.set(nonce, Date.now());
  return false;
}

/**
 * Middleware factory for decrypting encrypted request payloads.
 *
 * Clients must send:
 *   X-Encrypted: true
 *   X-Session-Key: base64(AES-key) — encrypted with server public key (or raw base64 in dev)
 *   X-Request-Timestamp: ISO 8601 timestamp
 *   X-Request-Nonce: unique random string per request
 *   X-Request-Signature: base64 RSA-SHA256 signature
 *
 * Body must be JSON: { iv, ciphertext, tag }
 *
 * @param {object} options
 * @param {string} options.privateKeyPem - Server RSA private key (PEM)
 * @param {string} options.publicKeyPem  - Server RSA public key (PEM) for signature verification
 * @param {boolean} [options.enforceEncryption=true] - Reject unencrypted requests
 */
export function createEncryptionMiddleware(options = {}) {
  const { privateKeyPem, publicKeyPem, enforceEncryption = true } = options;

  return async (req, res, next) => {
    const encryptedHeader = req.headers['x-encrypted'];

    if (!encryptedHeader || encryptedHeader !== 'true') {
      if (enforceEncryption) {
        return res.status(400).json({
          error: 'Encryption Required',
          message: 'This endpoint requires an encrypted payload. Set X-Encrypted: true and encrypt the request body.',
        });
      }
      return next();
    }

    const sessionKeyHeader = req.headers['x-session-key'];
    const timestamp = req.headers['x-request-timestamp'];
    const nonce = req.headers['x-request-nonce'];
    const signature = req.headers['x-request-signature'];

    if (!sessionKeyHeader || !timestamp || !nonce || !signature) {
      return res.status(400).json({
        error: 'Missing Encryption Headers',
        message: 'Required headers: X-Session-Key, X-Request-Timestamp, X-Request-Nonce, X-Request-Signature',
      });
    }

    if (isReplay(nonce, timestamp)) {
      return res.status(400).json({
        error: 'Replay Attack Detected',
        message: 'Request nonce or timestamp is invalid or expired.',
      });
    }

    try {
      const sessionKey = Buffer.from(sessionKeyHeader, 'base64');
      const bodyJson = JSON.stringify(req.body);
      const bodyHash = sha256Hex(bodyJson);

      if (publicKeyPem) {
        const valid = verifySignature(publicKeyPem, req.method, req.path, timestamp, bodyHash, signature);
        if (!valid) {
          return res.status(401).json({
            error: 'Invalid Signature',
            message: 'Request signature verification failed.',
          });
        }
      }

      const { iv, ciphertext, tag } = req.body;
      if (!iv || !ciphertext || !tag) {
        return res.status(400).json({
          error: 'Invalid Encrypted Payload',
          message: 'Encrypted body must include iv, ciphertext, and tag fields.',
        });
      }

      const decrypted = aesDecrypt({ iv, ciphertext, tag }, sessionKey);
      req.body = JSON.parse(decrypted.toString('utf8'));
      req.isEncrypted = true;

      next();
    } catch (err) {
      console.error('[Encryption] Decryption failed:', err.message);
      return res.status(400).json({
        error: 'Decryption Failed',
        message: 'Could not decrypt request payload.',
      });
    }
  };
}

/**
 * Utility: encrypt a server response payload for end-to-end encryption.
 * Returns { iv, ciphertext, tag } that the client decrypts with the session key.
 *
 * @param {object|string} data
 * @param {Buffer} sessionKey
 */
export function encryptResponse(data, sessionKey) {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  return aesEncrypt(plaintext, sessionKey);
}

/**
 * Generate a fresh server RSA key pair (for bootstrapping / key rotation).
 */
export function generateServerKeyPair() {
  return generateRsaKeyPair();
}

export { generateSessionKey };
