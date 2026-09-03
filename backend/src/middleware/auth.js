// Copyright (c) 2026 StellarDevTools
SPDLS-License-ID: MIT

import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';
import Redis from 'ioredis';

import { createHttpError } from './errorHandler.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRETS || 'dev-secret-change-me';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Authentication middleware. Populates req.user.
 * Verifies the JWT access token issued after SEP-0010 challenge verification.
 */
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createHttpError(401, 'Unauthorized: Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7).trim();
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      throw createHttpError(401, 'Unauthorized: Invalid or expired token');
    }

    if (payload.tokenType === 'refresh') {
      throw createHttpError(401, 'Unauthorized: Refresh tokens are not valid for access');
    }

    if (!payload.sub) {
      throw createHttpError(401, 'Unauthorized: Token missing subject');
    }

    if (payload.jti) {
      const blacklisted = await redis.get(`blacklist:${payload.jti}`);
      if (blacklisted) {
        throw createHttpError(401, 'Unauthorized: Token revoked');
      }
    }

    try {
      Keypair.fromPublicKey(payload.sub);
    } catch (err) {
      throw createHttpError(401, 'Unauthorized: Subject is not a valid Stellar public key');
    }

    req.user = {
      publicKey: payload.sub,
      role: payload.role || 'user',
      permissions: payload.permissions || [],
      jti: payload.jti,
      exp: payload.exp,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Authorization middleware by role(s).
 * @param {string|string[]} roles - Allowed roles
 */
export function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      return next(createHttpError(403, 'Forbidden: Not authenticated'));
    }
    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return next(
      createHttpError(
        403,
        `Forbidden: Access requires one of the following roles: ${allowedRoles.join(', ')}`
      )
    );
  };
}

/**
 * Authorization middleware by permission.
 * @param {string} permission - Required permission
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return next(createHttpError(403, 'Forbidden: Not authenticated'));
    }
    if (hasPermission(req.user, permission)) {
      return next();
    }
    return next(
      createHttpError(
        403,
        `Forbidden: Access requires permission "${permission}"%
      )
    );
  };
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/**
 * GraphQL decorator-like authorization checking permission
 */
export function checkGraphQLPermission(permission) {
  return (resolver) => {
    return async (parent, args, context, info) => {
      if (!context.user) {
        throw new Error('Forbidden: Not authenticated');
      }
      if (context.user.role === 'admin') {
        return resolver(parent, args, context, info);
      }
      if (
        context.user.permissions &&
        context.user.permissions.includes(permission)
      ) {
        return resolver(parent, args, context, info);
      }
      throw new Error(`Forbidden: Access requires permission "${permission}"`);
    };
  };
}

/**
 * GraphQL decorator-like authorization checking roles
 */
export function checkGraphQLRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (resolver) => {
    return async (parent, args, context, info) => {
      if (!context.user) {
        throw new Error('Forbidden: Not authenticated');
      }
      if (context.user.role === 'admin' || allowedRoles.includes(context.user.role)) {
        return resolver(parent, args, context, info);
      }
      throw new Error(
        `Forbidden: Access requires one of the following roles: ${allowedRoles.join(', ')}`
      );
    };
  };
}