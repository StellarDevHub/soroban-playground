// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// IPFS retrieval with multi-gateway failover, content-addressing verification
// and local caching.
//
// Every gateway response is checked against the requested CID before it is
// returned to a client or written to a cache. Cached copies are re-verified on
// read so a corrupted Redis/S3 entry can never be served as valid IPFS content.

import crypto from 'crypto';
import redisService from './redisService.js';

export const DEFAULT_IPFS_GATEWAYS = [
  { name: 'ipfs.io', baseUrl: 'https://ipfs.io/ipfs/' },
  { name: 'cloudflare', baseUrl: 'https://cloudflare-ipfs.com/ipfs/' },
  { name: 'pinata', baseUrl: 'https://gateway.pinata.cloud/ipfs/' },
  { name: 'infura', baseUrl: 'https://ipfs.infura.io/ipfs/' },
];

export const DEFAULT_GATEWAY_TIMEOUT_MS = 8_000;
export const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_MAX_CONTENT_BYTES = 25 * 1024 * 1024;

export const IPFS_CHUNK_SIZE = 262_144;
export const IPFS_MAX_CHILDREN = 174;

const CODEC_RAW = 0x55;
const CODEC_DAG_PB = 0x70;
const MULTIHASH_SHA2_256 = 0x12;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const REDIS_KEY_PREFIX = 'ipfs:content:';
const S3_KEY_PREFIX = 'ipfs-cache/';

export class InvalidCidError extends Error {
  constructor(cid) {
    super(`Invalid IPFS CID: ${cid}`);
    this.name = 'InvalidCidError';
    this.cid = cid;
  }
}

export class IpfsResolutionError extends Error {
  constructor(cid, attempts) {
    const detail = attempts
      .map(
        (attempt) =>
          `${attempt.gateway}: ${
            attempt.error || `HTTP ${attempt.status ?? 'unknown'}`
          }`
      )
      .join('; ');
    super(
      `Unable to retrieve verified content for ${cid} from any IPFS gateway${
        detail ? ` (${detail})` : ''
      }`
    );
    this.name = 'IpfsResolutionError';
    this.cid = cid;
    this.attempts = attempts;
  }
}

// ── Multibase / multihash helpers ────────────────────────────────────────────

function encodeVarint(value) {
  const out = [];
  let remainder = value;
  while (remainder >= 0x80) {
    out.push((remainder & 0x7f) | 0x80);
    remainder = Math.floor(remainder / 128);
  }
  out.push(remainder);
  return out;
}

function decodeVarint(bytes, start = 0) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    offset += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    shift += 7;
    if (shift > 49) break;
  }
  throw new Error('Malformed varint in CID');
}

function base32Encode(bytes) {
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 0x1f];
    }

    buffer &= (1 << bits) - 1;
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }

  return output;
}

function base32Decode(input) {
  const value = input.toLowerCase();
  let buffer = 0;
  let bits = 0;
  const out = [];

  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in CID');
    buffer = (buffer << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }

    buffer &= (1 << bits) - 1;
  }

  return Buffer.from(out);
}

function base58Decode(input) {
  let value = 0n;
  for (const char of input) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base58 character in CID');
    value = value * 58n + BigInt(index);
  }

  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }

  for (const char of input) {
    if (char !== '1') break;
    bytes.unshift(0);
  }

  return Buffer.from(bytes);
}

/**
 * Decode a CIDv0 or CIDv1 string into its codec and SHA-256 digest.
 * @param {string} cid
 * @returns {{version:number,codec:number,multihashCode:number,digest:Buffer,bytes:Buffer}}
 */
export function parseCid(cid) {
  if (typeof cid !== 'string' || cid.trim() === '') {
    throw new InvalidCidError(cid);
  }

  const value = cid.trim();

  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) {
    const decoded = base58Decode(value);
    const multihashCode = decodeVarint(decoded, 0);
    const length = decodeVarint(decoded, multihashCode.offset);
    const digest = decoded.subarray(
      length.offset,
      length.offset + length.value
    );
    if (
      multihashCode.value !== MULTIHASH_SHA2_256 ||
      digest.length !== 32 ||
      length.offset + length.value !== decoded.length
    ) {
      throw new InvalidCidError(cid);
    }
    return {
      version: 0,
      codec: CODEC_DAG_PB,
      multihashCode: multihashCode.value,
      digest,
      bytes: decoded,
    };
  }

  const prefix = value[0];
  let bytes;
  if (prefix === 'b' || prefix === 'B') {
    bytes = base32Decode(value.slice(1));
  } else if (prefix === 'z') {
    bytes = base58Decode(value.slice(1));
  } else if (prefix === 'f' || prefix === 'F') {
    bytes = Buffer.from(value.slice(1), 'hex');
  } else {
    throw new InvalidCidError(cid);
  }

  try {
    const version = decodeVarint(bytes, 0);
    if (version.value !== 1) throw new InvalidCidError(cid);
    const codec = decodeVarint(bytes, version.offset);
    const multihashCode = decodeVarint(bytes, codec.offset);
    const length = decodeVarint(bytes, multihashCode.offset);
    const digest = bytes.subarray(length.offset, length.offset + length.value);

    if (
      multihashCode.value !== MULTIHASH_SHA2_256 ||
      digest.length !== 32 ||
      length.offset + length.value !== bytes.length
    ) {
      throw new InvalidCidError(cid);
    }

    return {
      version: 1,
      codec: codec.value,
      multihashCode: multihashCode.value,
      digest,
      bytes,
    };
  } catch (error) {
    if (error instanceof InvalidCidError) throw error;
    throw new InvalidCidError(cid);
  }
}

