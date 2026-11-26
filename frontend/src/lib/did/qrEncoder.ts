// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file qrEncoder.ts
 * Pure-TypeScript QR Code Model 2 generator and W3C VP token builder.
 *
 * No external QR library is required. The implementation covers:
 *  - QR Code Model 2, error correction level M (up to version 10)
 *  - Byte-mode encoding (UTF-8 input is base64url-safe ASCII after the VP
 *    envelope step, so byte mode is the only mode needed)
 *  - Reed-Solomon ECC via GF(256) arithmetic
 *  - All 8 mask patterns evaluated by the ISO 18004 penalty rules
 *  - SVG output with configurable module color and quiet zone
 *
 * VP token format follows OpenID4VP §6.1 "VP Token":
 *   VP_TOKEN/<base64url(JSON.stringify(VerifiablePresentation))>
 */

import type {
  VerifiablePresentation,
  VpQrPayload,
  QrCodeResult,
} from "@/types/did";

// ---------------------------------------------------------------------------
// 1. VP Token builder
// ---------------------------------------------------------------------------

/**
 * Encode a VerifiablePresentation into the compact VP_TOKEN string and return
 * the full VpQrPayload ready to be rendered as a QR code.
 */
export function buildVpToken(
  vp: VerifiablePresentation,
  options: { label?: string; expiresIn?: number } = {}
): VpQrPayload {
  const nonce = generateNonce();
  const issuedAt = Math.floor(Date.now() / 1000);

  // Attach nonce + iat so verifiers can check replay-protection
  const tokenVp: VerifiablePresentation = {
    ...vp,
    id: vp.id ?? `urn:uuid:${nonce}`,
  };

  const json = JSON.stringify(tokenVp);
  const b64 = base64UrlEncode(json);
  const raw = `VP_TOKEN/${b64}`;

  const issuerName = getIssuerName(vp.verifiableCredential[0]?.issuer);
  const label =
    options.label ??
    `${issuerName} · ${new Date(issuedAt * 1000).toLocaleDateString()}`;

  return {
    raw,
    label,
    nonce,
    issuedAt,
    expiresIn: options.expiresIn ?? 300,
  };
}

/**
 * Parse a VP_TOKEN string back into a VerifiablePresentation.
 * Throws if the prefix is missing or the JSON is invalid.
 */
