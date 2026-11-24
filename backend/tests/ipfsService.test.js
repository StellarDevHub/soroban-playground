// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  IpfsService,
  IpfsResolutionError,
  computeRawCidV1,
  verifyContent,
} from '../src/services/ipfsService.js';

// `hello world` as UnixFS (Pinata defaults) and as a single raw block.
const CONTENT = Buffer.from('hello world');
const UNIXFS_CID =
  'bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa';
const RAW_CID = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';

const GATEWAYS = [
  { name: 'cloudflare', baseUrl: 'https://cloudflare-ipfs.com/ipfs/' },
  { name: 'ipfs.io', baseUrl: 'https://ipfs.io/ipfs/' },
  { name: 'pinata', baseUrl: 'https://gateway.pinata.cloud/ipfs/' },
  { name: 'infura', baseUrl: 'https://ipfs.infura.io/ipfs/' },
];

function response(body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = new Map(
    Object.entries(
      options.headers ?? {
        'content-type': 'application/json',
      }
    ).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    arrayBuffer: async () => {
      const copy = new Uint8Array(bytes);
      return copy.buffer;
    },
  };
}

function createRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (key) => store.get(key) ?? null),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return 'OK';
    }),
    delete: jest.fn(async (key) => {
      store.delete(key);
      return 1;
    }),
  };
}

function createStorage() {
  const objects = new Map();
  return {
    objects,
    exists: jest.fn(async (key) => objects.has(key)),
    download: jest.fn(async (key) => objects.get(key)),
    putObject: jest.fn(async (key, value) => {
      objects.set(key, Buffer.from(value));
      return { key };
    }),
    delete: jest.fn(async (key) => {
      objects.delete(key);
      return true;
    }),
  };
}

function createService(fetchImpl, overrides = {}) {
  return new IpfsService({
    gateways: GATEWAYS,
    fetchImpl,
    redis: null,
    storage: null,
    timeoutMs: 50,
    ...overrides,
  });
}

describe('ipfsService', () => {
  it('computes CIDs that match the canonical IPFS values', () => {
    expect(computeRawCidV1(CONTENT)).toBe(RAW_CID);
    expect(verifyContent(UNIXFS_CID, CONTENT).verified).toBe(true);
    expect(verifyContent(RAW_CID, CONTENT).verified).toBe(true);
    expect(verifyContent(UNIXFS_CID, Buffer.from('tampered')).verified).toBe(
      false
    );
  });

  it('falls back to the next gateway after an HTTP 504 timeout', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('cloudflare')) {
        return response('gateway timeout', { ok: false, status: 504 });
      }
      return response(CONTENT);
    });

    const service = createService(fetchImpl);
    const result = await service.resolve(UNIXFS_CID);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toBe(
      `https://ipfs.io/ipfs/${UNIXFS_CID}`
    );
    expect(result.gateway).toBe('ipfs.io');
    expect(result.verified).toBe(true);
    expect(result.bytes.equals(CONTENT)).toBe(true);
    expect(result.attempts).toEqual([
      expect.objectContaining({ gateway: 'cloudflare', status: 504 }),
    ]);
  });

  it('aborts a slow gateway and continues the pool', async () => {
    const fetchImpl = jest.fn((url, init) => {
      if (String(url).includes('cloudflare')) {
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        });
      }
      return Promise.resolve(response(CONTENT));
    });

    const service = createService(fetchImpl, { timeoutMs: 10 });
    const result = await service.resolve(UNIXFS_CID);

    expect(result.gateway).toBe('ipfs.io');
    expect(result.attempts[0]).toMatchObject({ gateway: 'cloudflare' });
  });

  it('rejects a spoofed payload that does not match the CID', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('cloudflare')) {
        return response('not the requested content');
      }
      return response(CONTENT);
    });

    const service = createService(fetchImpl);
    const result = await service.resolve(UNIXFS_CID);

    expect(result.gateway).toBe('ipfs.io');
    expect(result.bytes.equals(CONTENT)).toBe(true);
    expect(result.attempts[0].error).toMatch(/CID verification failed/);
  });

  it('fails rather than returning unverified bytes from every gateway', async () => {
    const fetchImpl = jest.fn(async () => response('spoofed metadata'));

    const service = createService(fetchImpl);

    await expect(service.resolve(UNIXFS_CID)).rejects.toBeInstanceOf(
      IpfsResolutionError
    );
    await expect(service.resolve(UNIXFS_CID)).rejects.toMatchObject({
      attempts: expect.arrayContaining([
        expect.objectContaining({ gateway: 'infura' }),
      ]),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(GATEWAYS.length * 2);
  });

  it('caches verified documents in Redis and S3 and serves them without refetching', async () => {
    const fetchImpl = jest.fn(async () => response(CONTENT));
    const redis = createRedis();
    const storage = createStorage();
    const service = createService(fetchImpl, { redis, storage });

    const first = await service.resolve(UNIXFS_CID);
    expect(first.cached).toBe(false);
    expect(redis.set).toHaveBeenCalledWith(
      `ipfs:content:${UNIXFS_CID}`,
      expect.any(String),
      expect.any(Number)
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      `ipfs-cache/${UNIXFS_CID}`,
      CONTENT,
      expect.objectContaining({ cid: UNIXFS_CID })
    );

    fetchImpl.mockClear();
    const second = await service.resolve(UNIXFS_CID);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(second).toMatchObject({ cached: true, cacheSource: 'redis' });
    expect(second.bytes.equals(CONTENT)).toBe(true);
  });

  it('rejects a corrupted cache entry and refetches from a gateway', async () => {
    const redis = createRedis();
    const storage = createStorage();
    redis.store.set(
      `ipfs:content:${UNIXFS_CID}`,
      JSON.stringify({
        cid: UNIXFS_CID,
        contentType: 'application/json',
        data: Buffer.from('corrupted').toString('base64'),
      })
    );

    const fetchImpl = jest.fn(async () => response(CONTENT));
    const service = createService(fetchImpl, { redis, storage });

    const result = await service.resolve(UNIXFS_CID);

    expect(result.cached).toBe(false);
    expect(result.gateway).toBe('cloudflare');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(redis.delete).toHaveBeenCalledWith(`ipfs:content:${UNIXFS_CID}`);
  });

  it('serves an S3 cache hit when Redis is unavailable', async () => {
    const storage = createStorage();
    storage.objects.set(`ipfs-cache/${UNIXFS_CID}`, CONTENT);
    const fetchImpl = jest.fn(async () => response(CONTENT));
    const service = createService(fetchImpl, { storage });

    const result = await service.resolve(UNIXFS_CID);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cached: true, cacheSource: 's3' });
  });

  it('ignores cached bytes whose content no longer matches the CID', async () => {
    const storage = createStorage();
    storage.objects.set(`ipfs-cache/${UNIXFS_CID}`, Buffer.from('corrupted'));
    const fetchImpl = jest.fn(async () => response(CONTENT));
    const service = createService(fetchImpl, { storage });

    const result = await service.resolve(UNIXFS_CID);

    expect(result.cached).toBe(false);
    expect(storage.delete).toHaveBeenCalledWith(`ipfs-cache/${UNIXFS_CID}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed CIDs before making any gateway request', async () => {
    const fetchImpl = jest.fn();
    const service = createService(fetchImpl);

    await expect(service.resolve('not-a-cid')).rejects.toThrow(
      /Invalid IPFS CID/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
