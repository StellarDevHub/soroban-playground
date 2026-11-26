import {
  estimateInstructionBudget,
  parseWasmSections,
  sha256Fallback,
  sha256Hex,
  validateWasmHeader,
} from "@/utils/wasmAnalysis";

// ── module builders (fixed buffers, no allocations needed for small modules) ──

function encodeUleb128(value: number): number[] {
  const out: number[] = [];
  let v = value;
  do {
    let b = v & 0x7f;
    v >>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}

function buildModule(sections: Array<{ id: number; payload: number[] }>): number[] {
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  for (const { id, payload } of sections) {
    out.push(id, ...encodeUleb128(payload.length), ...payload);
  }
  return out;
}

// ── validateWasmHeader ─────────────────────────────────────────────────────────

describe("validateWasmHeader", () => {
  it("accepts a valid module header", () => {
    expect(
      validateWasmHeader(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])),
    ).toBe(true);
  });

  it("rejects invalid magic bytes", () => {
    expect(
      validateWasmHeader(new Uint8Array([0x00, 0x61, 0x73, 0x6e, 0x01, 0x00, 0x00, 0x00])),
    ).toBe(false);
  });

  it("rejects an invalid version", () => {
    expect(
      validateWasmHeader(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00])),
    ).toBe(false);
  });

  it("rejects short input", () => {
    expect(validateWasmHeader(new Uint8Array([0x00, 0x61, 0x73, 0x6d]))).toBe(false);
  });
});

// ── parseWasmSections (chunked, offset-indexed) ────────────────────────────────

describe("parseWasmSections", () => {
  it("walks a multi-section module with boundary-indexed offsets", () => {
    const wasmModule = buildModule([
      { id: 1, payload: [0x60, 0x00, 0x00] },
      { id: 2, payload: [0x01] },
      { id: 10, payload: [0x00, 0x0b] },
    ]);
    expect(parseWasmSections(new Uint8Array(wasmModule))).toEqual([
      { id: 1, sizeBytes: 3, payloadOffset: 10, endOffset: 13 },
      { id: 2, sizeBytes: 1, payloadOffset: 15, endOffset: 16 },
      { id: 10, sizeBytes: 2, payloadOffset: 18, endOffset: 20 },
    ]);
  });

  it("accepts a header-only module", () => {
    expect(parseWasmSections(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))).toEqual(
      [],
    );
  });

  it("rejects invalid magic bytes", () => {
    expect(() =>
      parseWasmSections(new Uint8Array([0x00, 0x61, 0x73, 0x6e, 0x01, 0x00, 0x00, 0x00])),
    ).toThrow(/magic/);
  });

  it("rejects an invalid version", () => {
    expect(() =>
      parseWasmSections(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00])),
    ).toThrow(/magic/);
  });

  it("rejects a section whose payload exceeds the module", () => {
    const wasmModule = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0a];
    expect(() => parseWasmSections(new Uint8Array(wasmModule))).toThrow(
      /truncated section payload/,
    );
  });
});

// ── estimateInstructionBudget ──────────────────────────────────────────────────

describe("estimateInstructionBudget", () => {
  it("returns zeros when there is no code section", () => {
    const wasmModule = buildModule([{ id: 1, payload: [0x60, 0x00, 0x00] }]);
    expect(estimateInstructionBudget(new Uint8Array(wasmModule))).toEqual({
      functionCount: 0,
      instructionEstimate: 0,
      codeSectionBytes: 0,
    });
  });

  it("counts function bodies and instructions in the code section", () => {
    // Code section (id 10): funcCount=1; one body of size 5:
    //   locals vec (0 entries) + i32.const 0, drop, end
    const codePayload = [0x01, 0x05, 0x00, 0x41, 0x00, 0x1a, 0x0b];
    const wasmModule = buildModule([{ id: 10, payload: codePayload }]);
    expect(estimateInstructionBudget(new Uint8Array(wasmModule))).toEqual({
      functionCount: 1,
      instructionEstimate: 3,
      codeSectionBytes: codePayload.length,
    });
  });

  it("throws on a truncated code section", () => {
    const wasmModule = buildModule([{ id: 10, payload: [0x01] }]);
    expect(() => estimateInstructionBudget(new Uint8Array(wasmModule))).toThrow(/truncated/);
  });
});

// ── SHA-256 ───────────────────────────────────────────────────────────────────

const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sha256Fallback", () => {
  it("matches the known SHA-256 of 'abc'", () => {
    expect(sha256Fallback(new Uint8Array([0x61, 0x62, 0x63]))).toBe(ABC_SHA256);
  });

  it("matches the known SHA-256 of the empty input", () => {
    expect(sha256Fallback(new Uint8Array(0))).toBe(EMPTY_SHA256);
  });
});

describe("sha256Hex", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("uses crypto.subtle when available", async () => {
    const digestMock = global.crypto.subtle.digest as jest.Mock;
    digestMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).resolves.toBe("010203");
  });

  it("falls back to the pure-JS implementation when subtle is missing", async () => {
    const originalCrypto = global.crypto;
    Object.defineProperty(global, "crypto", {
      value: {},
      configurable: true,
      writable: true,
    });
    try {
      await expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).resolves.toBe(ABC_SHA256);
    } finally {
      Object.defineProperty(global, "crypto", {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});