function cidV1Bytes(codec, block) {
  const digest = crypto.createHash('sha256').update(block).digest();
  const bytes = Buffer.concat([
    Buffer.from(encodeVarint(1)),
    Buffer.from(encodeVarint(codec)),
    Buffer.from(encodeVarint(MULTIHASH_SHA2_256)),
    Buffer.from(encodeVarint(digest.length)),
    digest,
  ]);

  return {
    cid: `b${base32Encode(bytes)}`,
    bytes,
    digest,
    codec,
    version: 1,
  };
}

// ── UnixFS CID computation (matches `ipfs add --cid-version=1`) ─────────────

function concatBytes(parts) {
  return Buffer.concat(parts);
}

function varintField(field, value) {
  return Buffer.from([
    ...encodeVarint((field << 3) | 0),
    ...encodeVarint(value),
  ]);
}

function bytesField(field, value) {
  return concatBytes([
    Buffer.from([
      ...encodeVarint((field << 3) | 2),
      ...encodeVarint(value.length),
    ]),
    value,
  ]);
}

function encodeUnixFsFile(data, fileSize, blockSizes) {
  const parts = [varintField(1, 2)];
  if (data && data.length > 0) parts.push(bytesField(2, data));
  parts.push(varintField(3, fileSize));
  for (const size of blockSizes) parts.push(varintField(4, size));
  return concatBytes(parts);
}

function encodePbLink(link) {
  return concatBytes([
    bytesField(1, link.cidBytes),
    bytesField(2, Buffer.alloc(0)),
    varintField(3, link.size),
  ]);
}

function encodePbNode(data, links) {
  const parts = links.map((link) => bytesField(2, encodePbLink(link)));
  if (data && data.length > 0) parts.push(bytesField(1, data));
  return concatBytes(parts);
}

function createLeaf(data, rawLeaves) {
  if (rawLeaves) {
    const { cid, bytes } = cidV1Bytes(CODEC_RAW, data);
    return {
      cid,
      cidBytes: bytes,
      size: data.length,
      fileSize: data.length,
    };
  }

  const unixfs = encodeUnixFsFile(data, data.length, []);
  const block = encodePbNode(unixfs, []);
  const { cid, bytes } = cidV1Bytes(CODEC_DAG_PB, block);
  return { cid, cidBytes: bytes, size: block.length, fileSize: data.length };
}

function createParent(children) {
  const fileSize = children.reduce((sum, child) => sum + child.fileSize, 0);
  const unixfs = encodeUnixFsFile(
    null,
    fileSize,
    children.map((child) => child.fileSize)
  );
  const links = children.map((child) => ({
    cidBytes: child.cidBytes,
    size: child.size,
  }));
  const block = encodePbNode(unixfs, links);
  const { cid, bytes } = cidV1Bytes(CODEC_DAG_PB, block);
  const size =
    block.length + children.reduce((sum, child) => sum + child.size, 0);

  return { cid, cidBytes: bytes, size, fileSize };
}

function buildUnixFsRoot(data, rawLeaves, chunkSize) {
  const chunks = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }
  if (chunks.length === 0) chunks.push(Buffer.alloc(0));

  let nodes = chunks.map((chunk) => createLeaf(chunk, rawLeaves));
  if (nodes.length === 1) return nodes[0];

  while (nodes.length > 1) {
    const parents = [];
    for (let index = 0; index < nodes.length; index += IPFS_MAX_CHILDREN) {
      parents.push(createParent(nodes.slice(index, index + IPFS_MAX_CHILDREN)));
    }
    nodes = parents;
  }

  return nodes[0];
}

/**
 * Compute the UnixFS CIDv1 for file bytes using the IPFS importer defaults.
 * @param {Buffer|Uint8Array} data
 * @param {{chunkSize?:number,rawLeaves?:boolean}} [options]
 * @returns {string}
 */
