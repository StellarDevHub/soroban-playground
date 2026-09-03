// Copyright (c) 2026 StellarDevTools
// SPDX-License: MIT

import jwt from 'jsonwebtoken';
import { v4 as uuid4} from 'uuid';
import redisService from './redisService.js';
import { getDatabase } from '../database/connection.js';
import apiKeyService from './apiKeyService.js';
import { randomBytes } from 'crypto';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

// EUoi Note: if you need to change the network, use environment variable
const STELLAR_NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const CHALLENGE_TTL_SEC = 5 * 60; // 5 minutes

const STELLAR_SERVER_ACCOUNT = process.env.STELLAR_SERVER_ACCOUNT;
if (!STELLAR_SERVER_ACCOUNT || !StrKey.isValidEd25519PublicKey(STELLAR_SERVER_ACCOUNT)) {
  throw new Error('STELLAR_SERVER_ACCOUNT environment variable is required and must be a valid Stellar public key');
}

const STELLAR_SERVER_SECRET = process.env.STELLAR_SERVER_SECRET;
if (!STELLAR_SERVER_SECRET) {
  throw new Error('STELLAR_SERVER_SECRET environment variable is required');
}
const serverKeypair = Keypair.fromSecret(STELLAR_SERVER_SECRET);
if (serverKeypair.publicKey() !== STELLAR_SERVER_ACCOUNT) {
  throw new Error('STELLAR_SERVER_SECRET does not match STELLAR_SERVER_ACCOUNT');
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const ACCESS_TOKEN_EXPIRATION_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRATION_SEC = 7 * 24 * 60 * 60; // 7 days

class AuthService {
  async generateTokens(user) {
    const accessTokenJti = uuid4();
    const refreshTokenJti = uuid4();
    const familyId = uuid4();

    const accessToken = jwt.sign(
      { sub: user.id, username: user.username, jti: accessTokenJti, type: 'access' },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION_SEC }
    );

    const refreshToken = jwt.sign(
      { sub: user.id, familyId, jti: refreshTokenJti, type: 'refresh' },
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

    // Check if token is blacklisted in Redis
    const isBlacklisted = await redisService.get(`bl_access:${decoded.jti}`);
    if (isBlacklisted) {
      throw new Error('Token is blacklisted');
    }
    return decoded;
  }

  async blacklistAccessToken(jti, exp) {
    const now = Math.floor(Date.now() / 1000);
    const ttl = exp - now;
    if (ttl > 0) {
      await redisService.set(`bl_access:${jti}`, '1', ttl);
    }
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

    // Mark current refresh token as used
    const now = Math.floor(Date.now() / 1000);
    const ttl = decoded.exp - now;
    if (ttl > 0) {
      await redisService.set(`used_refresh:${decoded.jti}`, '1', ttl);
    }

    // Issue new tokens
    const newAccessTokenJti = uuid4();
    const newRefreshTokenJti = uuid4();

    const newAccessToken = jwt.sign(
      { sub: decoded.sub, jti: newAccessTokenJti, type: 'access' },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION_SEC }
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
      'SELECT id, username, email, role FROM users WHERE id = ?',
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
       WHERE u.id = ?',
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

    const nonceBuffer = randomBytes(64);
    const nonce = nonceBuffer.toString('base64');
    const now = Math.floor(Date.now() / 1000);

    const serverAccount = new Account(STELLAR_SERVER_ACCOUNT, '0');
    const tx = new TransactionBuilder(serverAccount, {
      fee: '100',
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .setTimebounds(now - CHALLENGE_TTL_SEC, now + CHALLENGE_TTL_SEC)
      .addOperation(
        Operation.manageData({
          source: publicKey,
          name: 'auth',
          value: nonceBuffer,
        })
      )
      .build();

    tx.sign(serverKeypair);

    // Store nonce to prevent replay
    await redisService.set(
      `challenge:${nonce}`,
      publicKey,
      CHALLENGE_TTL_SEC
    );

    return {
      transactionXDR: tx.toEnvelope().toXDR('base64'),
      nonce,
    };
  }

  /**
   * Verify a SEP-0010 challenge transaction signature and issue JWT tokens.
   */
  async verifyStellarChallengeAndIssueTokens(publicKey, transactionXDR) {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new Error('Invalid Stellar public key');
    }
    let tx;
    try {
      tx = new Transaction(transactionXDR, STELLAR_NETWORK_PASSPHRASE);
    } catch (err) {
      throw new Error('Invalid transaction XDR');
    }

    if (tx.source !== STELLAR_SERVER_ACCOUNT) {
      throw new Error('Transaction source does not match server account');
    }

    if (String(tx.sequence) !== '0') {
      throw new Error('Transaction sequence must be 0');
    }

    // Check timebounds for 5-minute window
    const now = Math.floor(Date.now() / 1000);
    const tb = tx.timeBounds;
    if (!tb || !tb.minTime || !tb.maxTime) {
      throw new Error('Transaction must have timebounds');
    }
    if (
      tb.minTime > now ||
      tb.maxTime < now ||
      tb.maxTime - tb.minTime > CHALLENGE_TTL_SEC * 2
    ) {
      throw new Error('Challenge expired or invalid timebounds');
    }

    // Extract nonce from auth operation
    const authOps = tx.operations.filter(
      (op) => op.type === 'manageData' && op.name === 'auth'
    );
    if (authOps.length !== 1) {
      throw new Error('Expected exactly one auth operation');
    }
    const authOp = authOps[0];
    if (authOp.source !== publicKey) {
      throw new Error('Auth operation source does not match public key');
    }
    const nonceBuffer = authOp.value;
    if (!nonceBuffer || nonceBuffer.length !== 64) {
      throw new Error('Invalid auth nonce length');
    }
    const nonce = nonceBuffer.toString('base64');

    // Check replay protection (nonce must be active and match public key)
    const storedPubkey = await redisService.get(`challenge:${nonce}`);
    if (!storedPubkey || storedPubkey === 'used') {
      throw new Error('Challenge not found or already used');
    }
    if (storedPubkey !== publicKey) {
      throw new Error('Challenge was issued for a different address');
    }

    // Verify the server signature, then the client signature
    if (tx.signatures.length === 0) {
      throw new Error('Transaction is not signed');
    }
    const signatureBase = tx.signatureBase();
    const hasServerSignature = tx.signatures.some((sig) => {
      try {
        return serverKeypair.verify(sig.signature, signatureBase);
      } catch {
        return false;
      }
    });
    if (!hasServerSignature) {
      throw new Error('Invalid server signature');
    }

    const keypair = Keypair.fromPublicKey(publicKey);
    const isValid = tx.signatures.some((sig) => {
      try {
        return keypair.verify(sig.signature, signatureBase);
      } catch {
        return false;
      }
    });
    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Mark nonce as used to prevent replay for the remaining challenge validity window
    const replayTtl = Math.max(1, Number(tb.maxTime) - now + 1);
    await redisService.set(`challenge:${nonce}`, 'used', replayTtl);

    // Issue JWT tokens for this Stellar publickey as the user identifier
    const user = { id: publicKey, username: publicKey, role: 'user' };
    return this.generateTokens(user);
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
