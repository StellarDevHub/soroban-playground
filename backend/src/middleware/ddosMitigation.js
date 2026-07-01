import { createHttpError } from './errorHandler.js';
import { clientIpMiddleware, resolveClientIp } from './clientIp.js';
import ipFilterService from '../services/ipFilterService.js';

export { clientIpMiddleware, resolveClientIp };

export function ddosMitigationMiddleware(options = {}) {
  const skipPaths = new Set(
    options.skipPaths || ['/health', '/health/live', '/api/health']
  );

  return async (req, res, next) => {
    if (skipPaths.has(req.path)) {
      return next();
    }

    const ip = req.clientIp || resolveClientIp(req, options);

    try {
      if (await ipFilterService.isWhitelisted(ip)) {
        return next();
      }

      if (await ipFilterService.isBlacklisted(ip)) {
        return next(
          createHttpError(403, 'Access denied', {
            reason: 'ip_blacklisted',
            ip,
          })
        );
      }

      const score = await ipFilterService.recordRequestAndScore(ip);
      res.setHeader('X-DDoS-Score', String(score.count));
      res.setHeader('X-DDoS-Threshold', String(score.threshold));

      if (score.shouldBlock) {
        await ipFilterService.blacklistIp(ip, 'traffic_spike');
        return next(
          createHttpError(429, 'Too Many Requests', {
            reason: 'ddos_mitigation',
            ip,
            count: score.count,
            threshold: score.threshold,
          })
        );
      }

      return next();
    } catch (error) {
      console.error('DDoS mitigation error:', error.message);
      return next();
    }
  };
}

export function applyDdosProtection(app, options = {}) {
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY !== 'false';
  if (trustProxy) {
    app.set(
      'trust proxy',
      Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10)
    );
  }
  app.use(clientIpMiddleware(options));
  app.use(ddosMitigationMiddleware(options));
}

export default applyDdosProtection;
