// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import apiKeyService from '../services/apiKeyService.js';
import { createHttpError } from './errorHandler.js';
import { deriveTenantId } from '../utils/tenant.js';

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyHs256Jwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw createHttpError(401, 'Invalid bearer token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  let header;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
  } catch {
    throw createHttpError(401, 'Invalid bearer token header');
  }

  if (header.alg !== 'HS256') {
    throw createHttpError(401, 'Unsupported bearer token algorithm');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  if (
    !timingSafeEqualHex(
      Buffer.from(signature).toString('hex'),
      Buffer.from(expected).toString('hex')
    )
  ) {
    throw createHttpError(401, 'Invalid bearer token signature');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw createHttpError(401, 'Invalid bearer token payload');
  }

  if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) {
    throw createHttpError(401, 'Bearer token has expired');
  }

  return payload;
}

function setTenant(req, source, auth) {
  const tenantId = deriveTenantId(auth);
  if (!tenantId) {
    throw createHttpError(
      403,
      'Authenticated principal is missing tenant context'
    );
  }

  if (req.tenant && req.tenant.id !== tenantId) {
    throw createHttpError(403, 'Conflicting tenant credentials');
  }

  req.tenant = { id: tenantId, source };
  req.auth = {
    ...(req.auth || {}),
    apiKeyId: auth.apiKeyId ?? auth.id ?? req.auth?.apiKeyId,
    userId: auth.userId ?? req.auth?.userId,
    organizationId: auth.organizationId ?? req.auth?.organizationId,
    roles: auth.roles ?? req.auth?.roles ?? [],
  };
}

async function applyApiKeyContext(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return false;

  const apiKeyData = await apiKeyService.validateKey(apiKey);
  if (!apiKeyData) {
    throw createHttpError(401, 'Invalid API key');
  }

  setTenant(req, 'api_key', {
    ...apiKeyData,
    apiKeyId: apiKeyData.id,
    tenantId: apiKeyData.tenantId,
  });
  return true;
}

function applyJwtContext(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const secret = process.env.TENANT_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw createHttpError(503, 'JWT tenant authentication is not configured');
  }

  const payload = verifyHs256Jwt(authHeader.slice('Bearer '.length), secret);
  setTenant(req, 'jwt', {
    tenantId: payload.tenant_id || payload.tenantId,
    organizationId: payload.organization_id || payload.organizationId,
    userId: payload.sub || payload.user_id || payload.userId,
    roles: payload.roles || [],
  });
  return true;
}

export function requireTenantContext() {
  return async (req, _res, next) => {
    try {
      const hasJwt = applyJwtContext(req);
      const hasApiKey = await applyApiKeyContext(req);

      if (!hasJwt && !hasApiKey) {
        return next(
          createHttpError(
            401,
            'Tenant authentication required. Provide a valid API key or bearer token.'
          )
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function assertTenantAccess(req, resourceTenantId) {
  if (!req.tenant?.id) {
    throw createHttpError(401, 'Tenant authentication required');
  }

  if (resourceTenantId && resourceTenantId !== req.tenant.id) {
    throw createHttpError(404, 'Resource not found');
  }
}
