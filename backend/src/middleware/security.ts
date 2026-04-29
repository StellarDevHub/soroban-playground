// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { createHttpError } from './errorHandler.js';
import { logger } from '../utils/logger.js';
import { validateAddress } from '../utils/validation.js';

// Security configuration
const SECURITY_CONFIG = {
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX: 100, // 100 requests per window
  RATE_LIMIT_MAX_API: 1000, // Higher limit for API endpoints
  RATE_LIMIT_MAX_SUBSCRIPTION: 50, // Stricter limit for subscription operations
  MAX_REQUEST_SIZE: '10mb',
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  CORS_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  CORS_HEADERS: ['Content-Type', 'Authorization', 'X-API-Key'],
};

// Rate limiting configurations
export const createRateLimit = (options: {
  windowMs?: number;
  max?: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}) => {
  return rateLimit({
    windowMs: options.windowMs || SECURITY_CONFIG.RATE_LIMIT_WINDOW,
    max: options.max || SECURITY_CONFIG.RATE_LIMIT_MAX,
    message: options.message || 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    handler: (req: Request, res: Response) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
      });
      
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: options.message || 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(options.windowMs! / 1000),
      });
    },
  });
};

// Different rate limits for different endpoints
export const generalRateLimit = createRateLimit({
  max: SECURITY_CONFIG.RATE_LIMIT_MAX,
});

export const apiRateLimit = createRateLimit({
  max: SECURITY_CONFIG.RATE_LIMIT_MAX_API,
});

export const subscriptionRateLimit = createRateLimit({
  max: SECURITY_CONFIG.RATE_LIMIT_MAX_SUBSCRIPTION,
  message: 'Too many subscription requests, please try again later.',
});

export const strictRateLimit = createRateLimit({
  max: 10, // Very strict for sensitive operations
  windowMs: 60 * 1000, // 1 minute
  message: 'Too many sensitive operations, please try again later.',
});

// Helmet security headers configuration
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for compatibility
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

// CORS configuration
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (SECURITY_CONFIG.CORS_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS violation', { origin, allowedOrigins: SECURITY_CONFIG.CORS_ORIGINS });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: SECURITY_CONFIG.CORS_METHODS,
  allowedHeaders: SECURITY_CONFIG.CORS_HEADERS,
  credentials: true,
  optionsSuccessStatus: 200,
};

// Input validation middleware
export const validateInput = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req.body);
      
      if (error) {
        const details = error.details.map((detail: any) => detail.message);
        logger.warn('Input validation failed', {
          path: req.path,
          method: req.method,
          errors: details,
          ip: req.ip,
        });
        
        return next(createHttpError(400, 'Validation failed', details));
      }
      
      // Replace request body with validated and sanitized data
      req.body = value;
      next();
    } catch (error) {
      logger.error('Validation error', { error: error.message, path: req.path });
      next(createHttpError(500, 'Validation error', [error.message]));
    }
  };
};

// Stellar address validation middleware
export const validateStellarAddress = (addressField = 'address') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = req.body[addressField] || req.params[addressField] || req.query[addressField];
      
      if (!address) {
        return next(createHttpError(400, `${addressField} is required`));
      }
      
      if (!validateAddress(address)) {
        logger.warn('Invalid Stellar address', {
          address,
          path: req.path,
          method: req.method,
          ip: req.ip,
        });
        
        return next(createHttpError(400, 'Invalid Stellar address'));
      }
      
      next();
    } catch (error) {
      logger.error('Address validation error', { error: error.message });
      next(createHttpError(500, 'Address validation error'));
    }
  };
};

// Request size limiting middleware
export const requestSizeLimit = (maxSize = SECURITY_CONFIG.MAX_REQUEST_SIZE) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength) {
      const sizeInBytes = parseInt(contentLength);
      const maxSizeInBytes = typeof maxSize === 'string' 
        ? parseInt(maxSize) * 1024 * 1024 // Convert MB to bytes
        : maxSize;
      
      if (sizeInBytes > maxSizeInBytes) {
        logger.warn('Request size too large', {
          size: sizeInBytes,
          maxSize: maxSizeInBytes,
          path: req.path,
          ip: req.ip,
        });
        
        return next(createHttpError(413, 'Request entity too large'));
      }
    }
    
    next();
  };
};

