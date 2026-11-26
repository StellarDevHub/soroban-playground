/**
 * wasmAnalysis.ts — shared pure logic for the WASM analysis Web Worker and
 * its on-chain counterparts (analysis-utils `inspect_wasm_sections` /
 * `verify_wasm_hash`).
 *
 * Everything here mirrors the on-chain chunked, offset-indexed parsing
 * contract: the WASM binary header is validated with a fixed buffer and each
 * section is read as a 1-byte ID + ULEB128 size prefix, with a "jump to
 * boundary" cursor and bounds-checked reads only — the binary is never
 * copied wholesale for header inspection.
 */

export interface WasmSectionSummary {
  /** Section identifier byte (0=custom, 1=type, 2=import, ...). */
  id: number;
  /** Section payload length as encoded by the ULEB128 size prefix. */
  sizeBytes: number;
  /** Absolute offset of the first payload byte. */
  payloadOffset: number;
  /** Absolute offset of the end of this section (start of the next one). */
  endOffset: number;
}

export interface InstructionBudgetEstimate {
  /** Number of function bodies counted in the code section. */
  functionCount: number;
  /** Best-effort count of instructions in the code section (estimate). */
  instructionEstimate: number;
  /** Code section payload size in bytes. */
  codeSectionBytes: number;
}

export interface WasmAnalysisPayload {
  /** Lowercase hex SHA-256 of the full module bytes (for on-chain verification). */
  sha256Hex: string;
  /** Total module size in bytes. */
  sizeBytes: number;
  /** Section table from the chunked offset-indexed walk. */
  sections: WasmSectionSummary[];
  /** Static function count recovered from the code section. */
  functionCount: number;
  /** Static instruction estimate (see estimateInstructionBudget). */
  instructionEstimate: number;
  /** Code section size in bytes. */
  codeSectionBytes: number;
}

// ── Header validation ─────────────────────────────────────────────────────────

const WASM_HEADER: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

export function validateWasmHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== WASM_HEADER[i]) return false;
  }
  return true;
}

// ── LEB128 helpers ────────────────────────────────────────────────────────────

interface Uleb128Result {
  value: number;
  nextOffset: number;
}

/**
 * Decodes an unsigned LEB128 varint at `offset`. Returns `null` when the
 * varint is truncated or longer than 5 bytes (a `u32` LEB128 is at most
 * 5 bytes long).
 */
function readUleb128(bytes: Uint8Array, offset: number): Uleb128Result | null {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const b = bytes[cursor];
    cursor += 1;
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) {
      return { value, nextOffset: cursor };
    }
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

/** Decodes a varint, returning a minimal 1-byte advance on failure (walker safety). */
function skipUlebBytes(bytes: Uint8Array, offset: number): number {
  return readUleb128(bytes, offset)?.nextOffset ?? offset + 1;
}

// ── Chunked, offset-indexed section walk ──────────────────────────────────────

export function parseWasmSections(bytes: Uint8Array): WasmSectionSummary[] {
  if (!validateWasmHeader(bytes)) {
    throw new Error("Invalid wasm: missing or invalid magic header / version");
  }
  const sections: WasmSectionSummary[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset];
    const size = readUleb128(bytes, offset + 1);
    if (!size) {
      throw new Error("Invalid wasm: malformed LEB128 section size");
    }
    const payloadOffset = size.nextOffset;
    const endOffset = payloadOffset + size.value;
    if (endOffset > bytes.length) {
      throw new Error("Invalid wasm: truncated section payload");
    }
    sections.push({ id, sizeBytes: size.value, payloadOffset, endOffset });
    // Jump to the next section boundary with the checked cursor.
    offset = endOffset;
  }
  return sections;
}

// ── Instruction budget estimation (best-effort static estimate) ───────────────

/**
 * Returns the offset just past the immediate bytes of the instruction at
 * `offset`. Unknown opcodes are treated as having no immediates; every step
 * always advances at least one byte, so the walk cannot loop forever.
 */
