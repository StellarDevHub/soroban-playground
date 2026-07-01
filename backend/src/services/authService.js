// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import redisService from './redisService.js';
import { getDatabase } from '../database/connection.js';
import apiKeyService from './apiKeyService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev';

class AuthService {
  generateTokens(user) {
    const accessTokenJti = uuidv4();
    const refreshTokenJti = uuidv4();
    const familyId = uuidv4();

    const accessToken = jwt.sign(
      { sub: user.id, username: user.username, jti: accessTokenJti },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION_SEC }
    );

    const refreshToken = jwt.sign(
      { sub: user.id, familyId, jti: refreshTokenJti, type: 'refresh' },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRATION_SEC }
    );

    return { accessToken, refreshToken, accessTokenJti, refreshTokenJti, familyId };
  }

  async verifyAccessToken(token) {
    const decoded = jwt.verify(token, JWT_SECRET);
    
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
      await redisService.set(`bl_family:${decoded.familyId}`, '1', REFRESH_TOKEN_EXPIRATION_SEC);
      throw new Error('Refresh token reuse detected. Family invalidated.');
    }

    // Check if the family is blacklisted
    const isFamilyBlacklisted = await redisService.get(`bl_family:${decoded.familyId}`);
    if (isFamilyBlacklisted) {
      throw new Error('Token family is blacklisted due to previous anomaly.');
    }

    // Mark current refresh token as used
    const now = Math.floor(Date.now() / 1000);
    const ttl = decoded.exp - now;
    if (ttl > 0) {
      await redisService.set(`used_refresh:${decoded.jti}`, '1', ttl);
    }

    // Issue new tokens
    const newAccessTokenJti = uuidv4();
    const newRefreshTokenJti = uuidv4();

    const newAccessToken = jwt.sign(
      { sub: decoded.sub, jti: newAccessTokenJti },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION_SEC }
    );

    const newRefreshToken = jwt.sign(
      { sub: decoded.sub, familyId: decoded.familyId, jti: newRefreshTokenJti, type: 'refresh' },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRATION_SEC }
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }

  /**
   * Fetch a user by ID including their role
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
       WHERE u.id = ?`,
      [userId]
    );
    return rows.map((row) => row.name);
  }

  /**
   * Authenticate a request based on API key, session, or fallback headers
   */
  async authenticate(req) {
    // 1. Check API Key
    let token = null;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (token) {
      const validated = await apiKeyService.validateKey(token);
      if (validated && validated.userId) {
        const user = await this.getUserById(validated.userId);
        if (user) {
          const permissions = await this.getUserPermissions(user.id);
          return { ...user, permissions };
        }
      }
    }

    // 2. Check Session
    if (req.session && req.session.userId) {
      const user = await this.getUserById(req.session.userId);
      if (user) {
        const permissions = await this.getUserPermissions(user.id);
        return { ...user, permissions };
      }
    }

    // 3. Fallback Headers (For testing/development context/GraphQL playground)
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
      // Fetch permissions for the role
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

    // Default anonymous/guest user
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
