import { createCorsOptions, parseCorsOrigins } from '../src/config/cors.js';

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
});
