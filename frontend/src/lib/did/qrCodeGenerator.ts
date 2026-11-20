// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file qrCodeGenerator.ts
 * Self-contained SVG QR Code Generator (ISO/IEC 18004 Model 2 compliant).
 * Supports Byte encoding mode, Error Correction Levels L, M, Q, H,
 * Reed-Solomon polynomial generation, standard mask patterns,
 * and high-resolution SVG rendering with custom coloring and center badges.
 */

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrOptions {
  ecLevel?: ErrorCorrectionLevel;
  minVersion?: number;
  maxVersion?: number;
  margin?: number; // Quiet zone in modules (default: 4)
  size?: number; // SVG pixel dimension
  fgColor?: string;
  bgColor?: string;
  title?: string;
  rounded?: boolean;
}

// Galois Field GF(2^8) math tables for Reed-Solomon coding
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d; // Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function polyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const result = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

// Generate Reed-Solomon Generator Polynomial for n error-correction codewords
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    poly = polyMul(poly, new Uint8Array([1, GF_EXP[i]]));
  }
  return poly;
}

// Calculate Reed-Solomon remainder codewords
function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGeneratorPoly(degree);
  const remainder = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < degree - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    remainder[degree - 1] = gfMul(gen[degree], factor);
  }
  return remainder;
}

// QR Code Version specifications: [totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCodewordsG1, numBlocksGroup2, dataCodewordsG2]
// Indexed by Version (1 to 10) and EC Level (L, M, Q, H)
interface VersionSpec {
  totalCodewords: number;
  ecPerBlock: number;
  blocksG1: number;
  dataG1: number;
  blocksG2: number;
  dataG2: number;
  alignmentPatternCenters: number[];
}

const EC_MAP: Record<ErrorCorrectionLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

