import {
  KmsService,
  LocalMasterKeyProvider,
  VaultTransitProvider,
  createKeyProvider,
} from '../src/services/kmsService.js';

describe('KmsService', () => {
  let service;

  beforeEach(() => {
    service = new KmsService({
      provider: new LocalMasterKeyProvider('unit-test-master'),
      graceMs: 60_000,
    });
  });

  afterEach(() => service.stop());

  it('stores faucet secrets as envelope ciphertext, not plaintext', async () => {
    await service.storeFaucetKey({
      alias: 'testnet-faucet',
      secret: 'SSECRETFAUCETKEYMATERIAL0001',
      network: 'testnet',
    });

    const record = service.store.get('testnet-faucet');
    expect(JSON.stringify(record.current)).not.toContain(
      'SSECRETFAUCETKEYMATERIAL0001'
    );
    expect(record.current.ciphertext).toBeDefined();
    expect(record.current.wrappedDek).toBeDefined();
    expect(record.current.iv).toBeDefined();
    expect(record.current.tag).toBeDefined();
  });

  it('unwraps a faucet key after a local envelope round-trip', async () => {
    await service.storeFaucetKey({
      alias: 'faucet-a',
      secret: 'super-secret-seed',
    });

    await expect(service.getFaucetKey('faucet-a')).resolves.toBe(
      'super-secret-seed'
    );
  });

  it('rotates a key and keeps the previous envelope during the grace window', async () => {
    await service.storeFaucetKey({
      alias: 'rotating',
      secret: 'old-secret',
    });
    await service.rotateFaucetKey('rotating', { secret: 'new-secret' });

    const described = service.describe('rotating');
    expect(described.version).toBe(2);
    expect(described.hasPrevious).toBe(true);
    await expect(service.getFaucetKey('rotating')).resolves.toBe('new-secret');
  });

  it('lists aliases without returning secret material', async () => {
    await service.storeFaucetKey({
      alias: 'visible',
      secret: 'must-not-leak',
      metadata: { account: 'GTEST' },
    });

    const listed = service.listAliases();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('must-not-leak');
    expect(listed[0].metadata.account).toBe('GTEST');
  });

  it('rejects malformed aliases', async () => {
    await expect(
      service.storeFaucetKey({ alias: '../etc/passwd', secret: 'abc12345' })
    ).rejects.toThrow('Invalid faucet key alias');
  });

  it('destroys a stored key', async () => {
    await service.storeFaucetKey({ alias: 'gone', secret: 'abc12345' });
    await expect(service.destroy('gone')).resolves.toBe(true);
    await expect(service.getFaucetKey('gone')).rejects.toThrow('Unknown');
  });

  it('rotates keys that have exceeded the interval', async () => {
    const rotating = new KmsService({
      provider: new LocalMasterKeyProvider('unit-test-master'),
      rotationMs: 10,
    });
    await rotating.storeFaucetKey({ alias: 'aged', secret: 'abc12345' });
    rotating.store.get('aged').rotatedAt = new Date(Date.now() - 50).toISOString();

    const rotated = await rotating.rotateDueKeys();
    expect(rotated).toEqual(['aged']);
    expect(rotating.describe('aged').version).toBe(2);
    rotating.stop();
  });
});

describe('createKeyProvider', () => {
  it('defaults to the local master-key provider', () => {
    expect(createKeyProvider('local')).toBeInstanceOf(LocalMasterKeyProvider);
  });
});

describe('VaultTransitProvider', () => {
  it('wraps and unwraps a DEK through the transit engine', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      if (String(url).includes('/encrypt/')) {
        return {
          ok: true,
          json: async () => ({
            data: { ciphertext: `vault:v1:${body.plaintext}` },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: { plaintext: body.ciphertext.replace('vault:v1:', '') },
        }),
      };
    });

    const vault = new VaultTransitProvider({
      address: 'http://vault.local',
      token: 'root',
      fetchImpl,
    });
    const dek = Buffer.from('12345678901234567890123456789012');
    const wrapped = await vault.wrap(dek);
    const unwrapped = await vault.unwrap(wrapped);
    expect(unwrapped.equals(dek)).toBe(true);
  });
});