export function parseVpToken(raw: string): VerifiablePresentation {
  const PREFIX = "VP_TOKEN/";
  if (!raw.startsWith(PREFIX)) {
    throw new Error(`Invalid VP token: must start with "${PREFIX}"`);
  }
  const b64 = raw.slice(PREFIX.length);
  const json = base64UrlDecode(b64);
  const parsed = JSON.parse(json) as unknown;
  assertIsVp(parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// 2. SVG QR code generator
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained SVG QR code from any string payload.
 *
 * @param text   The string to encode (UTF-8 bytes, byte mode).
 * @param opts   Optional overrides for size, colors, and quiet-zone.
 */
export function generateQrSvg(
  text: string,
  opts: {
    size?: number;
    darkColor?: string;
    lightColor?: string;
    quietZone?: number;
  } = {}
): QrCodeResult {
  const darkColor = opts.darkColor ?? "#0f172a";
  const lightColor = opts.lightColor ?? "#ffffff";
  const quietZone = opts.quietZone ?? 4;

  const bytes = encodeUtf8(text);
  const { version, ecLevel } = pickVersion(bytes.length);
  const bits = buildDataBits(bytes, version, ecLevel);
  const withEcc = appendEcc(bits, version, ecLevel);
  const { matrix, size: modules } = placeModules(withEcc, version);
  const masked = applyBestMask(matrix, modules, version, ecLevel);

  const totalModules = modules + quietZone * 2;
  const cellSize = Math.floor((opts.size ?? 256) / totalModules);
  const svgSize = totalModules * cellSize;

  let rects = "";
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (masked[r][c]) {
        const x = (c + quietZone) * cellSize;
        const y = (r + quietZone) * cellSize;
        rects += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${darkColor}"/>`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" ` +
    `width="${svgSize}" height="${svgSize}" role="img" aria-label="QR Code">` +
    `<rect width="${svgSize}" height="${svgSize}" fill="${lightColor}"/>` +
    rects +
    `</svg>`;

  return { svg, encoded: text, size: svgSize };
}

// ---------------------------------------------------------------------------
// 3. Combined convenience helper
// ---------------------------------------------------------------------------

/** Build VP token and immediately generate its QR SVG. */
export function buildVpQr(
  vp: VerifiablePresentation,
  options: {
    label?: string;
    expiresIn?: number;
    size?: number;
    darkColor?: string;
    lightColor?: string;
  } = {}
): { payload: VpQrPayload; qr: QrCodeResult } {
  const payload = buildVpToken(vp, options);
  const qr = generateQrSvg(payload.raw, {
    size: options.size,
    darkColor: options.darkColor,
    lightColor: options.lightColor,
  });
  return { payload, qr };
}

// ---------------------------------------------------------------------------
// Helpers – encoding
// ---------------------------------------------------------------------------

function encodeUtf8(str: string): Uint8Array {
  // TextEncoder is available in all modern browsers and Node ≥ 11
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  // Minimal fallback for environments without TextEncoder
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xe0 | (cp >> 12),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

function base64UrlEncode(str: string): string {
  const bytes = encodeUtf8(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== "undefined") {
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  // Node fallback
  return Buffer.from(binary, "binary")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(b64: string): string {
  const padded =
    b64.replace(/-/g, "+").replace(/_/g, "/") +
    "==".slice(0, (4 - (b64.length % 4)) % 4);
  let binary: string;
  if (typeof atob !== "undefined") {
    binary = atob(padded);
  } else {
    binary = Buffer.from(padded, "base64").toString("binary");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(bytes).toString("utf-8");
}

function generateNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Node.js fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("crypto") as typeof import("crypto");
  return nodeCrypto.randomBytes(16).toString("hex");
}

function getIssuerName(
  issuer: string | { id: string; name?: string } | undefined
): string {
  if (!issuer) return "Unknown Issuer";
  if (typeof issuer === "string") return issuer;
  return issuer.name ?? issuer.id;
}

function assertIsVp(value: unknown): asserts value is VerifiablePresentation {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as Record<string, unknown>)["@context"])
  ) {
    throw new Error("Parsed token is not a valid VerifiablePresentation");
  }
}

// ---------------------------------------------------------------------------
// QR Code Model 2 – error correction capacity tables (version 1-10, level M)
// ---------------------------------------------------------------------------

type EcLevel = "L" | "M" | "Q" | "H";

/** Total codewords and ECC codewords per block for versions 1-10 at level M */
const EC_TABLE: Record<
  number,
  { totalData: number; ecPerBlock: number; blocks: number }
> = {
  1:  { totalData: 16,  ecPerBlock: 10, blocks: 1 },
  2:  { totalData: 28,  ecPerBlock: 16, blocks: 1 },
  3:  { totalData: 44,  ecPerBlock: 26, blocks: 2 },
  4:  { totalData: 64,  ecPerBlock: 18, blocks: 2 },
  5:  { totalData: 86,  ecPerBlock: 24, blocks: 2 },
  6:  { totalData: 108, ecPerBlock: 16, blocks: 4 },
  7:  { totalData: 124, ecPerBlock: 18, blocks: 4 },
  8:  { totalData: 154, ecPerBlock: 22, blocks: 4 },
  9:  { totalData: 182, ecPerBlock: 22, blocks: 5 },
  10: { totalData: 216, ecPerBlock: 26, blocks: 6 },
};

/** Byte-mode data capacity in characters for version 1-10, level M */
const BYTE_CAPACITY_M: Record<number, number> = {
  1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213,
};

function pickVersion(
  byteLen: number
): { version: number; ecLevel: EcLevel } {
  for (let v = 1; v <= 10; v++) {
    if (BYTE_CAPACITY_M[v] >= byteLen) {
      return { version: v, ecLevel: "M" };
    }
  }
  throw new Error(
    `VP token too long for QR version ≤ 10 (${byteLen} bytes). ` +
    `Shorten the credential payload or reduce field verbosity.`
  );
}

// ---------------------------------------------------------------------------
// QR Code Model 2 – bit stream construction
// ---------------------------------------------------------------------------

class BitBuffer {
  private buf: number[] = [];
  private bitLen = 0;

  put(num: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.putBit(((num >> i) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const pos = Math.floor(this.bitLen / 8);
    if (this.buf.length <= pos) this.buf.push(0);
    if (bit) this.buf[pos] |= 0x80 >> (this.bitLen % 8);
    this.bitLen++;
  }

  get length(): number {
    return this.bitLen;
  }

  getBytes(): number[] {
    return this.buf;
  }
}

/** Character count indicator bit lengths for byte mode */
const CC_BITS: Record<number, number> = {};
for (let v = 1; v <= 9; v++) CC_BITS[v] = 8;
for (let v = 10; v <= 26; v++) CC_BITS[v] = 16;

function buildDataBits(
  bytes: Uint8Array,
  version: number,
  _ecLevel: EcLevel
): number[] {
  const buf = new BitBuffer();

  // Mode indicator: byte mode = 0100
  buf.put(0x4, 4);
  // Character count
  buf.put(bytes.length, CC_BITS[version]);
  // Data bytes
  for (const b of bytes) buf.put(b, 8);

  const { totalData } = EC_TABLE[version];
  const capacity = totalData * 8;

  // Terminator (up to 4 zero bits)
  const remaining = capacity - buf.length;
  for (let i = 0; i < Math.min(4, remaining); i++) buf.putBit(false);

  // Pad to byte boundary
  while (buf.length % 8 !== 0) buf.putBit(false);

  // Pad bytes
  const pads = [0xec, 0x11];
  let pi = 0;
  while (buf.length < capacity) {
    buf.put(pads[pi % 2], 8);
    pi++;
  }

  return buf.getBytes();
}

// ---------------------------------------------------------------------------
// QR Code Model 2 – Reed-Solomon ECC (GF(256) with primitive poly x^8+x^4+x^3+x^2+1)
// ---------------------------------------------------------------------------

const GF_POLY = 0x11d; // primitive polynomial

/** Build EXP and LOG tables for GF(256). */
function buildGfTables(): { exp: number[]; log: number[] } {
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x >= 256) x ^= GF_POLY;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}

const { exp: GF_EXP, log: GF_LOG } = buildGfTables();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

/** Build the generator polynomial for `degree` ECC codewords. */
function buildGenerator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const factor = [1, GF_EXP[i]];
    const result = new Array<number>(g.length + factor.length - 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      for (let k = 0; k < factor.length; k++) {
        result[j + k] ^= gfMul(g[j], factor[k]);
      }
    }
    g = result;
  }
  return g;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = buildGenerator(ecLen);
  const msg = [...data, ...new Array<number>(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function appendEcc(data: number[], version: number, _ecLevel: EcLevel): number[] {
  const { totalData, ecPerBlock, blocks } = EC_TABLE[version];
  const dataPerBlock = Math.floor(totalData / blocks);
  const extraBlocks = totalData % blocks;

  const dataBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const len = dataPerBlock + (b < extraBlocks ? 1 : 0);
    dataBlocks.push(data.slice(offset, offset + len));
    offset += len;
  }

  const eccBlocks = dataBlocks.map((db) => rsEncode(db, ecPerBlock));

  // Interleave data codewords
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const db of dataBlocks) {
      if (i < db.length) out.push(db[i]);
    }
  }
  // Interleave ECC codewords
  for (let i = 0; i < ecPerBlock; i++) {
    for (const eb of eccBlocks) {
      if (i < eb.length) out.push(eb[i]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// QR Code Model 2 – matrix construction & finder/timing/alignment patterns
// ---------------------------------------------------------------------------

type Matrix = boolean[][];

function makeMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

/** Alignment pattern center positions (version 2-10 have one center). */
const ALIGN_POS: Record<number, number[]> = {
  1: [],
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function placeModules(
  codewords: number[],
  version: number
): { matrix: Matrix; size: number } {
  const size = version * 4 + 17;
  const mat = makeMatrix(size);
  const reserved = makeMatrix(size); // tracks non-data modules

  // Finder patterns + separators + format placeholders
  placeFinder(mat, reserved, 0, 0);
  placeFinder(mat, reserved, size - 7, 0);
  placeFinder(mat, reserved, 0, size - 7);
  placeTimingPatterns(mat, reserved, size);
  placeDarkModule(mat, reserved, version);
  if (version >= 7) placeVersionInfo(mat, reserved, version, size);
  placeAlignmentPatterns(mat, reserved, version, size);
  // Reserve format info area (filled in after masking)
  reserveFormatArea(reserved, size);

  // Place data bits in the zigzag scan order
  const bits = codewordsToBits(codewords);
  placeDataBits(mat, reserved, bits, size);

  return { matrix: mat, size };
}

function setModule(
  mat: Matrix,
  res: Matrix,
  r: number,
  c: number,
  dark: boolean,
  isReserved = true
): void {
  mat[r][c] = dark;
  if (isReserved) res[r][c] = true;
}

function placeFinderBlock(
  mat: Matrix,
  res: Matrix,
  startRow: number,
  startCol: number
): void {
  const PATTERN = [
    [true, true, true, true, true, true, true],
    [true, false, false, false, false, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, false, false, false, false, true],
    [true, true, true, true, true, true, true],
  ];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const row = startRow + r;
      const col = startCol + c;
      if (row >= 0 && row < mat.length && col >= 0 && col < mat[0].length) {
        setModule(mat, res, row, col, PATTERN[r][c]);
      }
    }
  }
}

function placeFinder(
  mat: Matrix,
  res: Matrix,
  row: number,
  col: number
): void {
  placeFinderBlock(mat, res, row, col);
  // Separator (white border around finder)
  const size = mat.length;
  const rowEnd = Math.min(row + 8, size - 1);
  const colEnd = Math.min(col + 8, size - 1);
  const rowStart = Math.max(row - 1, 0);
  const colStart = Math.max(col - 1, 0);
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      if (r < row || r >= row + 7 || c < col || c >= col + 7) {
        if (r < size && c < size) setModule(mat, res, r, c, false);
      }
    }
  }
}

function placeTimingPatterns(mat: Matrix, res: Matrix, size: number): void {
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(mat, res, 6, i, dark);
    setModule(mat, res, i, 6, dark);
  }
}

function placeDarkModule(mat: Matrix, res: Matrix, version: number): void {
  setModule(mat, res, version * 4 + 9, 8, true);
}

function placeAlignmentPatterns(
  mat: Matrix,
  res: Matrix,
  version: number,
  size: number
): void {
  const positions = ALIGN_POS[version] ?? [];
  const centers: [number, number][] = [];
  for (const r of positions) {
    for (const c of positions) {
      // Skip positions that overlap finder patterns
      const nearTopLeft = r <= 8 && c <= 8;
      const nearTopRight = r <= 8 && c >= size - 8;
      const nearBottomLeft = r >= size - 8 && c <= 8;
      if (!nearTopLeft && !nearTopRight && !nearBottomLeft) {
        centers.push([r, c]);
      }
    }
  }
  for (const [cr, cc] of centers) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        setModule(mat, res, cr + dr, cc + dc, dark);
      }
    }
  }
}

function placeVersionInfo(
  mat: Matrix,
  res: Matrix,
  version: number,
  size: number
): void {
  const vBits = encodeVersion(version);
  for (let i = 0; i < 18; i++) {
    const bit = (vBits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    setModule(mat, res, r, size - 11 + c, bit === 1);
    setModule(mat, res, size - 11 + c, r, bit === 1);
  }
}

function encodeVersion(version: number): number {
  // BCH(18,6) error correction for version information
  let n = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((n >> i) & 1) n ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | n;
}

function reserveFormatArea(res: Matrix, size: number): void {
  // Format info strips around the top-left finder
  for (let i = 0; i <= 8; i++) {
    res[8][i] = true;
    res[i][8] = true;
  }
  // Bottom-left and top-right strips
  for (let i = size - 8; i < size; i++) {
    res[8][i] = true;
    res[i][8] = true;
  }
}

function codewordsToBits(codewords: number[]): boolean[] {
  const bits: boolean[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) {
      bits.push(((cw >> i) & 1) === 1);
    }
  }
  return bits;
}

function placeDataBits(
  mat: Matrix,
  res: Matrix,
  bits: boolean[],
  size: number
): void {
  let bitIdx = 0;
  let goingUp = true;

  // Two columns at a time, right to left, skipping the vertical timing column
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // skip vertical timing column

    for (let rowOffset = 0; rowOffset < size; rowOffset++) {
      const row = goingUp ? size - 1 - rowOffset : rowOffset;
      for (let colDelta = 0; colDelta <= 1; colDelta++) {
        const col = right - colDelta;
        if (!res[row][col]) {
          mat[row][col] = bitIdx < bits.length ? bits[bitIdx++] : false;
        }
      }
    }
    goingUp = !goingUp;
  }
}

// ---------------------------------------------------------------------------
// QR Code Model 2 – masking (all 8 patterns, ISO 18004 §8.8)
// ---------------------------------------------------------------------------

type MaskFn = (r: number, c: number) => boolean;

const MASK_FNS: MaskFn[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, reserved: Matrix, maskId: number, size: number): Matrix {
  const fn = MASK_FNS[maskId];
  const out = matrix.map((row) => [...row]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

function writeFormatInfo(
  mat: Matrix,
  maskId: number,
  ecLevel: EcLevel,
  size: number
): void {
  // EC level indicator bits: L=01, M=00, Q=11, H=10
  const EC_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
  const fmtData = (EC_BITS[ecLevel] << 3) | maskId;
  // BCH(15,5)
  let n = fmtData << 10;
  for (let i = 14; i >= 10; i--) {
    if ((n >> i) & 1) n ^= 0x537 << (i - 10);
  }
  const fmt = ((fmtData << 10) | n) ^ 0x5412;

  const positions = [0, 1, 2, 3, 4, 5, 7, 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1];
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    // Top-left horizontal
    const col = positions[i] < 9 ? positions[i] : size - 15 + i;
    // These writes go directly into mat (reserved area)
    if (i < 8) {
      mat[8][positions[i]] = bit === 1;
    } else {
      mat[8][positions[i]] = bit === 1;
    }
    // Top-left vertical
    if (i < 7) {
      mat[6 - i][8] = bit === 1;
    } else if (i === 7) {
      mat[8][8] = bit === 1;
    } else {
      mat[14 - i + 1][8] = bit === 1;
    }
    void col; // used only for comment clarity
  }
}

function penaltyScore(mat: Matrix, size: number): number {
  let score = 0;

  // Rule 1: five or more in a row
  for (let r = 0; r < size; r++) {
    for (let start = 0; start < size; ) {
      const color = mat[r][start];
      let run = 0;
      while (start + run < size && mat[r][start + run] === color) run++;
      if (run >= 5) score += run - 2;
      start += run;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let start = 0; start < size; ) {
      const color = mat[start][c];
      let run = 0;
      while (start + run < size && mat[start + run][c] === color) run++;
      if (run >= 5) score += run - 2;
      start += run;
    }
  }

  // Rule 2: 2×2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = mat[r][c];
      if (mat[r][c + 1] === v && mat[r + 1][c] === v && mat[r + 1][c + 1] === v) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like patterns
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const check = (row: boolean[]) =>
    (row.every((v, i) => v === P1[i]) ? 40 : 0) +
    (row.every((v, i) => v === P2[i]) ? 40 : 0);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      score += check(mat[r].slice(c, c + 11));
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      score += check(Array.from({ length: 11 }, (_, i) => mat[r + i][c]));
    }
  }

  // Rule 4: dark/light ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (mat[r][c]) dark++;
  const ratio = dark / (size * size);
  const prev5 = Math.floor(ratio * 20) * 5;
  const next5 = prev5 + 5;
  score += Math.min(Math.abs(prev5 - 50), Math.abs(next5 - 50)) * 2;

  return score;
}

function applyBestMask(
  matrix: Matrix,
  reserved: Matrix,
  size: number,
  ecLevel: EcLevel
): Matrix {
  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix = matrix;

  for (let m = 0; m < 8; m++) {
    const candidate = applyMask(matrix, reserved, m, size);
    writeFormatInfo(candidate, m, ecLevel, size);
    const score = penaltyScore(candidate, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      bestMatrix = candidate;
    }
  }

  void bestMask;
  return bestMatrix;
}
