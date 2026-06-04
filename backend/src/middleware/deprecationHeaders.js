import { versions } from '../config/versions.js';

/**
 * Middleware to add Deprecation and Sunset headers based on the requested API version.
 * Implements RFC 8594 (Deprecation) and draft-ietf-httpapi-sunset-header (Sunset).
 */
export const deprecationHeaders = (req, res, next) => {
  const versionId = req.apiVersion;
  const versionInfo = versions[versionId];

  if (versionInfo) {
    res.setHeader('API-Version', versionInfo.id);

    if (versionInfo.status === 'deprecated') {
      // Deprecation header: date or 'true'
      const deprecationValue = versionInfo.deprecationDate
        ? new Date(versionInfo.deprecationDate).toUTCString()
        : 'true';
      res.setHeader('Deprecation', deprecationValue);

      if (versionInfo.sunsetDate) {
        res.setHeader('Sunset', new Date(versionInfo.sunsetDate).toUTCString());
      }

      // Link headers for migration guides
      if (versionInfo.links && versionInfo.links.length > 0) {
        const linkHeader = versionInfo.links
          .map((link) => `<${link.href}>; rel="${link.rel}"`)
          .join(', ');
        res.setHeader('Link', linkHeader);
      }
    }
  }

  next();
};
