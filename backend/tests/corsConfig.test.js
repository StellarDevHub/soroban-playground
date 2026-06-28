import {
  createCorsOptions,
  parseCorsOrigins,
  compileOriginPattern,
  buildOriginMatcher,
} from '../src/config/cors.js';

const resolveOrigin = (originOption, origin) =>
  new Promise((resolve, reject) => {
    originOption(origin, (err, allowed) => {
      if (err) reject(err);
      resolve(allowed);
    });
  });

describe('CORS configuration', () => {
  it('keeps permissive defaults for backwards compatibility', () => {
    const options = createCorsOptions({});

    expect(options.origin).toBe('*');
    expect(options.credentials).toBe(false);
    expect(options.methods).toEqual([
      'GET',
      'HEAD',
      'PUT',
      'PATCH',
      'POST',
      'DELETE',
    ]);
    expect(options.allowedHeaders).toBeUndefined();
  });

  it('uses configured allowed headers when provided', () => {
    const options = createCorsOptions({
      CORS_ALLOWED_HEADERS: 'Content-Type,Authorization',
    });

    expect(options.allowedHeaders).toEqual(['Content-Type', 'Authorization']);
  });

  it('parses and deduplicates configured origins', () => {
    expect(
      parseCorsOrigins(
        'https://playground.example, https://docs.example, https://playground.example'
      )
    ).toEqual({
      allowAll: false,
      origins: ['https://playground.example', 'https://docs.example'],
    });
  });

  it('treats a wildcard origin as allow all', () => {
    expect(parseCorsOrigins('https://playground.example,*')).toEqual({
      allowAll: true,
      origins: [],
    });
  });

  it('allows only configured browser origins when an allowlist is present', async () => {
    const options = createCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://playground.example,https://docs.example',
    });

    await expect(
      resolveOrigin(options.origin, 'https://playground.example')
    ).resolves.toBe(true);
    await expect(
      resolveOrigin(options.origin, 'https://blocked.example')
    ).resolves.toBe(false);
  });

  it('continues to allow requests without an Origin header', async () => {
    const options = createCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://playground.example',
    });

    await expect(resolveOrigin(options.origin, undefined)).resolves.toBe(true);
  });

  it('reflects origins when credentials are enabled with permissive origins', () => {
    const options = createCorsOptions({
      CORS_ALLOW_CREDENTIALS: 'true',
    });

    expect(options.origin).toBe(true);
    expect(options.credentials).toBe(true);
  });

  it('sets Access-Control-Max-Age from env', () => {
    const options = createCorsOptions({ CORS_MAX_AGE_SECONDS: '3600' });
    expect(options.maxAge).toBe(3600);
  });

  it('falls back to default max-age for invalid values', () => {
    const options = createCorsOptions({ CORS_MAX_AGE_SECONDS: 'bad' });
    expect(options.maxAge).toBe(86400);
  });

  it('blocks preflight on invalid origin when allowlist is configured', async () => {
    const options = createCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://safe.example',
    });
    await expect(
      resolveOrigin(options.origin, 'https://evil.example')
    ).resolves.toBe(false);
  });

  it('sets exposed headers when configured', () => {
    const options = createCorsOptions({
      CORS_EXPOSED_HEADERS: 'X-Request-ID,X-Rate-Limit',
    });
    expect(options.exposedHeaders).toEqual(['X-Request-ID', 'X-Rate-Limit']);
  });
});

describe('compileOriginPattern', () => {
  it('returns null for non-wildcard patterns', () => {
    expect(compileOriginPattern('https://example.com')).toBeNull();
  });

  it('matches a single subdomain wildcard', () => {
    const re = compileOriginPattern('https://*.example.com');
    expect(re.test('https://app.example.com')).toBe(true);
    expect(re.test('https://api.example.com')).toBe(true);
  });

  it('does not match multi-level subdomains with a single wildcard', () => {
    const re = compileOriginPattern('https://*.example.com');
    expect(re.test('https://deep.sub.example.com')).toBe(false);
  });

  it('does not match an unrelated domain', () => {
    const re = compileOriginPattern('https://*.example.com');
    expect(re.test('https://attacker.com')).toBe(false);
  });
});

describe('buildOriginMatcher', () => {
  it('allows exact origins', () => {
    const isAllowed = buildOriginMatcher(['https://app.example.com']);
    expect(isAllowed('https://app.example.com')).toBe(true);
    expect(isAllowed('https://other.example.com')).toBe(false);
  });

  it('allows wildcard-matched subdomains', () => {
    const isAllowed = buildOriginMatcher(['https://*.example.com']);
    expect(isAllowed('https://foo.example.com')).toBe(true);
    expect(isAllowed('https://bar.example.com')).toBe(true);
    expect(isAllowed('https://evil.com')).toBe(false);
  });

  it('allows requests with no Origin header (server-to-server)', () => {
    const isAllowed = buildOriginMatcher(['https://app.example.com']);
    expect(isAllowed(undefined)).toBe(true);
    expect(isAllowed(null)).toBe(true);
  });

  it('merges exact and wildcard origins', () => {
    const isAllowed = buildOriginMatcher([
      'https://exact.example.com',
      'https://*.partner.com',
    ]);
    expect(isAllowed('https://exact.example.com')).toBe(true);
    expect(isAllowed('https://api.partner.com')).toBe(true);
    expect(isAllowed('https://sneaky.com')).toBe(false);
  });
});

describe('createCorsOptions with dynamic origins', () => {
  it('merges dynamic origins with env-configured origins', async () => {
    const options = createCorsOptions(
      { CORS_ALLOWED_ORIGINS: 'https://static.example.com' },
      ['https://dynamic.example.com']
    );

    await expect(
      resolveOrigin(options.origin, 'https://static.example.com')
    ).resolves.toBe(true);
    await expect(
      resolveOrigin(options.origin, 'https://dynamic.example.com')
    ).resolves.toBe(true);
    await expect(
      resolveOrigin(options.origin, 'https://blocked.example.com')
    ).resolves.toBe(false);
  });

  it('activates wildcard dynamic origins', async () => {
    const options = createCorsOptions({}, ['https://*.trusted.com']);

    await expect(
      resolveOrigin(options.origin, 'https://app.trusted.com')
    ).resolves.toBe(true);
    await expect(
      resolveOrigin(options.origin, 'https://evil.com')
    ).resolves.toBe(false);
  });
});
