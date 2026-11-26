import apiKeyService, { hasApiKeyScope } from '../services/apiKeyService.js';
import { createHttpError } from './errorHandler.js';

function missingScopeError(scope) {
  return createHttpError(403, `API key is missing required scope: ${scope}`, {
    requiredScope: scope,
  });
}

export function requireApiKeyScope(scope) {
  return async (req, _res, next) => {
    try {
      if (req.auth?.apiKeyId && Array.isArray(req.auth.scopes)) {
        if (!hasApiKeyScope(req.auth.scopes, scope)) {
          return next(missingScopeError(scope));
        }
        return next();
      }

      const rawKey = req.headers['x-api-key'] || req.query.api_key;
      if (typeof rawKey !== 'string' || rawKey.length === 0) {
        return next();
      }

      const keyData = await apiKeyService.validateKey(rawKey);
      if (!keyData) {
        return next(createHttpError(401, 'Invalid API key'));
      }

      req.auth = {
        ...(req.auth || {}),
        apiKeyId: keyData.id,
        userId: keyData.userId,
        organizationId: keyData.organizationId,
        scopes: keyData.scopes,
      };

      if (!hasApiKeyScope(keyData.scopes, scope)) {
        return next(missingScopeError(scope));
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default requireApiKeyScope;
