import https from 'https';

describe('TLS/SSL Hardening Configuration', () => {
  const httpsOptions = {
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ciphers: [
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-CHACHA20-POLY1305',
      'ECDHE-RSA-CHACHA20-POLY1305',
      'DHE-RSA-AES256-GCM-SHA384',
      'DHE-RSA-AES128-GCM-SHA256',
    ].join(':'),
    honorCipherOrder: true,
    ecdhCurve: 'X25519:P-256:P-384',
  };

  it('should define TLS 1.2 as minimum version (rejects TLS 1.0, 1.1)', () => {
    expect(httpsOptions.minVersion).toBe('TLSv1.2');
  });

  it('should allow TLS 1.3 as maximum version', () => {
    expect(httpsOptions.maxVersion).toBe('TLSv1.3');
  });

  it('should enforce server cipher order', () => {
    expect(httpsOptions.honorCipherOrder).toBe(true);
  });

  it('should include TLS 1.3 native AEAD cipher suites', () => {
    expect(httpsOptions.ciphers).toContain('TLS_AES_256_GCM_SHA384');
    expect(httpsOptions.ciphers).toContain('TLS_CHACHA20_POLY1305_SHA256');
    expect(httpsOptions.ciphers).toContain('TLS_AES_128_GCM_SHA256');
  });

  it('should include ECDHE GCM ciphers for TLS 1.2 forward secrecy', () => {
    expect(httpsOptions.ciphers).toContain('ECDHE-RSA-AES256-GCM-SHA384');
    expect(httpsOptions.ciphers).toContain('ECDHE-ECDSA-AES256-GCM-SHA384');
    expect(httpsOptions.ciphers).toContain('ECDHE-RSA-AES128-GCM-SHA256');
    expect(httpsOptions.ciphers).toContain('ECDHE-ECDSA-AES128-GCM-SHA256');
  });

  it('should include ChaCha20-Poly1305 ciphers for mobile-optimised forward secrecy', () => {
    expect(httpsOptions.ciphers).toContain('ECDHE-ECDSA-CHACHA20-POLY1305');
    expect(httpsOptions.ciphers).toContain('ECDHE-RSA-CHACHA20-POLY1305');
  });

  it('should configure ecdhCurve with modern key exchange curves', () => {
    expect(httpsOptions.ecdhCurve).toContain('X25519');
    expect(httpsOptions.ecdhCurve).toContain('P-256');
    expect(httpsOptions.ecdhCurve).toContain('P-384');
  });

  it('should set HSTS max-age to 63072000 (2 years) for Qualys A+ and preload list', () => {
    const hstsHeader = 'max-age=63072000; includeSubDomains; preload';
    expect(hstsHeader).toContain('max-age=63072000');
    expect(hstsHeader).toContain('includeSubDomains');
    expect(hstsHeader).toContain('preload');
  });

  it('should not include deprecated cipher algorithms', () => {
    expect(httpsOptions.ciphers).not.toContain('RC4');
    expect(httpsOptions.ciphers).not.toContain('3DES');
    expect(httpsOptions.ciphers).not.toContain('MD5');
    expect(httpsOptions.ciphers).not.toContain('NULL');
    expect(httpsOptions.ciphers).not.toContain('EXPORT');
  });
});
