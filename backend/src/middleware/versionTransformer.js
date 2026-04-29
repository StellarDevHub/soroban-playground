/**
 * API Version Transformer Middleware
 * Handles backward compatibility by transforming requests/responses
 */

import { versions, DEFAULT_VERSION } from '../config/versions.js';

export const versionTransformer = (requestedVersion) => {
  return (req, res, next) => {
    // 1. Version Negotiation: Accept-Version header > URL version
    const headerVersion = req.headers['accept-version'];
    const version =
      headerVersion && versions[headerVersion]
        ? headerVersion
        : requestedVersion || DEFAULT_VERSION;

    req.apiVersion = version;

    // Log usage for analytics as requested in issue
    if (versions[version]?.status === 'deprecated') {
      console.warn(
        `[API Deprecation Warning] Client called deprecated version ${version}: ${req.method} ${req.originalUrl}`
      );
    } else {
      console.log(
        `[API Usage] ${version} endpoint called: ${req.method} ${req.originalUrl}`
      );
    }

    if (version === 'v1') {
      // Override res.json to transform outgoing snake_case to camelCase for v1 compatibility
      const originalJson = res.json;
      res.json = function (data) {
        if (data && typeof data === 'object') {
          const transformed = transformToV1(data);
          return originalJson.call(this, transformed);
        }
        return originalJson.call(this, data);
      };
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