// IP whitelist middleware
export const ipWhitelist = (allowedIPs: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!allowedIPs.includes(clientIP!)) {
      logger.warn('IP not whitelisted', {
        ip: clientIP,
        path: req.path,
        method: req.method,
      });
      
      return next(createHttpError(403, 'Access denied'));
    }
    
    next();
  };
};

// Admin role verification middleware
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.isAdmin) {
    logger.warn('Unauthorized admin access attempt', {
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    
    return next(createHttpError(403, 'Admin access required'));
  }
  
  next();
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
    });
  });
  
  next();
};

// Sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    
    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }
    
    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params);
    }
    
    next();
  } catch (error) {
    logger.error('Input sanitization error', { error: error.message });
    next(createHttpError(500, 'Input sanitization error'));
  }
};

// Recursive object sanitization
function sanitizeObject(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Remove potentially dangerous keys
    if (key.includes('__proto__') || key.includes('constructor') || key.includes('prototype')) {
      continue;
    }
    
    if (typeof value === 'string') {
      // Basic XSS prevention
      sanitized[key] = value
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// API key validation middleware
export const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.get('X-API-Key');
  
  if (!apiKey) {
    return next(createHttpError(401, 'API key required'));
  }
  
  // In a real implementation, this would validate against a database
  const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];
  
  if (!validApiKeys.includes(apiKey)) {
    logger.warn('Invalid API key', {
      apiKey: apiKey.substring(0, 10) + '...',
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    
    return next(createHttpError(403, 'Invalid API key'));
  }
  
  next();
};

// Request timeout middleware
export const requestTimeout = (timeoutMs = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          path: req.path,
          method: req.method,
          timeout: timeoutMs,
          ip: req.ip,
        });
        
        res.status(408).json({
          success: false,
          error: 'Request timeout',
          message: 'Request took too long to process',
        });
      }
    }, timeoutMs);
    
    res.on('finish', () => {
      clearTimeout(timeout);
    });
    
    next();
  };
};

// Content type validation middleware
export const validateContentType = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.get('Content-Type');
    
    if (req.method !== 'GET' && req.method !== 'DELETE' && !allowedTypes.some(type => contentType?.includes(type))) {
      logger.warn('Invalid content type', {
        contentType,
        allowedTypes,
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      
      return next(createHttpError(415, 'Unsupported Media Type'));
    }
    
    next();
  };
};

// Security audit middleware
export const securityAudit = (req: Request, res: Response, next: NextFunction) => {
  const auditData = {
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    referer: req.get('Referer'),
  };
  
  // Log suspicious activity
  const suspiciousPatterns = [
    /\.\./, // Path traversal
    /<script/i, // XSS attempt
    /union.*select/i, // SQL injection attempt
    /javascript:/i, // JavaScript protocol
    /data:.*base64/i, // Base64 encoded data
  ];
  
  const requestBody = JSON.stringify(req.body);
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(requestBody) || pattern.test(req.path) || pattern.test(req.get('User-Agent') || '')
  );
  
  if (isSuspicious) {
    logger.warn('Suspicious activity detected', {
      ...auditData,
      requestBody: requestBody.substring(0, 1000), // Limit size
    });
    
    // Could add additional security measures here like blocking the IP
  }
  
  // Store audit data for security analysis
  req.securityAudit = auditData;
  
  next();
};

// Health check security middleware
export const healthCheckSecurity = (req: Request, res: Response, next: NextFunction) => {
  // Health checks should be accessible without authentication
  // but still logged and rate limited
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }
  
  // Apply regular security to other endpoints
  next();
};

export default {
  createRateLimit,
  generalRateLimit,
  apiRateLimit,
  subscriptionRateLimit,
  strictRateLimit,
  securityHeaders,
  corsOptions,
  validateInput,
  validateStellarAddress,
  requestSizeLimit,
  ipWhitelist,
  requireAdmin,
  requestLogger,
  sanitizeInput,
  validateApiKey,
  requestTimeout,
  validateContentType,
  securityAudit,
  healthCheckSecurity,
};
