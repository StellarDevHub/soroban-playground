// Copyright (c) 2026 StellarDevTools
// SPDX-License: MIT

import jwt from 'jsonwebtoken';
import { v4 as uuid4 } from 'uuid';
import redisService from './redisService.js';
import jwtRevocationService from './jwtRevocationService.js';
import { getDatabase } from '../database/connection.js';
import apiKeyService from './apiKeyService.js';
import { Keypair, Networks, StrKey, WebAuth } from '@stellar/stellar-sdk';

// EUoi Note: if you need to change the network, use environment variable
const STELLAR_NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const HOME_DOMAIN = process.env.SEP10_HOME_DOMAIN || 'localhost';
const WEB_AUTH_DOMAIN = process.env.SEP10_WEB_AUTH_DOMAIN || HOME_DOMAIN;
const CHALLENGE_TTL_SEC = 5 * 60; // 5 minutes

const devKeypair = Keypair.random();
let serverKeypair;
const STELLAR_SERVER_ACCOUNT = process.env.STELLAR_SERVER_ACCOUNT;
const STELLAR_SERVER_SECRET = process.env.STELLAR_SERVER_SECRET;

if (STELLAR_SERVER_ACCOUNT && STELLAR_SERVER_SECRET) {
  if (!StrKey.isValidEd25519PublicKey(STELLAR_SERVER_ACCOUNT)) {
    throw new Error(
      'STELLAR_SERVER_ACCOUNT environment variable is required and must be a valid Stellar public key'
    );
  }
  serverKeypair = Keypair.fromSecret(STELLAR_SERVER_SECRET);
  if (serverKeypair.publicKey() !== STELLAR_SERVER_ACCOUNT) {
    throw new Error(
      'STELLAR_SERVER_SECRET does not match STELLAR_SERVER_ACCOUNT'
    );
  }
} else {
  serverKeypair = devKeypair;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Production wallet authentication requires STELLAR_SERVER_ACCOUNT and STELLAR_SERVER_SECRET'
    );
  }
}

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('Production wallet authentication requires JWT_SECRET');
}

const JWT_SECRET =
  process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev_and_preview';
const ACCESS_TOKEN_EXPIRATION_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRATION_SEC = 7 * 24 * 60 * 60; // 7 days

