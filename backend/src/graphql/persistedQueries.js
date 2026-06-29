import crypto from 'crypto';
import express from 'express';
import { parse } from 'graphql';
import redisService from '../services/redisService.js';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
const KEY_PREFIX = 'graphql:persisted-query';

function getTtlSeconds() {
  const configured = Number(process.env.PERSISTED_QUERY_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_SECONDS;
}

export function hashQuery(query) {
  return crypto.createHash('sha256').update(query).digest('hex');
}

function normalizeHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function getPersistedQueryHash(body = {}) {
  const extensionHash = body.extensions?.persistedQuery?.sha256Hash;
  return normalizeHash(body.sha256Hash ?? body.hash ?? extensionHash);
}

function getPersistedQueryKey(hash) {
  return `${KEY_PREFIX}:${hash}`;
}

export function signPersistedQuery(
  query,
  secret = process.env.PERSISTED_QUERY_SECRET
) {
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

function validateRegistrationSignature(query, signature) {
  if (!process.env.PERSISTED_QUERY_SECRET) return true;
  if (!signature) return false;

  const expected = signPersistedQuery(query);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function validateQueryDocument(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query must be a non-empty GraphQL document');
  }
  parse(query);
}

export async function storePersistedQuery(query, requestedHash) {
  validateQueryDocument(query);

  const computedHash = hashQuery(query);
  const hash = requestedHash ? normalizeHash(requestedHash) : computedHash;
  if (!hash) {
    const error = new Error('hash must be a valid SHA-256 hex digest');
    error.status = 400;
    throw error;
  }
  if (hash !== computedHash) {
    const error = new Error('hash does not match query SHA-256 digest');
    error.status = 409;
    throw error;
  }

  await redisService.set(getPersistedQueryKey(hash), query, getTtlSeconds());
  return { hash };
}

export async function loadPersistedQuery(hash) {
  const normalized = normalizeHash(hash);
  if (!normalized) return null;
  return redisService.get(getPersistedQueryKey(normalized));
}

export function createPersistedQueryMiddleware() {
  return async function persistedQueryMiddleware(req, res, next) {
    if (req.method !== 'POST') return next();

    const hash = getPersistedQueryHash(req.body);
    if (!hash) return next();

    if (req.body?.query) {
      return next();
    }

    try {
      const query = await loadPersistedQuery(hash);
      if (!query) {
        return res.status(200).json({
          errors: [
            {
              message: 'PersistedQueryNotFound',
              extensions: { code: 'PERSISTED_QUERY_NOT_FOUND', hash },
            },
          ],
        });
      }

      req.body = { ...req.body, query };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function createPersistedQueryRouter() {
  const router = express.Router();

  router.post('/persisted-queries', async (req, res, next) => {
    try {
      const { query, hash, signature } = req.body ?? {};
      if (!validateRegistrationSignature(query, signature)) {
        return res.status(401).json({
          success: false,
          error: 'invalid persisted query signature',
        });
      }

      const registration = await storePersistedQuery(query, hash);
      return res.status(201).json({ success: true, ...registration });
    } catch (error) {
      return res.status(error.status ?? 400).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}