export function computeUnixFsCidV1(data, options = {}) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return buildUnixFsRoot(
    buffer,
    options.rawLeaves ?? false,
    options.chunkSize ?? IPFS_CHUNK_SIZE
  ).cid;
}

/**
 * Compute the CIDv1 treating the bytes as a single raw block.
 * @param {Buffer|Uint8Array} data
 * @returns {string}
 */
export function computeRawCidV1(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return cidV1Bytes(CODEC_RAW, buffer).cid;
}

/**
 * All plausible CIDs a gateway may return for the same bytes, covering the
 * UnixFS defaults Pinata uses as well as raw-block imports.
 * @param {Buffer|Uint8Array} data
 * @returns {string[]}
 */
export function computeCidCandidates(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Array.from(
    new Set([
      computeUnixFsCidV1(buffer),
      computeUnixFsCidV1(buffer, { rawLeaves: true }),
      computeRawCidV1(buffer),
    ])
  );
}

/**
 * Verify that downloaded bytes hash to the requested CID's multihash.
 * @param {string} cid
 * @param {Buffer|Uint8Array} data
 * @returns {{verified:boolean,expectedCid:string,actualCid:string|null,candidates:string[]}}
 */
export function verifyContent(cid, data) {
  const expected = parseCid(cid);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const candidates = computeCidCandidates(buffer);
  const actualCid =
    candidates.find((candidate) => {
      try {
        return parseCid(candidate).digest.equals(expected.digest);
      } catch {
        return false;
      }
    }) ?? null;

  return {
    verified: actualCid !== null,
    expectedCid: cid,
    actualCid,
    candidates,
  };
}

// ── Gateway pool ────────────────────────────────────────────────────────────

/**
 * Resolve the gateway pool from IPFS_GATEWAYS (comma separated base URLs) or
 * fall back to the built-in Cloudflare / IPFS.io / Pinata / Infura pool.
 * @returns {Array<{name:string,baseUrl:string}>}
 */
