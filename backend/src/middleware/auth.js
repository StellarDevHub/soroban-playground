// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import jwt from 'jsonwebtoken';
import { createHttpError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT token for user authentication
 */
export function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin || false,
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token and extract user information
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user information to request object
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return next(createHttpError(401, 'Access token required'));
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn('Invalid token provided', { token: token.substring(0, 10) + '...', error: error.message });
    return next(createHttpError(403, 'Invalid or expired token'));
  }
}

/**
 * Optional authentication middleware
 * Attaches user information if token is present, but doesn't require it
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next(); // Continue without authentication
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
  } catch (error) {
    // Log but don't block the request
    logger.warn('Invalid token in optional auth', { token: token.substring(0, 10) + '...', error: error.message });
  }

  next();
}

/**
 * Admin-only middleware
 * Requires authentication and admin privileges
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return next(createHttpError(401, 'Authentication required'));
  }

  if (!req.user.isAdmin) {
    return next(createHttpError(403, 'Admin access required'));
  }

  next();
}

/**
 * API Key authentication middleware
 * For service-to-service communication
 */
export function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return next(createHttpError(401, 'API key required'));
  }

  // In a real implementation, this would validate against a database of API keys
  const validApiKeys = process.env.VALID_API_KEYS ? process.env.VALID_API_KEYS.split(',') : [];
  
  if (!validApiKeys.includes(apiKey)) {
    logger.warn('Invalid API key provided', { apiKey: apiKey.substring(0, 10) + '...' });
    return next(createHttpError(403, 'Invalid API key'));
  }

  // Attach service information to request
  req.service = {
    type: 'api_key',
    authenticated: true,
  };

  next();
}

/**
 * Rate limiting based on user tier
 * Different limits for free, premium, and enterprise users
 */
export function tierBasedRateLimit(req, res, next) {
  if (!req.user) {
    return next(createHttpError(401, 'Authentication required'));
  }

  // In a real implementation, this would check the user's subscription tier
  // and apply appropriate rate limits
  const userTier = req.user.tier || 'free';
  
  const tierLimits = {
    free: { requests: 100, window: 3600000 }, // 100 requests per hour
    premium: { requests: 1000, window: 3600000 }, // 1000 requests per hour
    enterprise: { requests: 10000, window: 3600000 }, // 10000 requests per hour
  };

  const limit = tierLimits[userTier] || tierLimits.free;
  
  // Store tier info for rate limiter middleware
  req.tierLimit = limit;
  
  next();
}

export default {
  generateToken,
  verifyToken,
  authenticateToken,
  optionalAuth,
  requireAdmin,
  authenticateApiKey,
  tierBasedRateLimit,
};