class AuthService {
  async generateTokens(user) {
    const accessTokenJti = uuid4();
    const refreshTokenJti = uuid4();
    const familyId = uuid4();
    const tokenVersion = Number(user?.token_version ?? user?.tokenVersion ?? 0);

    const accessToken = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        jti: accessTokenJti,
        familyId,
        type: 'access',
        tokenVersion,
      },
      JWT_SECRET,
      {
        expiresIn: ACCESS_TOKEN_EXPIRATION_SEC,
        issuer: `https://${WEB_AUTH_DOMAIN}`,
      }
    );

    const refreshToken = jwt.sign(
      {
        sub: user.id,
        familyId,
        jti: refreshTokenJti,
        type: 'refresh',
        tokenVersion,
      },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRATION_SEC }
    );

    await redisService.set(
      `refresh:${refreshTokenJti}`,
      JSON.stringify({ sub: user.id, familyId }),
      REFRESH_TOKEN_EXPIRATION_SEC
    );

    return {
      accessToken,
      refreshToken,
      accessTokenJti,
      refreshTokenJti,
      familyId,
    };
  }

  async verifyAccessToken(token) {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    if (decoded.jti && (await jwtRevocationService.isJtiRevoked(decoded.jti))) {
      throw new Error('Token is blacklisted');
    }
    if (
      decoded.familyId &&
      (await redisService.get(`bl_family:${decoded.familyId}`))
    ) {
      throw new Error('Token family is blacklisted');
    }

    await jwtRevocationService.assertTokenEpochValid(decoded);
    return decoded;
  }

  async blacklistAccessToken(jti, exp) {
    const value = Number(exp);
    const now = Math.floor(Date.now() / 1000);
    const ttl = value > 1_000_000_000 ? Math.floor(value - now) : Math.floor(value);
    if (!jti || ttl <= 0) return;
    await jwtRevocationService.revokeJti(jti, exp);
    // Backward-compatible key for existing consumers/tests.
    await redisService.set(`bl_access:${jti}`, '1', ttl);
  }

  async rotateRefreshToken(token) {
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw new Error('Invalid refresh token');
    }

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if the refresh token is already used
    const isUsed = await redisService.get(`used_refresh:${decoded.jti}`);
    if (isUsed) {
      // Anomaly detected: Refresh token reuse!
      // Invalidate the entire token family
      await redisService.set(
        `bl_family:${decoded.familyId}`,
        '1',
        REFRESH_TOKEN_EXPIRATION_SEC // Keep for the duration of the refresh token
      );
      throw new Error('Refresh token reuse detected. Family invalidated.');
    }

    // Check if the family is blacklisted
    const isFamilyBlacklisted = await redisService.get(
      `bl_family:${decoded.familyId}`
    );
    if (isFamilyBlacklisted) {
      throw new Error('Token family is blacklisted due to previous anomaly.');
    }

    // Verify the refresh token is still active in Redis
    const storedRefresh = await redisService.get(`refresh:${decoded.jti}`);
    if (!storedRefresh) {
      throw new Error('Refresh token not found or revoked');
    }
    const storedRefreshData = JSON.parse(storedRefresh);
    if (
      storedRefreshData.sub !== decoded.sub ||
      storedRefreshData.familyId !== decoded.familyId
    ) {
      throw new Error('Refresh token does not match stored record');
    }

    // Reserve this token atomically before issuing its replacement.
    const now = Math.floor(Date.now() / 1000);
    const ttl = decoded.exp - now;
    if (ttl > 0) {
      const reserved = await redisService.setNX(
        `used_refresh:${decoded.jti}`,
        '1',
        ttl
      );
      if (!reserved) {
        await redisService.set(
          `bl_family:${decoded.familyId}`,
          '1',
          REFRESH_TOKEN_EXPIRATION_SEC
        );
        throw new Error('Refresh token reuse detected. Family invalidated.');
      }
    }

    // Issue new tokens
    const newAccessTokenJti = uuid4();
    const newRefreshTokenJti = uuid4();

    const newAccessToken = jwt.sign(
      {
        sub: decoded.sub,
        jti: newAccessTokenJti,
        familyId: decoded.familyId,
        type: 'access',
      },
      JWT_SECRET,
      {
        expiresIn: ACCESS_TOKEN_EXPIRATION_SEC,
        issuer: `https://${WEB_AUTH_DOMAIN}`,
      }
    );

    const newRefreshToken = jwt.sign(
      {
        sub: decoded.sub,
        familyId: decoded.familyId,
        jti: newRefreshTokenJti,
        type: 'refresh',
      },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRATION_SEC }
    );

    await redisService.del(`refresh:${decoded.jti}`);
    await redisService.set(
      `refresh:${newRefreshTokenJti}`,
      JSON.stringify({ sub: decoded.sub, familyId: decoded.familyId }),
      REFRESH_TOKEN_EXPIRATION_SEC
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Fetch a user by id (or Stellar public key if applicable)
   */
  async getUserById(userId) {
    if (!userId) return null;
    const db = getDatabase();
    const user = await db.get(
      'SELECT id, username, email, role, token_version FROM users WHERE id = ?',
      [userId]
    );
    return user || null;
  }

  /**
   * Get all permission names for a specific user ID
   */
  async getUserPermissions(userId) {
    if (!userId) return [];
    const db = getDatabase();
    const rows = await db.all(
      `SELECT p.name
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN roles r ON r.id = rp.role_id
        JOIN users u ON u.role = r.name
        WHERE u.id = ?`,
      [userId]
    );
    return rows.map((row) => row.name);
  }

  /**
   * Generate a SEP-0010 challenge transaction for a Stellar public key.
   */
  async generateStellarChallenge(publicKey) {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new Error('Invalid Stellar public key');
    }

    const transaction = WebAuth.buildChallengeTx(
      serverKeypair,
      publicKey,
      HOME_DOMAIN,
      CHALLENGE_TTL_SEC,
      STELLAR_NETWORK_PASSPHRASE,
      WEB_AUTH_DOMAIN
    );
    const { tx } = WebAuth.readChallengeTx(
      transaction,
      serverKeypair.publicKey(),
      STELLAR_NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN
    );
    // Bind the entire transaction, not just the nonce, to its issued account.
    await redisService.set(
      `challenge:${Buffer.from(tx.hash()).toString('hex')}`,
      publicKey,
      CHALLENGE_TTL_SEC
    );
    return {
      transaction,
      transactionXDR: transaction,
      network_passphrase: STELLAR_NETWORK_PASSPHRASE,
    };
  }

  async verifyStellarChallengeAndIssueTokens(publicKey, transactionXDR) {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new Error('Invalid Stellar public key');
    }
    const { tx, clientAccountID } = WebAuth.readChallengeTx(
      transactionXDR,
      serverKeypair.publicKey(),
      STELLAR_NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN
    );
    const now = Math.floor(Date.now() / 1000);
    if (clientAccountID !== publicKey)
      throw new Error('Challenge account mismatch');
    if (
      !tx.timeBounds ||
      Number(tx.timeBounds.minTime) > now ||
      Number(tx.timeBounds.maxTime) <= now
    ) {
      throw new Error('Challenge expired or not yet valid');
    }
    WebAuth.verifyChallengeTxSigners(
      transactionXDR,
      serverKeypair.publicKey(),
      STELLAR_NETWORK_PASSPHRASE,
      [publicKey],
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN
    );
    const challengeId = Buffer.from(tx.hash()).toString('hex');
    if (
      (await redisService.get(`challenge:${challengeId}`)) !== publicKey ||
      !(await redisService.consumeChallengeNonce(
        challengeId,
        CHALLENGE_TTL_SEC
      ))
    ) {
      throw new Error('Challenge not found or already used');
    }
    return this.generateTokens({
      id: publicKey,
      username: publicKey,
      role: 'user',
    });
  }

  async revokeRefreshToken(token) {
    if (!token) return;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.type !== 'refresh') return;
      await redisService.set(
        `bl_family:${decoded.familyId}`,
        '1',
        REFRESH_TOKEN_EXPIRATION_SEC
      );
      await redisService.del(`refresh:${decoded.jti}`);
    } catch (error) {
      if (
        error.name !== 'JsonWebTokenError' &&
        error.name !== 'TokenExpiredError'
      )
        throw error;
    }
  }

  /**
   * Authenticate a request based on JWT, API Key, or session.
   * Secured in production. No insecure fallback headers.
   */
  async authenticate(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : null;

    if (token) {
      // 1. Try JWT access token
      try {
        const decoded = await this.verifyAccessToken(token);
        let user = await this.getUserById(decoded.sub);
        if (!user && StrKey.isValidEd25519PublicKey(decoded.sub)) {
          user = { id: decoded.sub, username: decoded.sub, role: 'user' };
        }
        if (user) {
          const permissions = await this.getUserPermissions(user.id);
          return { ...user, permissions };
        }
      } catch {
        // JWT invalid, fall through to API key validation
      }

      // 2. Try API Key
      const validated = await apiKeyService.validateKey(token);
      if (validated && validated.userId) {
        const user = await this.getUserById(validated.userId);
        if (user) {
          const permissions = await this.getUserPermissions(user.id);
          return { ...user, permissions };
        }
      }
    }

    // 3. Session based authentication
    if (req.session && req.session.userId) {
      const user = await this.getUserById(req.session.userId);
      if (user) {
        const permissions = await this.getUserPermissions(user.id);
        return { ...user, permissions };
      }
    }

    // 3. Fallback Headers (For testing/development context/GraphQL playground)
    if (process.env.NODE_ENV !== 'production') {
      const headerUserId = req.headers['x-user-id'];
      const headerRole = req.headers['x-role'];

      if (headerUserId) {
        const user = await this.getUserById(parseInt(headerUserId, 10));
        if (user) {
          const permissions = await this.getUserPermissions(user.id);
          return { ...user, permissions };
        }
      }

      if (headerRole) {
        // If we only have x-role header (e.g. playground), return a mock user with that role
        const mockUser = {
          id: headerRole === 'admin' ? 1 : 2, // mock ID
          username: `${headerRole}_user`,
          email: `${headerRole}@example.com`,
          role: headerRole,
        };
        const db = getDatabase();
        const rows = await db.all(
          `SELECT p.name
           FROM permissions p
           JOIN role_permissions rp ON p.id = rp.permission_id
           JOIN roles r ON r.id = rp.role_id
           WHERE r.name = ?`,
          [headerRole]
        );
        const permissions = rows.map((row) => row.name);
        return { ...mockUser, permissions };
      }
    }

    // 4. Default anonymous/guest user
    return {
      id: null,
      username: 'anonymous',
      email: '',
      role: 'guest',
      permissions: ['project:read'], // Guest default permission
    };
  }

  /**
   * Check if a user has a specific permission
   */
  hasPermission(user, permission) {
    if (!user) return false;
    if (user.role === 'admin') return true; // Admins bypass all permission checks
    return user.permissions ? user.permissions.includes(permission) : false;
  }

  /**
   * Check if a user has a specific role
   */
  hasRole(user, roles) {
    if (!user) return false;
    const rolesToCheck = Array.isArray(roles) ? roles : [roles];
    return rolesToCheck.includes(user.role);
  }
}

export default new AuthService();
