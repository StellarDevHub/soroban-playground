// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Challenge / JWT auth middleware (#1576)
 *
 * Implements SEP-0010-style challenge-response authentication backed by
 * Redis nonce tracking for replay resistance, then issues signed JWTs.
 *
 * Exported middleware:
 *   requireChallengeAuth  – full SEP-0010 flow (challenge + verify)
 *   issueJwt              – signs & returns JWT after a verified challenge
 *   verifyJwtMiddleware   – validates Bearer JWT on protected routes
 *   requireNonce          – light-weight nonce-only guard (no Stellar SDK)
 */

import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import redisService from '../services/redisService.js';
import jwtRevocationService from '../services/jwtRevocationService.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.JWT_SECRETS ||
  'soroban-playground-secret-key-2026';
const JWT_ISSUER = process.env.JWT_ISSUER || 'soroban-playground';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'soroban-playground-api';
const ACCESS_TOKEN_TTL_S =
  Number.parseInt(process.env.JWT_ACCESS_TOKEN_TTL_MS || '900000', 10) / 1000;
const NONCE_TTL_S =
  Number.parseInt(process.env.SEP10_CHALLENGE_TTL_MS || '300000', 10) / 1000;

// Redis key prefixes
const NONCE_KEY_PREFIX = 'nonce:pending:';
const NONCE_USED_PREFIX = 'nonce:used:';
const TOKEN_BLACKLIST_PREFIX = 'bl_access:';

// ─── Nonce generation & validation ───────────────────────────────────────────

/**
 * Generate a cryptographically-random nonce and persist it in Redis so
 * it can only be redeemed once within the TTL window.
 *
 * @param {string} publicKey  – Stellar G-address the nonce is bound to
 * @returns {Promise<string>} – The nonce value (base64url, 32 bytes)
 */
export async function generateNonce(publicKey) {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error('publicKey is required to generate a nonce');
  }
  const nonce = randomBytes(32).toString('base64url');
  const key = `${NONCE_KEY_PREFIX}${nonce}`;
  // Store the bound public key so we can verify the redemption address
  await redisService.set(key, publicKey, NONCE_TTL_S);
  return nonce;
}

/**
 * Consume a nonce from Redis – asserts:
 *  1. The nonce exists (not expired, not already used)
 *  2. The nonce was issued for `publicKey`
 *
 * Atomically marks the nonce as used so it cannot be replayed.
 *
 * @param {string} nonce     – Nonce value from the challenge
 * @param {string} publicKey – Stellar G-address claiming the nonce
 * @throws {Error}           – Descriptive error on any validation failure
 */
