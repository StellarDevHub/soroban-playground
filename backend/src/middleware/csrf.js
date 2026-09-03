// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Production: Secure Cookie Session Management with CSRF Token Double-Submit Validation
// Protects authenticated browser sessions from cross-site request forgery

import crypto from 'crypto';

/**
 * CSRF configuration
 */
const CSRF_CONFIG = {
  cookieName: 'csrf_token',
  headerName: 'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
  tokenLength: 32,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
};

/**
 * Generate cryptographically secure CSRF token
 * @returns {string} Random token
 */
export function generateCSRFToken() {
  return crypto.randomBytes(CSRF_CONFIG.tokenLength).toString('hex');
}

/**
 * Compute HMAC for token signing
 * @param {string} token - CSRF token
 * @param {string} secret - Secret key
 * @returns {string} HMAC signature
 */
function computeHMAC(token, secret) {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Verify HMAC signature
 * @param {string} token - CSRF token
 * @param {string} signature - HMAC to verify
 * @param {string} secret - Secret key
 * @returns {boolean}
 */
function verifyHMAC(token, signature, secret) {
  const expected = computeHMAC(token, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Generate secret key for CSRF tokens
 * @returns {string} Secret key
 */
function getSecretKey() {
  const envSecret = process.env.CSRF_SECRET;
  if (envSecret) return envSecret;
  
  // Generate ephemeral secret if not configured (not recommended for production)
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create signed CSRF token
 * @returns {object} { token, signature }
 */
export function createSignedToken() {
  const token = generateCSRFToken();
  const secret = getSecretKey();
  const signature = computeHMAC(token, secret);
  
  return {
    token,
    signature,
    secret,
  };
}

/**
 * Verify signed CSRF token
 * @param {string} token - Token from request
 * @param {string} signature - Signature from cookie
 * @returns {boolean}
 */
export function verifySignedToken(token, signature) {
  const secret = getSecretKey();
  return verifyHMAC(token, signature, secret);
}

/**
 * Extract token from request
 * @param {object} req - Express request
 * @returns {string|null} CSRF token
 */
export function extractToken(req) {
  // Try header first
  const headerToken = req.headers[CSRF_CONFIG.headerName.toLowerCase()];
  if (headerToken) return headerToken;
  
  // Try body (if parsed)
  if (req.body && req.body._csrf) return req.body._csrf;
  
  return null;
}

/**
 * Extract signature from cookie
 * @param {object} req - Express request
 * @returns {string|null} CSRF signature
 */
export function extractSignature(req) {
  const cookies = req.cookies || {};
  return cookies[`${CSRF_CONFIG.cookieName}_sig`] || null;
}

/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern:
 * 1. Server sets csrf_token and csrf_token_sig cookies
 * 2. Client sends token in X-CSRF-Token header
 * 3. Server verifies token matches signature
 */
export function csrfProtection(options = {}) {
  const config = { ...CSRF_CONFIG, ...options };
  const secret = getSecretKey();
  
  return (req, res, next) => {
    // Skip for safe methods
    if (config.ignoredMethods.includes(req.method)) {
      return next();
    }
    
    // Skip for unauthenticated requests (if configured)
    if (options.excludeUnauthenticated && !req.user && !req.session?.user) {
      return next();
    }
    
    // Generate new token if not exists
    if (!req.cookies?.[config.cookieName]) {
      const { token, signature } = createSignedToken();
      
      // Set token cookie
      res.cookie(config.cookieName, token, config.cookieOptions);
      
      // Set signature cookie (for verification)
      res.cookie(`${config.cookieName}_sig`, signature, {
        ...config.cookieOptions,
        httpOnly: true,
      });
      
      // Attach to request for downstream use
      req.csrfToken = token;
      req.csrfSignature = signature;
    }
    
    next();
  };
}

/**
 * CSRF Validation Middleware
 * Use after session middleware to validate requests
 */
export function validateCSRF(options = {}) {
  const config = { ...CSRF_CONFIG, ...options };
  const secret = getSecretKey();
  
  return (req, res, next) => {
    // Skip validation for safe methods
    if (config.ignoredMethods.includes(req.method)) {
      return next();
    }
    
    // Skip if no user session (stateless CSRF)
    if (!req.user && !req.session?.user && !options.requireSession) {
      return next();
    }
    
    // Extract tokens
    const token = extractToken(req);
    const cookieToken = req.cookies?.[config.cookieName];
    const signature = req.cookies?.[`${config.cookieName}_sig`];
    
    // Check if CSRF token is required
    const requiresCSRF = options.conditional 
      ? req.user || req.session?.user 
      : true;
    
    if (!requiresCSRF) {
      return next();
    }
    
    // Validate presence
    if (!token || !cookieToken || !signature) {
      return res.status(403).json({
        error: 'csrf_error',
        message: 'CSRF token missing',
      });
    }
    
    // Validate token matches (prevent token swapping)
    if (token !== cookieToken) {
      return res.status(403).json({
        error: 'csrf_error',
        message: 'CSRF token mismatch',
      });
    }
    
    // Validate HMAC signature
    if (!verifyHMAC(token, signature, secret)) {
      return res.status(403).json({
        error: 'csrf_error',
        message: 'Invalid CSRF signature',
      });
    }
    
    // Validate timing (replay attack prevention)
    // Token should not be too old
    const tokenAge = Date.now() - (req.csrfTokenTimestamp || 0);
    const maxAge = config.cookieOptions.maxAge || 86400000;
    
    if (tokenAge > maxAge) {
      return res.status(403).json({
        error: 'csrf_error',
        message: 'CSRF token expired',
      });
    }
    
    // Regenerate token after validation to prevent reuse
    const newToken = generateCSRFToken();
    const newSignature = computeHMAC(newToken, secret);
    
    res.cookie(config.cookieName, newToken, config.cookieOptions);
    res.cookie(`${config.cookieName}_sig`, newSignature, {
      ...config.cookieOptions,
      httpOnly: true,
    });
    
    req.csrfToken = newToken;
    req.csrfSignature = newSignature;
    
    next();
  };
}

/**
 * AngularJS/Angular style CSRF header support
 * Sets XSRF-TOKEN cookie and expects X-XSRF-TOKEN header
 */
export function xsrfSupport(options = {}) {
  const config = { ...CSRF_CONFIG, ...options };
  
  return (req, res, next) => {
    if (!req.cookies?.['XSRF-TOKEN']) {
      const token = generateCSRFToken();
      res.cookie('XSRF-TOKEN', token, {
        httpOnly: false, // Must be readable by JavaScript
        secure: config.cookieOptions.secure,
        sameSite: config.cookieOptions.sameSite,
        path: '/',
        maxAge: config.cookieOptions.maxAge,
      });
    }
    
    // Map to standard header name
    const token = req.cookies?.['XSRF-TOKEN'];
    if (token && req.headers['x-xsrf-token']) {
      req.headers[config.headerName.toLowerCase()] = req.headers['x-xsrf-token'];
    }
    
    next();
  };
}

/**
 * Check if request needs CSRF protection
 * @param {object} req - Express request
 * @returns {boolean}
 */
export function needsCSRFProtection(req) {
  // Safe methods don't need protection
  if (CSRF_CONFIG.ignoredMethods.includes(req.method)) {
    return false;
  }
  
  // Skip /health and /api/public endpoints
  const publicPaths = ['/health', '/api/health', '/api/public'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return false;
  }
  
  return true;
}

/**
 * CSRF error handler middleware
 * Catches CSRF violations and logs them
 */
export function csrfErrorHandler(options = {}) {
  return (err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
      const message = 'Invalid or missing CSRF token';
      
      if (options.log !== false) {
        console.warn('CSRF violation:', {
          method: req.method,
          path: req.path,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          userId: req.user?.id || req.session?.user?.id,
          timestamp: new Date().toISOString(),
        });
      }
      
      return res.status(403).json({
        error: 'csrf_error',
        message: options.hideDetails ? 'Invalid request' : message,
      });
    }
    
    next(err);
  };
}

/**
 * Get current CSRF configuration
 * @returns {object}
 */
export function getCSRFConfig() {
  return { ...CSRF_CONFIG };
}

/**
 * CSRF utilities for testing
 */
export const __test = {
  generateCSRFToken,
  computeHMAC,
  verifyHMAC,
  createSignedToken,
  verifySignedToken,
};

export default {
  csrfProtection,
  validateCSRF,
  xsrfSupport,
  needsCSRFProtection,
  csrfErrorHandler,
  getCSRFConfig,
  generateCSRFToken,
  createSignedToken,
};