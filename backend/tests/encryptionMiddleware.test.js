import {
  createEncryptionMiddleware,
  encryptResponse,
  generateServerKeyPair,
} from '../src/middleware/encryptionMiddleware.js';
import {
  generateSessionKey,
  aesEncrypt,
  signRequest,
  sha256Hex,
} from '../src/utils/cryptoUtils.js';

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = jest.fn((s) => { res._status = s; return res; });
  res.json = jest.fn((b) => { res._body = b; return res; });
  return res;
}

function makeEncryptedReq(payload, sessionKey, { privateKey = null, nonce = 'unique-nonce-001', timestamp = null } = {}) {
  const ts = timestamp || new Date().toISOString();
  const encrypted = aesEncrypt(JSON.stringify(payload), sessionKey);
  const sessionKeyHeader = sessionKey.toString('base64');
  const bodyHash = sha256Hex(JSON.stringify(encrypted));
  const signature = privateKey
    ? signRequest(privateKey, 'POST', '/api/secure', ts, bodyHash)
    : 'test-sig';

  return {
    method: 'POST',
    path: '/api/secure',
    headers: {
      'x-encrypted': 'true',
      'x-session-key': sessionKeyHeader,
      'x-request-timestamp': ts,
      'x-request-nonce': nonce,
      'x-request-signature': signature,
    },
    body: encrypted,
    isEncrypted: false,
  };
}

describe('createEncryptionMiddleware', () => {
  let sessionKey;

  beforeEach(() => {
    sessionKey = generateSessionKey();
  });

  describe('enforcement', () => {
    it('rejects unencrypted requests when enforceEncryption=true', async () => {
      const mw = createEncryptionMiddleware({ enforceEncryption: true });
      const res = makeRes();
      const req = { headers: {}, body: {}, method: 'POST', path: '/api/test' };
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('Encryption Required');
    });

    it('passes through when enforceEncryption=false and no X-Encrypted header', async () => {
      const mw = createEncryptionMiddleware({ enforceEncryption: false });
      const next = jest.fn();
      await mw({ headers: {}, body: {}, method: 'GET', path: '/api' }, makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('missing headers', () => {
    it('returns 400 when X-Session-Key is missing', async () => {
      const mw = createEncryptionMiddleware({});
      const res = makeRes();
      const req = {
        method: 'POST', path: '/test',
        headers: { 'x-encrypted': 'true', 'x-request-timestamp': new Date().toISOString(), 'x-request-nonce': 'n1', 'x-request-signature': 's1' },
        body: {},
      };
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/Missing/);
    });
  });

  describe('replay attack prevention', () => {
    it('rejects a request with an expired timestamp', async () => {
      const mw = createEncryptionMiddleware({});
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
      const req = makeEncryptedReq({ data: 'hello' }, sessionKey, { timestamp: oldTimestamp, nonce: 'unique-old-nonce' });
      const res = makeRes();
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/Replay/);
    });

    it('rejects duplicate nonces', async () => {
      const mw = createEncryptionMiddleware({});
      const req1 = makeEncryptedReq({ data: 'first' }, sessionKey, { nonce: 'dup-nonce-xyz' });
      const req2 = makeEncryptedReq({ data: 'second' }, sessionKey, { nonce: 'dup-nonce-xyz' });

      await mw(req1, makeRes(), jest.fn());
      const res2 = makeRes();
      await mw(req2, res2, jest.fn());
      expect(res2._status).toBe(400);
      expect(res2._body.error).toMatch(/Replay/);
    });
  });

  describe('successful decryption', () => {
    it('decrypts payload and populates req.body', async () => {
      const mw = createEncryptionMiddleware({ enforceEncryption: false });
      const next = jest.fn();
      const payload = { userId: 42, action: 'transfer' };
      const req = makeEncryptedReq(payload, sessionKey, { nonce: 'nonce-success-1' });

      await mw(req, makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.body).toEqual(payload);
      expect(req.isEncrypted).toBe(true);
    });

    it('returns 400 for invalid ciphertext', async () => {
      const mw = createEncryptionMiddleware({});
      const res = makeRes();
      const req = {
        method: 'POST', path: '/test',
        headers: {
          'x-encrypted': 'true',
          'x-session-key': sessionKey.toString('base64'),
          'x-request-timestamp': new Date().toISOString(),
          'x-request-nonce': 'nonce-bad-ct',
          'x-request-signature': 'sig',
        },
        body: { iv: 'bad', ciphertext: 'bad', tag: 'bad' },
      };
      await mw(req, res, jest.fn());
      expect(res._status).toBe(400);
    });
  });

  describe('signature verification', () => {
    it('rejects requests with an invalid signature when publicKeyPem is set', async () => {
      const { publicKey, privateKey } = generateServerKeyPair();
      const mw = createEncryptionMiddleware({ publicKeyPem: publicKey });
      const res = makeRes();
      const req = makeEncryptedReq({ data: 'test' }, sessionKey, {
        privateKey: null,
        nonce: 'sig-test-nonce-001',
      });
      // Override signature with garbage
      req.headers['x-request-signature'] = 'invalidsig==';
      await mw(req, res, jest.fn());
      expect(res._status).toBe(401);
      expect(res._body.error).toMatch(/Signature/);
    });

    it('accepts requests with a valid RSA signature', async () => {
      const { publicKey, privateKey } = generateServerKeyPair();
      const mw = createEncryptionMiddleware({ publicKeyPem: publicKey });
      const next = jest.fn();
      const req = makeEncryptedReq({ data: 'signed' }, sessionKey, {
        privateKey,
        nonce: 'sig-valid-nonce-001',
      });
      await mw(req, makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

describe('encryptResponse', () => {
  it('returns an object with iv, ciphertext, and tag', () => {
    const key = generateSessionKey();
    const result = encryptResponse({ message: 'hello' }, key);
    expect(result).toHaveProperty('iv');
    expect(result).toHaveProperty('ciphertext');
    expect(result).toHaveProperty('tag');
  });
});

describe('generateServerKeyPair', () => {
  it('returns PEM-formatted public and private keys', () => {
    const { publicKey, privateKey } = generateServerKeyPair();
    expect(publicKey).toContain('BEGIN PUBLIC KEY');
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
  });
});

describe('cryptoUtils AES round-trip', () => {
  it('encrypts and decrypts correctly', () => {
    const { aesDecrypt } = require('../src/utils/cryptoUtils.js');
    const key = generateSessionKey();
    const original = 'secret payload 🔐';
    const { aesEncrypt: enc } = require('../src/utils/cryptoUtils.js');
    const encrypted = enc(original, key);
    const decrypted = aesDecrypt(encrypted, key).toString('utf8');
    expect(decrypted).toBe(original);
  });
});
