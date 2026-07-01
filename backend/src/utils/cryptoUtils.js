// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'crypto';

const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AES_KEY_LENGTH = 32; // 256-bit key
const AES_TAG_LENGTH = 16;

/**
 * Generate a random 256-bit AES session key.
 * @returns {Buffer}
 */
export function generateSessionKey() {
  return randomBytes(AES_KEY_LENGTH);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {Buffer|string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {{ iv: string, ciphertext: string, tag: string }} base64-encoded components
 */
export function aesEncrypt(plaintext, key) {
  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AES_TAG_LENGTH,
  });
  const data = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext, 'utf8');
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * @param {{ iv: string, ciphertext: string, tag: string }} payload - base64-encoded components
 * @param {Buffer} key
 * @returns {Buffer}
 */
export function aesDecrypt({ iv, ciphertext, tag }, key) {
  const decipher = createDecipheriv(
    AES_ALGORITHM,
    key,
    Buffer.from(iv, 'base64'),
    { authTagLength: AES_TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted;
}

/**
 * Generate an RSA-2048 key pair for session key exchange.
 * @returns {{ publicKey: string, privateKey: string }} PEM-encoded
 */
export function generateRsaKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/**
 * Create an HMAC-SHA256 request signature to prevent replay attacks.
 * Signs: `${method}:${path}:${timestamp}:${bodyHash}`
 *
 * @param {string} privateKeyPem
 * @param {string} method
 * @param {string} path
 * @param {string} timestamp  ISO 8601
 * @param {string} bodyHash   sha256 hex of encrypted body
 * @returns {string} base64 signature
 */
export function signRequest(privateKeyPem, method, path, timestamp, bodyHash) {
  const payload = `${method}:${path}:${timestamp}:${bodyHash}`;
  const signer = createSign('SHA256');
  signer.update(payload);
  return signer.sign(privateKeyPem, 'base64');
}

/**
 * Verify a request signature.
 * @returns {boolean}
 */
export function verifySignature(
  publicKeyPem,
  method,
  path,
  timestamp,
  bodyHash,
  signature
) {
  try {
    const payload = `${method}:${path}:${timestamp}:${bodyHash}`;
    const verifier = createVerify('SHA256');
    verifier.update(payload);
    return verifier.verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;
  }
}

import { createHash } from 'crypto';

/**
 * Hash a buffer or string with SHA-256, returning hex.
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
