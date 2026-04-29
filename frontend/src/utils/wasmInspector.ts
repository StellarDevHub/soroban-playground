import wabtFactory from "wabt";

const WASM_PAGE_SIZE_BYTES = 64 * 1024;

let wabtPromise: ReturnType<typeof wabtFactory> | null = null;

export interface WasmMemoryMetrics {
  source: "defined" | "imported" | "none";
  minPages: number | null;
  maxPages: number | null;
  minBytes: number | null;
  maxBytes: number | null;
  shared: boolean;
  memory64: boolean;
}

export interface WasmArtifactAnalysis {
  sizeBytes: number;
  sizeKiB: string;
  exportFunctions: string[];
  exportKinds: Record<string, number>;
  memory: WasmMemoryMetrics;
  wat: string;
  watLines: string[];
}

interface Leb128Result {
  value: number;
  nextOffset: number;
}

interface ParsedMemoryType {
  minPages: number;
  maxPages: number | null;
  shared: boolean;
  memory64: boolean;
  nextOffset: number;
}

interface ParsedMemorySection {
  source: "defined" | "imported";
  minPages: number;
  maxPages: number | null;
  shared: boolean;
  memory64: boolean;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function readUnsignedLeb128(bytes: Uint8Array, offset: number): Leb128Result {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < bytes.length) {
    const currentByte = bytes[cursor];
    value += (currentByte & 0x7f) * 2 ** shift;
    cursor += 1;

    if ((currentByte & 0x80) === 0) {
      return { value, nextOffset: cursor };
    }

    shift += 7;
    if (shift > 56) {
      throw new Error("Invalid wasm: malformed LEB128 integer");
    }
  }

  throw new Error("Invalid wasm: unexpected EOF while parsing LEB128");
}

function readWasmString(bytes: Uint8Array, offset: number): { value: string; nextOffset: number } {
  const size = readUnsignedLeb128(bytes, offset);
  const start = size.nextOffset;
  const end = start + size.value;

  if (end > bytes.length) {
    throw new Error("Invalid wasm: truncated UTF-8 string");
  }

  const decoder = new TextDecoder();
  return {
    value: decoder.decode(bytes.subarray(start, end)),
    nextOffset: end,
  };
}

function readMemoryType(bytes: Uint8Array, offset: number): ParsedMemoryType {
  const flags = readUnsignedLeb128(bytes, offset);
  const min = readUnsignedLeb128(bytes, flags.nextOffset);

  let cursor = min.nextOffset;
  let maxPages: number | null = null;
  if ((flags.value & 0x01) !== 0) {
    const max = readUnsignedLeb128(bytes, cursor);
    maxPages = max.value;
    cursor = max.nextOffset;
  }

  return {
    minPages: min.value,
    maxPages,
    shared: (flags.value & 0x02) !== 0,
    memory64: (flags.value & 0x04) !== 0,
    nextOffset: cursor,
  };
}

function skipLimits(bytes: Uint8Array, offset: number): number {
  const flags = readUnsignedLeb128(bytes, offset);
  let cursor = flags.nextOffset;

  cursor = readUnsignedLeb128(bytes, cursor).nextOffset;
  if ((flags.value & 0x01) !== 0) {
    cursor = readUnsignedLeb128(bytes, cursor).nextOffset;
  }

  return cursor;
}

function parseImportMemory(payload: Uint8Array): ParsedMemorySection | null {
  const countResult = readUnsignedLeb128(payload, 0);
  let cursor = countResult.nextOffset;

  for (let index = 0; index < countResult.value; index += 1) {
    cursor = readWasmString(payload, cursor).nextOffset;
    cursor = readWasmString(payload, cursor).nextOffset;

    if (cursor >= payload.length) {
      throw new Error("Invalid wasm: truncated import descriptor");
    }

    const descriptorKind = payload[cursor];
    cursor += 1;

    if (descriptorKind === 0x02) {
      const memory = readMemoryType(payload, cursor);
      return {
        source: "imported",
        minPages: memory.minPages,
        maxPages: memory.maxPages,
        shared: memory.shared,
        memory64: memory.memory64,
      };
    }

    if (descriptorKind === 0x00) {
      cursor = readUnsignedLeb128(payload, cursor).nextOffset;
      continue;
    }

    if (descriptorKind === 0x01) {
      cursor += 1;
      cursor = skipLimits(payload, cursor);
      continue;
    }

    if (descriptorKind === 0x03) {
      cursor += 2;
      continue;
    }

    if (descriptorKind === 0x04) {
      cursor = readUnsignedLeb128(payload, cursor).nextOffset;
      continue;
    }

    throw new Error(`Invalid wasm: unknown import descriptor kind ${String(descriptorKind)}`);
  }

  return null;
}

