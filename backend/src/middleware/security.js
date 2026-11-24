import crypto from 'crypto';
import helmet from 'helmet';

const STELLAR_RPC_HOSTS = [
  'https://soroban-testnet.stellar.org',
  'https://rpc-futurenet.stellar.org',
  'https://soroban-mainnet.stellar.org',
  'https://horizon-testnet.stellar.org',
  'https://horizon.stellar.org',
  'https://mainnet.sorobanrpc.com',
];

const CSP_EXTRA_CONNECT_SRC = (process.env.CSP_CONNECT_SRC || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CSP_EXTRA_SCRIPT_SRC = (process.env.CSP_SCRIPT_SRC || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

function isHtmlResponse(res) {
  const contentType = res.getHeader('Content-Type');
  return typeof contentType === 'string' && contentType.includes('text/html');
}

export function createCspNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');

  // Inject cryptographically secure nonce on HTML response headers.
  // Also expose on responses so downstream HTML renderers can consume it.
  res.setHeader('X-CSP-Nonce', res.locals.cspNonce);

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    const result = originalSetHeader(name, value);
    if (String(name).toLowerCase() === 'content-type' && isHtmlResponse(res)) {
      originalSetHeader('X-CSP-Nonce', res.locals.cspNonce);
    }
    return result;
  };

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
          "'wasm-unsafe-eval'",
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
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    hidePoweredBy: true,
    noSniff: true,
    dnsPrefetchControl: { allow: false },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
  });
}

export function applySecurityHeaders(app) {
  app.disable('x-powered-by');
  app.use(createCspNonce);
  app.use(buildHelmetMiddleware());

  // Enforce strict Permissions-Policy disabling microphone, camera, and geolocation access.
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  });
}

export default applySecurityHeaders;
