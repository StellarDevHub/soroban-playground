/**
 * Redis-backed session store and Express middleware (#765)
 *
 * Provides:
 *   - RedisSessionStore — low-level CRUD over Redis with TTL
 *   - createSessionMiddleware(redis, options) — Express middleware that reads /
 *     writes sessions from `X-Session-Id` header (for API clients) or from a
 *     secure HttpOnly cookie named `sid` (for browser clients)
 *
 * Cookie defaults: HttpOnly, Secure (configurable), SameSite=Strict, TTL=24 h.
 */

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 h
const KEY_PREFIX = 'session:';

export class RedisSessionStore {
  constructor(redis, ttlSeconds = DEFAULT_TTL_SECONDS) {
    this._redis = redis;
    this._ttl = ttlSeconds;
  }

  _key(sid) {
    return `${KEY_PREFIX}${sid}`;
  }

  async get(sid) {
    const raw = await this._redis.get(this._key(sid));
    return raw ? JSON.parse(raw) : null;
  }

  async set(sid, data) {
    await this._redis.set(
      this._key(sid),
      JSON.stringify(data),
      'EX',
      this._ttl
    );
  }

  async destroy(sid) {
    await this._redis.del(this._key(sid));
  }

  /** Refresh TTL without changing session data. */
  async touch(sid) {
    await this._redis.expire(this._key(sid), this._ttl);
  }
}

function generateSessionId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Express middleware factory.
 *
 * @param {object} redis   - ioredis-compatible client
 * @param {object} options
 * @param {number} [options.ttlSeconds=86400]
 * @param {boolean} [options.secure=true]   - cookie Secure flag
 * @param {string}  [options.cookieName='sid']
 */
export function createSessionMiddleware(redis, options = {}) {
  const {
    ttlSeconds = DEFAULT_TTL_SECONDS,
    secure = process.env.NODE_ENV === 'production',
    cookieName = 'sid',
  } = options;

  const store = new RedisSessionStore(redis, ttlSeconds);

  return async function sessionMiddleware(req, res, next) {
    // Resolve session ID from cookie or X-Session-Id header
    let sid =
      parseCookies(req.headers.cookie)[cookieName] ||
      req.headers['x-session-id'];

    let session = null;
    let isNew = false;

    if (sid) {
      try {
        session = await store.get(sid);
      } catch (_) {
        session = null;
      }
    }

    if (!session) {
      sid = generateSessionId();
      session = {};
      isNew = true;
    }

    req.session = session;
    req.sessionId = sid;

    req.destroySession = async () => {
      await store.destroy(sid);
      req.session = {};
    };

    req.regenerateSession = async () => {
      await store.destroy(sid);
      sid = generateSessionId();
      req.sessionId = sid;
      req.session = {};
    };

    // Intercept res.end to persist the session and set the cookie before headers flush
    const originalEnd = res.end.bind(res);
    res.end = async function (...args) {
      try {
        if (Object.keys(req.session).length > 0) {
          await store.set(sid, req.session);
          if (!res.headersSent) {
            const cookieVal = serializeCookie(cookieName, sid, {
              httpOnly: true,
              secure,
              sameSite: 'Strict',
              maxAge: ttlSeconds,
              path: '/',
            });
            res.setHeader('Set-Cookie', cookieVal);
          }
        } else if (!isNew) {
          await store.destroy(sid);
        }
      } catch (_) {
        // Session persistence failure is non-fatal
      }
      return originalEnd(...args);
    };

    next();
  };
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (k)
      acc[decodeURIComponent(k.trim())] = decodeURIComponent(
        v.join('=').trim()
      );
    return acc;
  }, {});
}

function serializeCookie(name, value, opts = {}) {
  let str = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  if (opts.httpOnly) str += '; HttpOnly';
  if (opts.secure) str += '; Secure';
  if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
  if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
  if (opts.path) str += `; Path=${opts.path}`;
  return str;
}
