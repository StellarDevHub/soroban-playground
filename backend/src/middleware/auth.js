// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import authService from '../services/authService.js';
import { createHttpError } from './errorHandler.js';

/**
 * Authentication middleware. Populates req.user.
 */
export async function authenticate(req, res, next) {
  try {
    req.user = await authService.authenticate(req);
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
    if (authService.hasPermission(req.user, permission)) {
      return next();
    }
    return next(
      createHttpError(
        403,
        `Forbidden: Access requires permission "${permission}"`
      )
    );
  };
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
      if (
        context.user.role === 'admin' ||
        allowedRoles.includes(context.user.role)
      ) {
        return resolver(parent, args, context, info);
      }
      throw new Error(
        `Forbidden: Access requires one of the following roles: ${allowedRoles.join(', ')}`
      );
    };
  };
}
