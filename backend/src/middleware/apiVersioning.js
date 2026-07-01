import { DEFAULT_VERSION, versions } from '../config/versions.js';
import { createHttpError } from './errorHandler.js';

const supportedVersions = new Set(Object.keys(versions));

function normalizeVersion(value) {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^v?(\d+)$/);
  return match ? `v${match[1]}` : null;
}

function extractAcceptHeaderVersion(acceptHeader) {
  if (!acceptHeader || typeof acceptHeader !== 'string') return null;

  for (const part of acceptHeader.split(',')) {
    const mediaType = part.trim();
    const parameterMatch = mediaType.match(/(?:^|;)\s*version=(v?\d+)\b/i);
    if (parameterMatch) {
      return normalizeVersion(parameterMatch[1]);
    }

    const vendorMatch = mediaType.match(
      /application\/vnd\.[^;\s,]+\.v(\d+)\+json/i
    );
    if (vendorMatch) {
      return normalizeVersion(vendorMatch[1]);
    }
  }

  return null;
}

export function getRequestedApiVersion(req) {
  for (const headerName of ['accept-version', 'x-api-version', 'api-version']) {
    const headerValue = req.headers[headerName];
    if (headerValue !== undefined) {
      return normalizeVersion(headerValue) || String(headerValue);
    }
  }

  return extractAcceptHeaderVersion(req.headers.accept);
}

export function unsupportedVersionPayload(version) {
  return {
    requestedVersion: version,
    supportedVersions: Object.keys(versions),
    defaultVersion: DEFAULT_VERSION,
  };
}

export function negotiateApiVersion({
  uriVersion,
  defaultVersion = DEFAULT_VERSION,
  allowHeaderVersion = true,
} = {}) {
  return (req, _res, next) => {
    const headerVersion = allowHeaderVersion
      ? getRequestedApiVersion(req)
      : null;
    const requestedVersion = uriVersion || headerVersion || defaultVersion;
    const apiVersion = normalizeVersion(requestedVersion);

    if (!apiVersion || !supportedVersions.has(apiVersion)) {
      return next(
        createHttpError(
          400,
          `Unsupported API version: ${requestedVersion}`,
          unsupportedVersionPayload(requestedVersion)
        )
      );
    }

    req.apiVersion = apiVersion;
    req.apiVersionSource = uriVersion
      ? 'uri'
      : headerVersion
        ? 'header'
        : 'default';

    return next();
  };
}

export function rejectUnsupportedUriVersion(req, _res, next) {
  const match = req.path.match(/^\/(v\d+)(?:\/|$)/i);
  const requestedVersion = match ? normalizeVersion(match[1]) : null;

  if (!requestedVersion || !supportedVersions.has(requestedVersion)) {
    return next(
      createHttpError(
        400,
        `Unsupported API version: ${requestedVersion || 'unknown'}`,
        unsupportedVersionPayload(requestedVersion || 'unknown')
      )
    );
  }

  return next();
}

export function dispatchByApiVersion(versionRouters) {
  return (req, res, next) => {
    const versionRouter = versionRouters[req.apiVersion];

    if (!versionRouter) {
      return next(
        createHttpError(
          400,
          `Unsupported API version: ${req.apiVersion}`,
          unsupportedVersionPayload(req.apiVersion)
        )
      );
    }

    return versionRouter.handle(req, res, next);
  };
}
