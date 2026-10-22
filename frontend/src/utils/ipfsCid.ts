const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

export const IPFS_CHUNK_SIZE = 262_144;
export const IPFS_MAX_CHILDREN = 174;

export const CODEC_RAW = 0x55;
export const CODEC_DAG_PB = 0x70;
export const MULTIHASH_SHA2_256 = 0x12;

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256(input: Uint8Array): Uint8Array {
  const length = input.length;
  const paddedLength = ((length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array(SHA256_INITIAL);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < h.length; i += 1) {
    digestView.setUint32(i * 4, h[i]);
  }
  return digest;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function sha256Hex(input: Uint8Array): string {
  return toHex(sha256(input));
}

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let remainder = value;
  while (remainder >= 0x80) {
    out.push((remainder & 0x7f) | 0x80);
    remainder = Math.floor(remainder / 128);
  }
  out.push(remainder);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function varintField(field: number, value: number): Uint8Array {
  return new Uint8Array([...encodeVarint((field << 3) | 0), ...encodeVarint(value)]);
}

function bytesField(field: number, value: Uint8Array): Uint8Array {
  return concatBytes([
    new Uint8Array([
      ...encodeVarint((field << 3) | 2),
      ...encodeVarint(value.length),
    ]),
    value,
  ]);
}

export function base32Encode(bytes: Uint8Array): string {
  let output = "";
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

export function cidV1Bytes(codec: number, block: Uint8Array): {
  cid: string;
  bytes: Uint8Array;
} {
  const digest = sha256(block);
  const bytes = new Uint8Array([
    ...encodeVarint(1),
    ...encodeVarint(codec),
    ...encodeVarint(MULTIHASH_SHA2_256),
    ...encodeVarint(digest.length),
    ...digest,
  ]);

  return { cid: `b${base32Encode(bytes)}`, bytes };
}

function encodeUnixFsFile(
  data: Uint8Array | null,
  fileSize: number,
  blockSizes: number[],
): Uint8Array {
  const parts: Uint8Array[] = [varintField(1, 2)];

  if (data && data.length > 0) {
    parts.push(bytesField(2, data));
  }

  parts.push(varintField(3, fileSize));

  for (const size of blockSizes) {
    parts.push(varintField(4, size));
  }

  return concatBytes(parts);
}

interface PbLink {
  cidBytes: Uint8Array;
  size: number;
}

function encodePbLink(link: PbLink): Uint8Array {
  return concatBytes([
    bytesField(1, link.cidBytes),
    bytesField(2, new Uint8Array(0)),
    varintField(3, link.size),
  ]);
}

function encodePbNode(data: Uint8Array | null, links: PbLink[]): Uint8Array {
  const parts: Uint8Array[] = links.map((link) =>
    bytesField(2, encodePbLink(link)),
  );

  if (data && data.length > 0) {
    parts.push(bytesField(1, data));
  }

  return concatBytes(parts);
}

interface UnixFsNode {
  cid: string;
  cidBytes: Uint8Array;
  size: number;
  fileSize: number;
}

function createLeaf(data: Uint8Array, rawLeaves: boolean): UnixFsNode {
  if (rawLeaves) {
    const { cid, bytes } = cidV1Bytes(CODEC_RAW, data);
    return { cid, cidBytes: bytes, size: data.length, fileSize: data.length };
  }

  const unixfs = encodeUnixFsFile(data, data.length, []);
  const block = encodePbNode(unixfs, []);
  const { cid, bytes } = cidV1Bytes(CODEC_DAG_PB, block);
  return { cid, cidBytes: bytes, size: block.length, fileSize: data.length };
}

function createParent(children: UnixFsNode[]): UnixFsNode {
  const fileSize = children.reduce((sum, child) => sum + child.fileSize, 0);
  const unixfs = encodeUnixFsFile(
    null,
    fileSize,
    children.map((child) => child.fileSize),
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

function buildUnixFsRoot(
  data: Uint8Array,
  rawLeaves: boolean,
  chunkSize: number,
): UnixFsNode {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }

  if (chunks.length === 0) {
    chunks.push(new Uint8Array(0));
  }

  let nodes = chunks.map((chunk) => createLeaf(chunk, rawLeaves));

  if (nodes.length === 1) {
    return nodes[0];
  }

  while (nodes.length > 1) {
    const parents: UnixFsNode[] = [];
    for (let index = 0; index < nodes.length; index += IPFS_MAX_CHILDREN) {
      parents.push(createParent(nodes.slice(index, index + IPFS_MAX_CHILDREN)));
    }
    nodes = parents;
  }

  return nodes[0];
}

export interface CidOptions {
  chunkSize?: number;
  rawLeaves?: boolean;
}

/**
 * Computes the UnixFS CIDv1 that `ipfs add --cid-version=1` (and providers
 * such as Pinata) return for the same bytes. Chunking is fixed at 256 KiB and
 * the balanced layout is used, matching the IPFS importer defaults.
 */
export function computeUnixFsCidV1(
  data: Uint8Array,
  options: CidOptions = {},
): string {
  return buildUnixFsRoot(
    data,
    options.rawLeaves ?? false,
    options.chunkSize ?? IPFS_CHUNK_SIZE,
  ).cid;
}

/** CIDv1 of the bytes as a single raw block. */
export function computeRawCidV1(data: Uint8Array): string {
  return cidV1Bytes(CODEC_RAW, data).cid;
}

export interface ArtifactHashes {
  sha256: string;
  cid: string;
  unixfsCid: string;
  unixfsRawLeavesCid: string;
  rawCid: string;
  cidCandidates: string[];
}

export function computeArtifactHashes(data: Uint8Array): ArtifactHashes {
  const unixfsCid = computeUnixFsCidV1(data);
  const unixfsRawLeavesCid = computeUnixFsCidV1(data, { rawLeaves: true });
  const rawCid = computeRawCidV1(data);

  return {
    sha256: sha256Hex(data),
    cid: unixfsCid,
    unixfsCid,
    unixfsRawLeavesCid,
    rawCid,
    cidCandidates: Array.from(
      new Set([unixfsCid, unixfsRawLeavesCid, rawCid]),
    ),
  };
}

export function ipfsUri(cid: string): string {
  return `ipfs://${cid}`;
}
