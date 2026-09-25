import { resolveClientIp } from '../src/middleware/clientIp.js';

// Issue #1574 — trusted-proxy IP resolution must not be spoofable.
describe('resolveClientIp spoofing defence', () => {
  const resolve = (headers, remoteAddress, options = {}) =>
    resolveClientIp(
      { headers, socket: { remoteAddress } },
      { trustProxy: true, ...options }
    );

  it('ignores X-Forwarded-For when the TCP peer is not a trusted proxy', () => {
    expect(resolve({ 'x-forwarded-for': '198.51.100.1' }, '203.0.113.9')).toBe(
      '203.0.113.9'
    );
  });

  it('ignores CF-Connecting-IP / X-Real-IP from untrusted peers', () => {
    expect(
      resolve(
        { 'cf-connecting-ip': '198.51.100.1', 'x-real-ip': '198.51.100.2' },
        '203.0.113.9'
      )
    ).toBe('203.0.113.9');
  });

  it('ignores addresses a client prepends to X-Forwarded-For', () => {
    // Client sent "X-Forwarded-For: 1.2.3.4"; our proxy appended the real
    // client address 203.0.113.50 and connected from 10.0.0.1.
    expect(
      resolve({ 'x-forwarded-for': '1.2.3.4, 203.0.113.50' }, '10.0.0.1')
    ).toBe('203.0.113.50');
  });

  it('skips multiple trusted proxy hops', () => {
    expect(
      resolve(
        { 'x-forwarded-for': '1.2.3.4, 203.0.113.50, 10.0.0.3, 10.0.0.2' },
        '10.0.0.1'
      )
    ).toBe('203.0.113.50');
  });

  it('caps skipped hops with trustProxyHops', () => {
    expect(
      resolve({ 'x-forwarded-for': '203.0.113.50, 10.0.0.2' }, '10.0.0.1', {
        trustProxyHops: 1,
      })
    ).toBe('10.0.0.2');
  });

  it('honours a custom TRUSTED_PROXIES list', () => {
    const headers = { 'x-forwarded-for': '203.0.113.50' };
    expect(
      resolve(headers, '198.51.100.7', { trustedProxies: ['198.51.100.0/24'] })
    ).toBe('203.0.113.50');
    expect(resolve(headers, '198.51.100.7')).toBe('198.51.100.7');
  });

  it('skips malformed X-Forwarded-For entries', () => {
    expect(resolve({ 'x-forwarded-for': 'not-an-ip' }, '10.0.0.1')).toBe(
      '10.0.0.1'
    );
  });

  it('never reads headers when trust proxy is disabled', () => {
    expect(
      resolve({ 'x-forwarded-for': '203.0.113.50' }, '10.0.0.1', {
        trustProxy: false,
      })
    ).toBe('10.0.0.1');
  });

  it('normalises IPv4-mapped IPv6 peers', () => {
    expect(resolve({}, '::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
});
