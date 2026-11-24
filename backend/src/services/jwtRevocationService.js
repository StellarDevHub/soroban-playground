import redisService from './redisService.js';
import { getDatabase } from '../database/connection.js';

const REVOKED_JTI_BLOOM_KEY = 'auth:revoked_jti_bf';
const REVOKED_JTI_KEY_PREFIX = 'revoked:jti:';
const LEGACY_ACCESS_BLACKLIST_PREFIXES = ['bl_access:', 'blacklist:'];

let bloomInitPromise = null;
let bloomAvailable = false;

function revokedJtiKey(jti) {
  return `${REVOKED_JTI_KEY_PREFIX}${jti}`;
}

function ttlFromExp(expOrTtlSeconds) {
  const value = Number(expOrTtlSeconds);
  if (!Number.isFinite(value)) return 0;

  // Accept either absolute epoch seconds or a relative TTL in seconds.
  if (value > 1_000_000_000) {
    return Math.max(0, Math.floor(value - Date.now() / 1000));
  }
  return Math.max(0, Math.floor(value));
}

class JwtRevocationService {
  async ensureBloomFilter() {
    if (bloomAvailable) return true;
    if (bloomInitPromise) return bloomInitPromise;
    bloomInitPromise = (async () => {
      if (!redisService.client || redisService.isFallbackMode) return false;
      try {
        await redisService.executeWithCircuitBreaker(() =>
          redisService.client.call(
            'BF.RESERVE',
            REVOKED_JTI_BLOOM_KEY,
            '0.01',
            '100000',
            'NONSCALING'
          )
        );
        bloomAvailable = true;
        return true;
      } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('item exists') || msg.includes('already exists')) {
          bloomAvailable = true;
          return true;
        }
        bloomAvailable = false;
        return false;
      } finally {
        bloomInitPromise = null;
      }
    })();
    return bloomInitPromise;
  }

  async revokeJti(jti, expSeconds) {
    if (!jti) return false;
    const ttl = ttlFromExp(expSeconds);
    if (ttl <= 0) return false;

    const key = revokedJtiKey(jti);
    try {
      await redisService.set(key, '1', ttl);
    } catch {
      // best effort; bloom/key fallback handled by redisService internals
    }

    if (redisService.client && !redisService.isFallbackMode) {
      try {
        await this.ensureBloomFilter();
        await redisService.executeWithCircuitBreaker(() =>
          redisService.client.call('BF.ADD', REVOKED_JTI_BLOOM_KEY, jti)
        );
      } catch {
        // Bloom filter unavailable; key-based revocation still enforced.
      }
    }
    return true;
  }

  async isJtiRevoked(jti) {
    if (!jti) return false;

    // Backward-compatible checks for legacy blacklist keys.
    for (const prefix of LEGACY_ACCESS_BLACKLIST_PREFIXES) {
      try {
        const legacy = await redisService.get(`${prefix}${jti}`);
        if (legacy) return true;
      } catch {
        // ignore and continue checks
      }
    }

    if (redisService.client && !redisService.isFallbackMode) {
      try {
        await this.ensureBloomFilter();
        const exists = await redisService.executeWithCircuitBreaker(() =>
          redisService.client.call('BF.EXISTS', REVOKED_JTI_BLOOM_KEY, jti)
        );
        if (Number(exists) === 0) {
          // Fast path: Bloom filter guarantees token is not revoked.
          return false;
        }
      } catch {
        // Fall through to authoritative key lookup.
      }
    }

    try {
      const revoked = await redisService.get(revokedJtiKey(jti));
      return Boolean(revoked);
    } catch {
      return false;
    }
  }

  async getUserTokenVersion(userId) {
    if (userId == null || userId === '') return null;
    try {
      const db = getDatabase();
      if (!db) return null;
      let row = null;
      if (typeof db.get === 'function') {
        row = await db.get('SELECT token_version FROM users WHERE id = ?', [
          userId,
        ]);
      } else if (typeof db === 'function') {
        // Knex-style instance fallback.
        row = await db('users').select('token_version').where({ id: userId }).first();
      }
      if (!row || row.token_version == null) return null;
      const version = Number(row.token_version);
      return Number.isFinite(version) ? version : null;
    } catch {
      return null;
    }
  }

  async assertTokenEpochValid(payload) {
    if (!payload || payload.sub == null) return;

    // DB verification for user password version / revocation epochs.
    const currentVersion = await this.getUserTokenVersion(payload.sub);
    if (currentVersion == null) return;

    const tokenVersion = Number(
      payload.tokenVersion ?? payload.tv ?? payload.revocationEpoch ?? 0
    );
    if (!Number.isFinite(tokenVersion) || tokenVersion !== currentVersion) {
      const error = new Error('Token revoked due to credential rotation');
      error.status = 401;
      throw error;
    }
  }
}

const jwtRevocationService = new JwtRevocationService();
export default jwtRevocationService;
export { REVOKED_JTI_BLOOM_KEY, revokedJtiKey };
