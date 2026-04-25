/**
 * API Version Transformer Middleware
 * Handles backward compatibility by transforming requests/responses
 */

export const versionTransformer = (version) => {
  return (req, res, next) => {
    req.apiVersion = version;

    if (version === 'v1') {
      res.setHeader('X-API-Version', 'v1');
      res.setHeader('Warning', '299 - "v1 is deprecated and will be sunset on 2026-12-31. Please migrate to v2."');
      
      // Track usage for analytics
      console.log(`[API Usage] v1 endpoint called: ${req.method} ${req.originalUrl}`);
      
      // Override res.json to transform outgoing snake_case to camelCase if needed
      const originalJson = res.json;
      res.json = function (data) {
        if (data && typeof data === 'object') {
          const transformed = transformToV1(data);
          return originalJson.call(this, transformed);
        }
        return originalJson.call(this, data);
      };
    } else {
      res.setHeader('X-API-Version', 'v2');
    }

    next();
  };
};

/**
 * Transforms v2 response data back to v1 format (camelCase)
 */
function transformToV1(obj) {
  if (Array.isArray(obj)) {
    return obj.map(transformToV1);
  } else if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      // Example: contract_id -> contractId
      const newKey = key.replace(/(_\w)/g, (m) => m[1].toUpperCase());
      newObj[newKey] = transformToV1(obj[key]);
    }
    return newObj;
  }
  return obj;
}

/**
 * Transforms v1 request data to v2 format (snake_case)
 */
export const requestTransformerV2 = (req, res, next) => {
  if (req.apiVersion === 'v1' && req.body) {
    req.body = transformToV2(req.body);
  }
  next();
};

function transformToV2(obj) {
  if (Array.isArray(obj)) {
    return obj.map(transformToV2);
  } else if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      // Example: contractId -> contract_id
      const newKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      newObj[newKey] = transformToV2(obj[key]);
    }
    return newObj;
  }
  return obj;
}
