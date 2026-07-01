import crypto from 'crypto';
import helmet from 'helmet';

const STELLAR_RPC_HOSTS = [
  'https://soroban-testnet.stellar.org',
  'https://soroban-mainnet.stellar.org',
  'https://horizon-testnet.stellar.org',
  'https://horizon.stellar.org',
];

const CSP_EXTRA_CONNECT_SRC = (process.env.CSP_CONNECT_SRC || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CSP_EXTRA_SCRIPT_SRC = (process.env.CSP_SCRIPT_SRC || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export function createCspNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('X-CSP-Nonce', res.locals.cspNonce);
  next();
}

export function buildHelmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: [
          "'self'",
          ...CSP_EXTRA_SCRIPT_SRC,
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          "'self'",
          'wss:',
          ...STELLAR_RPC_HOSTS,
          ...CSP_EXTRA_CONNECT_SRC,
        ],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hsts: {
      maxAge: 63_072_000,
      includeSubDomains: true,
      preload: true,
    },
    hidePoweredBy: true,
    noSniff: true,
    dnsPrefetchControl: { allow: false },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  });
}

export function applySecurityHeaders(app) {
  app.disable('x-powered-by');
  app.use(createCspNonce);
  app.use(buildHelmetMiddleware());
}

export default applySecurityHeaders;