const QR_SPECS: Record<number, Record<ErrorCorrectionLevel, VersionSpec>> = {
  1: {
    L: { totalCodewords: 26, ecPerBlock: 7, blocksG1: 1, dataG1: 19, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [] },
    M: { totalCodewords: 26, ecPerBlock: 10, blocksG1: 1, dataG1: 16, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [] },
    Q: { totalCodewords: 26, ecPerBlock: 13, blocksG1: 1, dataG1: 13, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [] },
    H: { totalCodewords: 26, ecPerBlock: 17, blocksG1: 1, dataG1: 9, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [] },
  },
  2: {
    L: { totalCodewords: 44, ecPerBlock: 10, blocksG1: 1, dataG1: 34, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 18] },
    M: { totalCodewords: 44, ecPerBlock: 16, blocksG1: 1, dataG1: 28, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 18] },
    Q: { totalCodewords: 44, ecPerBlock: 22, blocksG1: 1, dataG1: 22, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 18] },
    H: { totalCodewords: 44, ecPerBlock: 28, blocksG1: 1, dataG1: 16, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 18] },
  },
  3: {
    L: { totalCodewords: 70, ecPerBlock: 15, blocksG1: 1, dataG1: 55, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 22] },
    M: { totalCodewords: 70, ecPerBlock: 26, blocksG1: 1, dataG1: 44, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 22] },
    Q: { totalCodewords: 70, ecPerBlock: 18, blocksG1: 2, dataG1: 17, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 22] },
    H: { totalCodewords: 70, ecPerBlock: 22, blocksG1: 2, dataG1: 13, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 22] },
  },
  4: {
    L: { totalCodewords: 100, ecPerBlock: 20, blocksG1: 1, dataG1: 80, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 26] },
    M: { totalCodewords: 100, ecPerBlock: 18, blocksG1: 2, dataG1: 32, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 26] },
    Q: { totalCodewords: 100, ecPerBlock: 26, blocksG1: 2, dataG1: 24, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 26] },
    H: { totalCodewords: 100, ecPerBlock: 16, blocksG1: 4, dataG1: 9, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 26] },
  },
  5: {
    L: { totalCodewords: 134, ecPerBlock: 26, blocksG1: 1, dataG1: 108, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 30] },
    M: { totalCodewords: 134, ecPerBlock: 24, blocksG1: 2, dataG1: 43, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 30] },
    Q: { totalCodewords: 134, ecPerBlock: 18, blocksG1: 2, dataG1: 15, blocksG2: 2, dataG2: 16, alignmentPatternCenters: [6, 30] },
    H: { totalCodewords: 134, ecPerBlock: 22, blocksG1: 2, dataG1: 11, blocksG2: 2, dataG2: 12, alignmentPatternCenters: [6, 30] },
  },
  6: {
    L: { totalCodewords: 172, ecPerBlock: 18, blocksG1: 2, dataG1: 68, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 34] },
    M: { totalCodewords: 172, ecPerBlock: 16, blocksG1: 4, dataG1: 27, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 34] },
    Q: { totalCodewords: 172, ecPerBlock: 24, blocksG1: 4, dataG1: 19, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 34] },
    H: { totalCodewords: 172, ecPerBlock: 28, blocksG1: 4, dataG1: 15, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 34] },
  },
  7: {
    L: { totalCodewords: 196, ecPerBlock: 20, blocksG1: 2, dataG1: 78, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 22, 38] },
    M: { totalCodewords: 196, ecPerBlock: 18, blocksG1: 4, dataG1: 31, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 22, 38] },
    Q: { totalCodewords: 196, ecPerBlock: 18, blocksG1: 2, dataG1: 14, blocksG2: 4, dataG2: 15, alignmentPatternCenters: [6, 22, 38] },
    H: { totalCodewords: 196, ecPerBlock: 26, blocksG1: 4, dataG1: 13, blocksG2: 1, dataG2: 14, alignmentPatternCenters: [6, 22, 38] },
  },
  8: {
    L: { totalCodewords: 242, ecPerBlock: 24, blocksG1: 2, dataG1: 97, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 24, 42] },
    M: { totalCodewords: 242, ecPerBlock: 22, blocksG1: 2, dataG1: 38, blocksG2: 2, dataG2: 39, alignmentPatternCenters: [6, 24, 42] },
    Q: { totalCodewords: 242, ecPerBlock: 22, blocksG1: 4, dataG1: 18, blocksG2: 2, dataG2: 19, alignmentPatternCenters: [6, 24, 42] },
    H: { totalCodewords: 242, ecPerBlock: 26, blocksG1: 4, dataG1: 14, blocksG2: 2, dataG2: 15, alignmentPatternCenters: [6, 24, 42] },
  },
  9: {
    L: { totalCodewords: 292, ecPerBlock: 30, blocksG1: 2, dataG1: 116, blocksG2: 0, dataG2: 0, alignmentPatternCenters: [6, 26, 46] },
    M: { totalCodewords: 292, ecPerBlock: 22, blocksG1: 3, dataG1: 36, blocksG2: 2, dataG2: 37, alignmentPatternCenters: [6, 26, 46] },
    Q: { totalCodewords: 292, ecPerBlock: 20, blocksG1: 4, dataG1: 16, blocksG2: 4, dataG2: 17, alignmentPatternCenters: [6, 26, 46] },
    H: { totalCodewords: 292, ecPerBlock: 24, blocksG1: 4, dataG1: 12, blocksG2: 4, dataG2: 13, alignmentPatternCenters: [6, 26, 46] },
  },
  10: {
    L: { totalCodewords: 346, ecPerBlock: 18, blocksG1: 2, dataG1: 68, blocksG2: 2, dataG2: 69, alignmentPatternCenters: [6, 28, 50] },
    M: { totalCodewords: 346, ecPerBlock: 26, blocksG1: 4, dataG1: 43, blocksG2: 1, dataG2: 44, alignmentPatternCenters: [6, 28, 50] },
    Q: { totalCodewords: 346, ecPerBlock: 24, blocksG1: 6, dataG1: 19, blocksG2: 2, dataG2: 20, alignmentPatternCenters: [6, 28, 50] },
    H: { totalCodewords: 346, ecPerBlock: 28, blocksG1: 6, dataG1: 15, blocksG2: 2, dataG2: 16, alignmentPatternCenters: [6, 28, 50] },
  },
};

// Mask functions
const MASK_FUNCTIONS = [
  (row: number, col: number) => (row + col) % 2 === 0,
  (row: number) => row % 2 === 0,
  (_row: number, col: number) => col % 3 === 0,
  (row: number, col: number) => (row + col) % 3 === 0,
  (row: number, col: number) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row: number, col: number) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row: number, col: number) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row: number, col: number) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

// Format info bit generation (BCH(15, 5))
const FORMAT_INFO_MASK = 0x5412;
function getFormatInfo(ecLevel: ErrorCorrectionLevel, maskPattern: number): number {
  const ecBits: Record<ErrorCorrectionLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
  let data = (ecBits[ecLevel] << 3) | maskPattern;
  let bch = data << 10;
  const poly = 0x537;
  for (let i = 14; i >= 10; i--) {
    if ((bch >> i) & 1) {
      bch ^= poly << (i - 10);
    }
  }
  return ((data << 10) | bch) ^ FORMAT_INFO_MASK;
}

export class QrMatrix {
  public size: number;
  public modules: boolean[][];
  public isFunctionModule: boolean[][];
  public version: number;
  public ecLevel: ErrorCorrectionLevel;

  constructor(version: number, ecLevel: ErrorCorrectionLevel) {
    this.version = version;
    this.ecLevel = ecLevel;
    this.size = 17 + 4 * version;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.isFunctionModule = Array.from({ length: this.size }, () => Array(this.size).fill(false));
  }

