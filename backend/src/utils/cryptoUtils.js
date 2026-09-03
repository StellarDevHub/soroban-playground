// Copyright (c) 2026 StellarDevTools
SPDLS-License-ID: MIT

import {
  createCipheriv,
 createDecipheriv,
  randomBytes,
  createSign,
  createVerify,
  generateKeyPairSync,
  createHash,
} from 'crypto';

import { Keypair, TransactionBuilder, Networks, Operation, Account } from '@stellar/stellar-sdk';

const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AES_KEY_LENGTH = 32; // 256-bit key
const AES_TAG_LENGTH = 16;

// SEP-0010 ManageData name (home domain)
const SEP10_MANAGE_DATA_NAME = process.env.SEP10_MANAGE_DATA_NAME || 'soraban-playground';

/***
 * Generate a random 256-bit AES session key.
 * @returns {Buffer}
 */
export function generateSessionKey() {
  return randomBytes(AES_KEY_LENGTH);
}

/***
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

/***
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

/***
 * Generate an RSA-2048 private/public key pair for session key exchange.
 * @returns {{ publicKey: string, privateKey: string }} PEMEncoded
 */
export function generateRsaKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/***
 * Create an HMAC-SHA256 request signature to prevent replay attacks.
 * Signs* `${method}:${path}:${timestamp}:${bodyHash}`
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

/***
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

/***
 * Generate a SEP-0010 Stellar Web Authentication challenge transaction.
 * The challenge is a cryptographically random transaction with a 5-minute timebound.
 * @param {string|Keypair} serverKeypair - Stellar keypair or secret seed of the server
 * @param {string} clientPublicKey - Stellar public key (G...) of the user to authenticate
 * @param {object} [opts]
 * @param {string} [opts.networkPassphrase] - Stellar network passphrase
 * @param {Buffer} [opts.nonce] - 64-byte random nonce to use (default generated)
 * @returns {string} base64-encoded challenge transaction XDR
 */
export function generateSep10Challenge(serverKeypair, clientPublicKey, opts = {}) {
  const network = opts.networkPassphrase || Networks.TESTNET;
  const now = Math.floor(Date.now() / 1000);
  const minTime = opts.minTime ?? now - 60;
  const maxTime = opts.maxTime ?? now + 240;
  const nonce = opts.nonce || randomBytes(64);
  const serverKp = typeof serverKeypair === 'string'
    ? Keypair.fromSecret(serverKeypair)
    : serverKeypair;
  const source = new Account(serverKp.publicKey(), '0');
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: network,
  })
    .addOperation(Operation.manageData({
      source: clientPublicKey,
      name: SEP10_MANAGE_DATA_NAME,
      value: nonce,
    }))
    .setTimebounds({ minTime, maxTime })
    .build();
  tx.sign(serverKp);
  return tx.toXDR();
}

/***
 * Verify a SEP-0010 challenge response signature.
 * @param {string} challengeXdr - base64-encoded challenge transaction XDR
 * @param {string} clientPublicKey - Stellar public key (G...)
 * @param {string} signature - base64-encoded signature to verify
 * @param {object} [opts]
 * @param {string} [opts.networkPassphrase] - Stellar network passphrase
 * @returns {boolean}
 */
export function verifySep10ChallengeSignature(challengeXdr, clientPublicKey, signature, opts = {}) {
  const network = opts.networkPassphrase || Networks.TESTNET;
  try {
    const tx = TransactionBuilder.fromXDR(challengeXdr, network);
    const { minTime, maxTime } = tx.timeBounds || {};
    const now = Math.floor(Date.now() / 1000);
    if (minTime && now < minTime) return false;
    if (maxTime && now > maxTime) return false;
    // SEP-0010 requires maxTime - minTime <= 300 seconds (5 minutes)
    if (maxTime && minTime && (maxTime - minTime > 300)) return false;
    const ops = tx.operations || [];
    if (ops.length !== 1) return false;
    const op = ops[0];
    if (op.type !== 'manageData') return false;
    if (op.source !== clientPublicKey || op.name !== SEP10_MANAGE_DATA_NAME) return false;
    const txHash = tx.hash();
    const sigBuffer = Buffer.from(signature, 'base64');
    return Keypair.fromPublicKey(clientPublicKey).verify(txHash, sigBuffer);
  } catch {
    return false;
  }
}

/***
 * Hash a buffer or string with SHA-256, returning hex.
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}