export async function consumeNonce(nonce, publicKey) {
  if (!nonce || !publicKey) {
    throw new Error('nonce and publicKey are required');
  }

  const pendingKey = `${NONCE_KEY_PREFIX}${nonce}`;
  const usedKey = `${NONCE_USED_PREFIX}${nonce}`;

  // Replay guard – fail immediately if the nonce was already consumed
  const alreadyUsed = await redisService.get(usedKey);
  if (alreadyUsed) {
    throw new Error('Nonce has already been used (replay attack detected)');
  }

  // Existence guard – nonce must still be in the pending store
  const storedKey = await redisService.get(pendingKey);
  if (!storedKey) {
    throw new Error('Nonce not found or expired');
  }

  // Binding guard – nonce must be bound to the claiming address
  if (storedKey !== publicKey) {
    throw new Error('Nonce was issued for a different public key');
  }

  // Atomically transition: delete pending entry, write used tombstone
  await redisService.del(pendingKey);
  // Keep the used tombstone for the remaining TTL to block replay attempts
  await redisService.set(usedKey, '1', NONCE_TTL_S);
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────

/**
 * Sign and return a short-lived access JWT for a verified Stellar address.
 *
 * @param {object} payload – Additional JWT claims (sub is required)
 * @returns {string}       – Signed JWT
 */
export function signAccessToken(payload) {
  const { sub, role = 'user', permissions = [], ...rest } = payload;
  if (!sub) throw new Error('sub claim is required for JWT signing');

  const jti = uuidv4();
  return jwt.sign(
    {
      sub,
      jti,
      role,
      permissions,
      type: 'access',
      tokenVersion: payload.tokenVersion ?? payload.token_version ?? 0,
      ...rest,
    },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_S,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

/**
 * Verify a JWT and return the decoded payload. Throws on invalid / expired / revoked.
 */
export async function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch (err) {
    throw new Error(`Invalid or expired token: ${err.message}`);
  }

  if (payload.type !== 'access') {
    throw new Error('Token type is not an access token');
  }

  // Revocation check (logout / key-rotation revocation) with Bloom filter fast path.
  if (payload.jti) {
    const revoked =
      (await jwtRevocationService.isJtiRevoked(payload.jti)) ||
      (await redisService.get(`${TOKEN_BLACKLIST_PREFIX}${payload.jti}`));
    if (revoked) throw new Error('Token has been revoked');
  }

  await jwtRevocationService.assertTokenEpochValid(payload);
  return payload;
}

/**
 * Revoke an access token by writing its jti to the blacklist.
 */
export async function revokeAccessToken(jti, exp) {
  if (!jti) return;
  const now = Math.floor(Date.now() / 1000);
  const expSeconds = exp || now + ACCESS_TOKEN_TTL_S;
  const ttl = Math.max(1, Math.floor(expSeconds - now));
  await jwtRevocationService.revokeJti(jti, expSeconds);
  await redisService.set(`${TOKEN_BLACKLIST_PREFIX}${jti}`, '1', ttl);
}

// ─── Express Middleware ───────────────────────────────────────────────────────

/**
 * Express middleware: verify Bearer JWT on every request.
 * Populates req.user = { sub, jti, role, permissions, exp }.
 * Responds 401 for missing/invalid/revoked tokens.
 */
export async function verifyJwtMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const cookieToken = req.cookies?.accessToken;
  let token = null;

  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }

  try {
    const payload = await verifyAccessToken(token);
    req.user = {
      publicKey: payload.sub,
      sub: payload.sub,
      jti: payload.jti,
      role: payload.role || 'user',
      permissions: payload.permissions || [],
      exp: payload.exp,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: `Unauthorized: ${err.message}` });
  }
}

/**
 * Express middleware: POST handler that expects { publicKey, nonce, signature }
 * (or a pre-verified flag set by the challenge-verify route), consumes the
 * nonce, and issues a JWT in the response.
 *
 * This middleware assumes the upstream challenge/verify step already validated
 * the Stellar signature (see authService.verifyStellarChallengeAndIssueTokens).
 * It is designed to be chained AFTER that verification step.
 *
 * Usage:
 *   router.post('/verify', verifyChallengeStep, issueJwt);
 */
export async function issueJwt(req, res, next) {
  try {
    const { publicKey, nonce } = req.body || {};

    if (!publicKey || !nonce) {
      return res
        .status(400)
        .json({ error: 'publicKey and nonce are required' });
    }

    // Consume the nonce – this throws on replay or mismatch
    await consumeNonce(nonce, publicKey);

    const token = signAccessToken({
      sub: publicKey,
      role: req.body.role || 'user',
      permissions: req.body.permissions || [],
    });

    return res.status(200).json({
      success: true,
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_S,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Express middleware: guard that requires a valid request-scoped nonce header.
 * Intended for sensitive write endpoints that should be CSRF + replay resistant
 * even before full Stellar signature verification.
 *
 * Header: X-Request-Nonce: <nonce>
 * The nonce must have been previously issued via GET /api/auth/nonce?address=<G...>
 */
export async function requireNonce(req, res, next) {
  const nonce = req.headers['x-request-nonce'];
  const publicKey =
    req.body?.address || req.body?.publicKey || req.query?.address;

  if (!nonce) {
    return res
      .status(400)
      .json({ error: 'X-Request-Nonce header is required' });
  }
  if (!publicKey) {
    return res.status(400).json({ error: 'address / publicKey is required' });
  }

  try {
    await consumeNonce(nonce, publicKey);
    req.nonceVerified = true;
    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: `Nonce validation failed: ${err.message}` });
  }
}

/**
 * Full challenge-auth middleware stack.
 * Verifies a JWT Bearer token.  Use this on any route that should only
 * be accessible by authenticated Stellar wallet holders.
 */
export const requireChallengeAuth = verifyJwtMiddleware;