function parseDefinedMemory(payload: Uint8Array): ParsedMemorySection | null {
  const count = readUnsignedLeb128(payload, 0);
  if (count.value === 0) {
    return null;
  }

  const memory = readMemoryType(payload, count.nextOffset);
  return {
    source: "defined",
    minPages: memory.minPages,
    maxPages: memory.maxPages,
    shared: memory.shared,
    memory64: memory.memory64,
  };
}

function extractMemoryMetrics(bytes: Uint8Array): WasmMemoryMetrics {
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error("Invalid wasm: missing magic header");
  }

  let offset = 8;
  let importedMemory: ParsedMemorySection | null = null;
  let definedMemory: ParsedMemorySection | null = null;

  while (offset < bytes.length) {
    const sectionId = bytes[offset];
    offset += 1;

    const sectionSizeResult = readUnsignedLeb128(bytes, offset);
    offset = sectionSizeResult.nextOffset;
    const sectionEnd = offset + sectionSizeResult.value;

    if (sectionEnd > bytes.length) {
      throw new Error("Invalid wasm: truncated section payload");
    }

    const payload = bytes.subarray(offset, sectionEnd);

    if (sectionId === 0x02 && importedMemory === null) {
      importedMemory = parseImportMemory(payload);
    }

    if (sectionId === 0x05 && definedMemory === null) {
      definedMemory = parseDefinedMemory(payload);
    }

    offset = sectionEnd;
  }

  const selectedMemory = definedMemory ?? importedMemory;
  if (!selectedMemory) {
    return {
      source: "none",
      minPages: null,
      maxPages: null,
      minBytes: null,
      maxBytes: null,
      shared: false,
      memory64: false,
    };
  }

  return {
    source: selectedMemory.source,
    minPages: selectedMemory.minPages,
    maxPages: selectedMemory.maxPages,
    minBytes: selectedMemory.minPages * WASM_PAGE_SIZE_BYTES,
    maxBytes: selectedMemory.maxPages === null ? null : selectedMemory.maxPages * WASM_PAGE_SIZE_BYTES,
    shared: selectedMemory.shared,
    memory64: selectedMemory.memory64,
  };
}

async function getWabt() {
  if (!wabtPromise) {
    wabtPromise = wabtFactory();
  }

  return wabtPromise;
}

function countExportKinds(module: WebAssembly.Module): Record<string, number> {
  return WebAssembly.Module.exports(module).reduce<Record<string, number>>((counts, exportItem) => {
    counts[exportItem.kind] = (counts[exportItem.kind] ?? 0) + 1;
    return counts;
  }, {});
}

export async function parseWasmArtifact(base64Wasm: string): Promise<WasmArtifactAnalysis> {
  const bytes = decodeBase64ToBytes(base64Wasm);
  const compiledModule = await WebAssembly.compile(bytes as unknown as BufferSource);
  const wabt = await getWabt();

  const parsed = wabt.readWasm(bytes, {
    readDebugNames: true,
    exceptions: true,
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    simd: true,
    threads: true,
    function_references: true,
    multi_value: true,
    tail_call: true,
    bulk_memory: true,
    reference_types: true,
    annotations: true,
    code_metadata: true,
    gc: true,
    memory64: true,
    extended_const: true,
    relaxed_simd: true,
  });

  try {
    parsed.generateNames();
    parsed.applyNames();
  } catch {
    // Name generation is optional; skip if module metadata is incomplete.
  }

  try {
    const wat = parsed.toText({
      foldExprs: false,
      inlineExport: false,
    });

    const exportFunctions = WebAssembly.Module.exports(compiledModule)
      .filter((item) => item.kind === "function")
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));

    return {
      sizeBytes: bytes.byteLength,
      sizeKiB: (bytes.byteLength / 1024).toFixed(2),
      exportFunctions,
      exportKinds: countExportKinds(compiledModule),
      memory: extractMemoryMetrics(bytes),
      wat,
      watLines: wat.split(/\r?\n/),
    };
  } finally {
    parsed.destroy();
  }
}