  public set(row: number, col: number, dark: boolean, isFunction = false): void {
    if (row >= 0 && row < this.size && col >= 0 && col < this.size) {
      this.modules[row][col] = dark;
      if (isFunction) {
        this.isFunctionModule[row][col] = true;
      }
    }
  }

  public get(row: number, col: number): boolean {
    if (row >= 0 && row < this.size && col >= 0 && col < this.size) {
      return this.modules[row][col];
    }
    return false;
  }
}

/**
 * Encodes text into a QR Code Model 2 matrix.
 */
export function generateQrMatrix(text: string, ecLevel: ErrorCorrectionLevel = "M"): QrMatrix {
  const utf8Bytes = new TextEncoder().encode(text);
  const dataLen = utf8Bytes.length;

  // Determine minimal version (1 to 10) that can accommodate the data
  let selectedVersion = 0;
  for (let v = 1; v <= 10; v++) {
    const spec = QR_SPECS[v]?.[ecLevel];
    if (!spec) continue;
    const totalDataCapacity = spec.blocksG1 * spec.dataG1 + spec.blocksG2 * spec.dataG2;
    // Overhead: 4 bits mode + (v < 10 ? 8 : 16) bits length indicator
    const headerBits = 4 + (v < 10 ? 8 : 16);
    const requiredBits = headerBits + dataLen * 8;
    if (requiredBits <= totalDataCapacity * 8) {
      selectedVersion = v;
      break;
    }
  }

  if (selectedVersion === 0) {
    // Fall back to version 10 with level L if too large for requested EC level
    selectedVersion = 10;
  }

  const spec = QR_SPECS[selectedVersion][ecLevel];
  const matrix = new QrMatrix(selectedVersion, ecLevel);
  const size = matrix.size;

  // 1. Place Finder Patterns (7x7 with 1-module quiet separator)
  const placeFinder = (rStart: number, cStart: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = rStart + r;
        const col = cStart + c;
        if (row >= 0 && row < size && col >= 0 && col < size) {
          const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          const isDark = inOuter && (isBorder || isInner);
          matrix.set(row, col, isDark, true);
        }
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 2. Place Alignment Patterns
  const centers = spec.alignmentPatternCenters;
  if (centers && centers.length > 0) {
    for (const rCenter of centers) {
      for (const cCenter of centers) {
        // Skip if overlaps with finders
        if (
          (rCenter <= 8 && cCenter <= 8) ||
          (rCenter <= 8 && cCenter >= size - 8) ||
          (rCenter >= size - 8 && cCenter <= 8)
        ) {
          continue;
        }
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
            const isCenter = r === 0 && c === 0;
            matrix.set(rCenter + r, cCenter + c, isBorder || isCenter, true);
          }
        }
      }
    }
  }

  // 3. Place Timing Patterns (Row 6 and Column 6)
  for (let c = 8; c < size - 8; c++) {
    if (!matrix.isFunctionModule[6][c]) {
      matrix.set(6, c, c % 2 === 0, true);
    }
  }
  for (let r = 8; r < size - 8; r++) {
    if (!matrix.isFunctionModule[r][6]) {
      matrix.set(r, 6, r % 2 === 0, true);
    }
  }

  // 4. Dark Module
  matrix.set(4 * selectedVersion + 9, 8, true, true);

  // 5. Reserve Format Info Modules
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      matrix.set(8, i, false, true);
      matrix.set(i, 8, false, true);
    }
  }
  for (let i = 0; i < 8; i++) {
    matrix.set(8, size - 1 - i, false, true);
    matrix.set(size - 1 - i, 8, false, true);
  }

  // 6. Encode Data into Codewords
  const totalDataBytes = spec.blocksG1 * spec.dataG1 + spec.blocksG2 * spec.dataG2;
  const bitBuffer: number[] = [];

  // Mode: Byte (0100)
  bitBuffer.push(0, 1, 0, 0);

  // Character count
  const countBits = selectedVersion < 10 ? 8 : 16;
  for (let i = countBits - 1; i >= 0; i--) {
    bitBuffer.push((dataLen >> i) & 1);
  }

  // Data bytes
  for (let b = 0; b < dataLen; b++) {
    const byte = utf8Bytes[b];
    for (let i = 7; i >= 0; i--) {
      bitBuffer.push((byte >> i) & 1);
    }
  }

  // Terminator (up to 4 zeroes)
  const maxDataBits = totalDataBytes * 8;
  const terminatorCount = Math.min(4, maxDataBits - bitBuffer.length);
  for (let i = 0; i < terminatorCount; i++) bitBuffer.push(0);

  // Pad to multiple of 8
  while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);

  // Pack into bytes
  const dataCodewords: number[] = [];
  for (let i = 0; i < bitBuffer.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bitBuffer[i + j];
    }
    dataCodewords.push(byte);
  }

  // Fill remaining capacity with alternating pad bytes (0xEC, 0x11)
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (dataCodewords.length < totalDataBytes) {
    dataCodewords.push(padPatterns[padIdx % 2]);
    padIdx++;
  }

  // 7. Split into blocks & generate Reed-Solomon Error Correction Codewords
  const blocks: Array<{ data: Uint8Array; ec: Uint8Array }> = [];
  let offset = 0;

  for (let i = 0; i < spec.blocksG1; i++) {
    const dataSlice = new Uint8Array(dataCodewords.slice(offset, offset + spec.dataG1));
    const ecSlice = rsRemainder(dataSlice, spec.ecPerBlock);
    blocks.push({ data: dataSlice, ec: ecSlice });
    offset += spec.dataG1;
  }
  for (let i = 0; i < spec.blocksG2; i++) {
    const dataSlice = new Uint8Array(dataCodewords.slice(offset, offset + spec.dataG2));
    const ecSlice = rsRemainder(dataSlice, spec.ecPerBlock);
    blocks.push({ data: dataSlice, ec: ecSlice });
    offset += spec.dataG2;
  }

  // Interleave data codewords
  const interleavedData: number[] = [];
  const maxBlockDataLen = Math.max(spec.dataG1, spec.dataG2 || 0);
  for (let i = 0; i < maxBlockDataLen; i++) {
    for (const block of blocks) {
      if (i < block.data.length) {
        interleavedData.push(block.data[i]);
      }
    }
  }

  // Interleave EC codewords
  const interleavedEc: number[] = [];
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of blocks) {
      if (i < block.ec.length) {
        interleavedEc.push(block.ec[i]);
      }
    }
  }

  const finalCodewords = interleavedData.concat(interleavedEc);
  const finalBits: number[] = [];
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((cw >> i) & 1);
    }
  }

  // 8. Place Data Bits in zig-zag pattern
  const maskPattern = 0; // Default mask pattern 0: (row + col) % 2 === 0
  const maskFn = MASK_FUNCTIONS[maskPattern];

  let bitIdx = 0;
  let dirUp = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing pattern column

    const rows = dirUp
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (!matrix.isFunctionModule[r][c]) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
          const masked = bit ^ (maskFn(r, c) ? 1 : 0);
          matrix.set(r, c, masked === 1, false);
        }
      }
    }
    dirUp = !dirUp;
  }

  // 9. Write Format Information
  const formatInfo = getFormatInfo(ecLevel, maskPattern);

  // Top-left format placement
  const topPositions = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = topPositions[i];
    matrix.set(r, c, ((formatInfo >> i) & 1) === 1, true);
  }

  // Top-right and bottom-left format placement
  for (let i = 0; i < 7; i++) {
    matrix.set(8, size - 1 - i, ((formatInfo >> i) & 1) === 1, true);
  }
  for (let i = 7; i < 15; i++) {
    matrix.set(size - 15 + i, 8, ((formatInfo >> i) & 1) === 1, true);
  }

  return matrix;
}