function skipInstruction(bytes: Uint8Array, offset: number): number {
  const op = bytes[offset];
  const i = offset + 1;

  // Control flow / constants / arithmetic without immediates.
  if (
    op === 0x00 || // unreachable
    op === 0x01 || // nop
    op === 0x05 || // else
    op === 0x0b || // end
    op === 0x0f || // return
    op === 0x1a || // drop
    op === 0x1b // select
  ) {
    return i;
  }
  if (op === 0x02 || op === 0x03 || op === 0x04) {
    return i + 1; // block / loop / if — blocktype
  }
  if (op === 0x1c) {
    // select_t: vec of valtypes.
    const count = readUleb128(bytes, i);
    return count ? count.nextOffset + count.value : i + 1;
  }
  if (op === 0x0c || op === 0x0d) {
    return skipUlebBytes(bytes, i); // br / br_if — label index
  }
  if (op === 0x0e) {
    // br_table: vec(labelidx) + default label index.
    const count = readUleb128(bytes, i);
    if (!count) return i + 1;
    let cursor = count.nextOffset;
    for (let k = 0; k < count.value; k += 1) {
      cursor = skipUlebBytes(bytes, cursor);
    }
    return skipUlebBytes(bytes, cursor);
  }
  if (op === 0x10) {
    return skipUlebBytes(bytes, i); // call — funcidx
  }
  if (op === 0x11) {
    return skipUlebBytes(bytes, skipUlebBytes(bytes, i)) + 1; // call_indirect — typeidx + table
  }
  if (op === 0x12) {
    return skipUlebBytes(bytes, i); // return_call — funcidx
  }
  if (op === 0x13) {
    return skipUlebBytes(bytes, skipUlebBytes(bytes, i)) + 1; // return_call_indirect — typeidx + table
  }
  if (op >= 0x20 && op <= 0x26) {
    return i + 1; // local/global/table get/set/tee — index
  }
  if (op >= 0x28 && op <= 0x3e) {
    return skipUlebBytes(bytes, skipUlebBytes(bytes, i)); // loads/stores — memarg (align + offset)
  }
  if (op === 0x3f || op === 0x40) {
    return i + 1; // memory.size / memory.grow — memory index
  }
  if (op === 0x41 || op === 0x42) {
    return skipUlebBytes(bytes, i); // i32.const / i64.const — s33/s64 leb (approx.)
  }
  if (op === 0x43) {
    return i + 4; // f32.const
  }
  if (op === 0x44) {
    return i + 8; // f64.const
  }
  if (op === 0xd0) {
    return i + 1; // ref.null — heaptype
  }
  if (op === 0xfc) {
    const sub = readUleb128(bytes, i);
    if (!sub) return i + 1;
    const next = sub.nextOffset;
    // Misc-prefix ops with immediates (estimate): 0x08/0x09 take two table
    // / element indices; 0x0A-0x0F take a single table/element/data index.
    if (sub.value === 0x08 || sub.value === 0x09) {
      return skipUlebBytes(bytes, skipUlebBytes(bytes, next));
    }
    if (sub.value >= 0x0a && sub.value <= 0x0f) {
      return next + 1;
    }
    return next;
  }
  if (op === 0xfd) {
    // SIMD prefix: extract/replace lane ops (sub-ops 0x00-0x0b) take a lane byte.
    const sub = readUleb128(bytes, i);
    if (!sub) return i + 1;
    return sub.value <= 0x0b ? sub.nextOffset + 1 : sub.nextOffset;
  }
  return i; // arithmetic / comparisons / conversions — no immediates
}

export function estimateInstructionBudget(
  bytes: Uint8Array,
  sections?: WasmSectionSummary[],
): InstructionBudgetEstimate {
  const parsed = sections ?? parseWasmSections(bytes);
  const codeSection = parsed.find((section) => section.id === 10);
  if (!codeSection) {
    return { functionCount: 0, instructionEstimate: 0, codeSectionBytes: 0 };
  }

  const payload = bytes.slice(codeSection.payloadOffset, codeSection.endOffset);
  const funcCount = readUleb128(payload, 0);
  if (!funcCount) {
    throw new Error("Invalid wasm: truncated code section function count");
  }
  let cursor = funcCount.nextOffset;
  let functionCount = 0;
  let instructionEstimate = 0;

  for (let f = 0; f < funcCount.value && f < payload.length; f += 1) {
    const bodySize = readUleb128(payload, cursor);
    if (!bodySize) {
      throw new Error("Invalid wasm: truncated function body size");
    }
    const bodyEnd = bodySize.nextOffset + bodySize.value;
    if (bodyEnd > payload.length) {
      throw new Error("Invalid wasm: truncated function body");
    }
    cursor = bodySize.nextOffset;

    // Locals vector: vec(count, valtype) entries.
    const locals = readUleb128(payload, cursor);
    if (!locals) {
      throw new Error("Invalid wasm: truncated locals declaration");
    }
    cursor = locals.nextOffset;
    for (let l = 0; l < locals.value && l < payload.length; l += 1) {
      cursor = skipUlebBytes(payload, cursor) + 1; // entry: count + single valtype
    }

    while (cursor < bodyEnd) {
      cursor = skipInstruction(payload, cursor);
      instructionEstimate += 1;
    }
    cursor = bodyEnd;
    functionCount += 1;
  }

  return {
    functionCount,
    instructionEstimate,
    codeSectionBytes: codeSection.sizeBytes,
  };
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Minimal pure-JS SHA-256 (fallback for environments without crypto.subtle). */
export function sha256Fallback(data: Uint8Array): string {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLength = data.length * 8;
  const total = Math.ceil((data.length + 1 + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(data);
  padded[data.length] = 0x80;
  for (let i = 0; i < 4; i += 1) {
    padded[total - 8 + i] = (Math.floor(bitLength / 0x100000000) >>> (24 - 8 * i)) & 0xff;
  }
  for (let i = 0; i < 4; i += 1) {
    padded[total - 4 + i] = (bitLength >>> (24 - 8 * i)) & 0xff;
  }

  const w = new Uint32Array(64);
  for (let block = 0; block < total; block += 64) {
    for (let t = 0; t < 16; t += 1) {
      const off = block + t * 4;
      w[t] =
        ((padded[off] << 24) |
          (padded[off + 1] << 16) |
          (padded[off + 2] << 8) |
          padded[off + 3]) >>>
        0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
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

  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += h[i].toString(16).padStart(8, "0");
  }
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const digest = await subtle.digest("SHA-256", bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Fallback(bytes);
}

// ── Payload assembly ──────────────────────────────────────────────────────────

export async function buildWasmAnalysisPayload(
  bytes: Uint8Array,
): Promise<WasmAnalysisPayload> {
  const sections = parseWasmSections(bytes);
  const budget = estimateInstructionBudget(bytes, sections);
  return {
    sha256Hex: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    sections,
    functionCount: budget.functionCount,
    instructionEstimate: budget.instructionEstimate,
    codeSectionBytes: budget.codeSectionBytes,
  };
}