export function resolveGatewayPool(env = process.env) {
  const configured = (env.IPFS_GATEWAYS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (configured.length === 0) return DEFAULT_IPFS_GATEWAYS;

  return configured.map((entry, index) => {
    try {
      const url = new URL(entry);
      return {
        name: url.hostname || `gateway-${index + 1}`,
        baseUrl: entry.endsWith('/') ? entry : `${entry}/`,
      };
    } catch {
      return {
        name: `gateway-${index + 1}`,
        baseUrl: entry.endsWith('/') ? entry : `${entry}/`,
      };
    }
  });
}

// ── Service ─────────────────────────────────────────────────────────────────

export class IpfsService {
  /**
   * @param {object} [options]
   * @param {Array<{name:string,baseUrl:string}>} [options.gateways]
   * @param {Function} [options.fetchImpl]
   * @param {object} [options.redis] redisService-compatible client
   * @param {object|null} [options.storage] storageService-compatible client
   * @param {number} [options.timeoutMs]
   * @param {number} [options.cacheTtlSeconds]
   * @param {number} [options.maxContentBytes]
   */
  constructor(options = {}) {
    this.gateways = options.gateways ?? resolveGatewayPool();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.redis = options.redis === undefined ? redisService : options.redis;
    this.storage = options.storage;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GATEWAY_TIMEOUT_MS;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
    this.maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  }

  async #getStorage() {
    if (this.storage !== undefined) return this.storage;
    try {
      const module = await import('./storageService.js');
      this.storage = module.storageService;
    } catch (error) {
      console.warn('[ipfs] S3 cache unavailable:', error.message);
      this.storage = null;
    }
    return this.storage;
  }

  async #fetchFromGateway(cid, gateway, options) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('This environment does not provide fetch()');
    }

    const url = `${gateway.baseUrl}${cid}`;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxBytes = options.maxContentBytes ?? this.maxContentBytes;
    const controller =
      typeof AbortController === 'undefined'
        ? undefined
        : new AbortController();
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw Object.assign(
          new Error(`Gateway returned HTTP ${response.status}`),
          { status: response.status }
        );
      }

      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw Object.assign(
          new Error(`Gateway payload exceeds ${maxBytes} bytes`),
          { status: response.status }
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) {
        throw Object.assign(
          new Error(`Gateway payload exceeds ${maxBytes} bytes`),
          { status: response.status }
        );
      }

      return {
        bytes,
        gateway: gateway.name,
        url,
        status: response.status,
        contentType:
          response.headers?.get?.('content-type') ?? 'application/octet-stream',
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #decodeCacheEntry(cid, raw) {
    if (raw === null || raw === undefined) return null;

    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!entry || typeof entry.data !== 'string') return null;

    const bytes = Buffer.from(entry.data, 'base64');
    const verification = verifyContent(cid, bytes);
    if (!verification.verified) return null;

    return {
      bytes,
      cid,
      contentType: entry.contentType || 'application/octet-stream',
      gateway: entry.gateway || null,
      cached: true,
      cacheSource: entry.cacheSource || null,
      verified: true,
      cachedAt: entry.cachedAt || null,
      attempts: [],
    };
  }

  async #readCache(cid) {
    if (this.redis && typeof this.redis.get === 'function') {
      const key = `${REDIS_KEY_PREFIX}${cid}`;
      try {
        const raw = await this.redis.get(key);
        if (raw !== null && raw !== undefined) {
          const entry = this.#decodeCacheEntry(cid, raw);
          if (entry) return { ...entry, cacheSource: 'redis' };
          // Corrupted cache entry: evict it so it cannot be served again.
          await this.redis.delete?.(key);
        }
      } catch (error) {
        console.warn('[ipfs] Redis cache read failed:', error.message);
      }
    }

    const storage = await this.#getStorage();
    if (storage && typeof storage.download === 'function') {
      const key = `${S3_KEY_PREFIX}${cid}`;
      try {
        if (
          typeof storage.exists !== 'function' ||
          (await storage.exists(key))
        ) {
          const bytes = await storage.download(key);
          const verification = verifyContent(cid, bytes);
          if (verification.verified) {
            return {
              bytes,
              cid,
              contentType: 'application/octet-stream',
              gateway: null,
              cached: true,
              cacheSource: 's3',
              verified: true,
              cachedAt: null,
              attempts: [],
            };
          }
          await storage.delete?.(key);
        }
      } catch (error) {
        console.warn('[ipfs] S3 cache read failed:', error.message);
      }
    }

    return null;
  }

  async #writeCache(cid, result) {
    const cachedAt = new Date().toISOString();
    const payload = {
      cid,
      contentType: result.contentType,
      gateway: result.gateway,
      cachedAt,
      data: result.bytes.toString('base64'),
    };

    if (this.redis && typeof this.redis.set === 'function') {
      try {
        await this.redis.set(
          `${REDIS_KEY_PREFIX}${cid}`,
          JSON.stringify(payload),
          this.cacheTtlSeconds
        );
      } catch (error) {
        console.warn('[ipfs] Redis cache write failed:', error.message);
      }
    }

    const storage = await this.#getStorage();
    if (storage && typeof storage.putObject === 'function') {
      try {
        await storage.putObject(`${S3_KEY_PREFIX}${cid}`, result.bytes, {
          cid,
          contentType: result.contentType,
          gateway: result.gateway,
          cachedAt,
        });
      } catch (error) {
        console.warn('[ipfs] S3 cache write failed:', error.message);
      }
    }
  }

  /**
   * Fetch content by CID, trying each gateway in order and verifying the bytes
   * before returning them. Verified responses are cached in Redis and S3.
   * @param {string} cid
   * @param {object} [options]
   * @param {boolean} [options.useCache=true]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.maxContentBytes]
   * @returns {Promise<object>}
   */
  async resolve(cid, options = {}) {
    parseCid(cid);

    if (options.useCache !== false) {
      const cached = await this.#readCache(cid);
      if (cached) return cached;
    }

    const attempts = [];

    for (const gateway of this.gateways) {
      try {
        const fetched = await this.#fetchFromGateway(cid, gateway, options);
        const verification = verifyContent(cid, fetched.bytes);

        if (!verification.verified) {
          attempts.push({
            gateway: gateway.name,
            url: fetched.url,
            status: fetched.status,
            latencyMs: fetched.latencyMs,
            error: `CID verification failed (got ${verification.actualCid ?? 'no match'})`,
          });
          continue;
        }

        const result = {
          bytes: fetched.bytes,
          cid,
          contentType: fetched.contentType,
          gateway: fetched.gateway,
          url: fetched.url,
          status: fetched.status,
          latencyMs: fetched.latencyMs,
          cached: false,
          cacheSource: null,
          verified: true,
          attempts,
        };

        if (options.useCache !== false) {
          await this.#writeCache(cid, result);
        }

        return result;
      } catch (error) {
        attempts.push({
          gateway: gateway.name,
          url: `${gateway.baseUrl}${cid}`,
          status: error.status ?? null,
          error: error.message,
        });
      }
    }

    throw new IpfsResolutionError(cid, attempts);
  }

  /**
   * Fetch only from one gateway. Exposed for diagnostics and tests.
   */
  async fetchFromGateway(cid, gateway, options = {}) {
    parseCid(cid);
    const target = gateway ?? this.gateways[0];
    if (!target) throw new IpfsResolutionError(cid, []);
    return this.#fetchFromGateway(cid, target, options);
  }
}

export const ipfsService = new IpfsService();
export default ipfsService;