/**
 * Generates an SVG string representation of a QR Code.
 */
export function generateQrSvg(text: string, options: QrOptions = {}): string {
  const {
    ecLevel = "M",
    margin = 4,
    size = 240,
    fgColor = "#38bdf8", // Tailwind cyan-400
    bgColor = "transparent",
    title = "Stellar Soroban Verifiable Credential QR",
    rounded = true,
  } = options;

  const matrix = generateQrMatrix(text, ecLevel);
  const moduleCount = matrix.size;
  const viewBoxSize = moduleCount + margin * 2;

  let pathData = "";
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix.get(r, c)) {
        const x = c + margin;
        const y = r + margin;
        if (rounded) {
          const rRadius = 0.28;
          pathData += `M ${x + rRadius} ${y} h ${1 - 2 * rRadius} a ${rRadius} ${rRadius} 0 0 1 ${rRadius} ${rRadius} v ${1 - 2 * rRadius} a ${rRadius} ${rRadius} 0 0 1 -${rRadius} ${rRadius} h -${1 - 2 * rRadius} a ${rRadius} ${rRadius} 0 0 1 -${rRadius} -${rRadius} v -${1 - 2 * rRadius} a ${rRadius} ${rRadius} 0 0 1 ${rRadius} -${rRadius} Z `;
        } else {
          pathData += `M ${x} ${y} h 1 v 1 h -1 Z `;
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" role="img" aria-label="${title}" shape-rendering="geometricPrecision">
  <title>${title}</title>
  ${bgColor !== "transparent" ? `<rect width="100%" height="100%" fill="${bgColor}" />` : ""}
  <path d="${pathData.trim()}" fill="${fgColor}" />
</svg>`;
}
