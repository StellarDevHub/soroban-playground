import {
  parseSorobanMetadata,
  SOROBAN_CUSTOM_SECTIONS,
} from "../utils/sorobanMetadata.ts";

export interface WasmOptPasses {
  stripDebugNames: boolean;
  stripProducers: boolean;
  stripUnknownCustom: boolean;
  mergeDataSegments: boolean;
  inlining: boolean;
  deadCodeElimination: boolean;
  constMerging: boolean;
}

export interface WasmOptPassResult {
  pass: string;
  applied: boolean;
  bytesSaved: number;
  note?: string;
}

export type SectionCategory = "code" | "data" | "types" | "custom" | "other";

export interface WasmSectionEntry {
  id: number;
  name: string;
  sizeBytes: number;
  category: SectionCategory;
}

export interface WasmSectionProfile {
  totalBytes: number;
  sections: WasmSectionEntry[];
  categories: Record<SectionCategory, number>;
}

export interface BytecodeProfile {
  before: WasmSectionProfile;
  after: WasmSectionProfile;
}

export type ProgressCallback = (stage: string, percent: number) => void;

export interface BinaryenModuleLike {
  runPasses(passes: readonly string[]): void;
  emitBinary(): Uint8Array;
  dispose(): void;
}

export interface BinaryenLike {
  setOptimizeLevel(level: number): number;
  setShrinkLevel(level: number): number;
  readBinary(bytes: Uint8Array): BinaryenModuleLike;
}

export interface OptimizeResult {
  output: Uint8Array;
  passResults: WasmOptPassResult[];
  profile: BytecodeProfile;
}

export interface ParsedSection {
  id: number;
  name: string | null;
  start: number;
  end: number;
  raw: Uint8Array;
}

const WASM_HEADER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const SECTION_NAMES: Record<number, string> = {
  0: "Custom / Spec",
  1: "Type Defs",
  2: "Imports",
  3: "Functions",
  4: "Tables",
  5: "Memory",
  6: "Globals",
  7: "Exports",
  8: "Start",
  9: "Elements",
  10: "Code",
  11: "Data",
  12: "Data Count",
};

const SECTION_CATEGORIES: Record<number, SectionCategory> = {
  0: "custom",
  1: "types",
  10: "code",
  11: "data",
};

const SOROBAN_REQUIRED = new Set<string>(
  SOROBAN_CUSTOM_SECTIONS as unknown as string[],
);

const ALWAYS_KEEP_CUSTOM = new Set<string>([
  ...SOROBAN_REQUIRED,
  "dylink",
  "dylink.0",
  "linking",
  "reloc.",
]);

const BINARYEN_PASS_GROUPS: Array<{
  name: string;
  stage: string;
  percent: number;
  passes: readonly string[];
  enabled: (passes: WasmOptPasses) => boolean;
}> = [
  {
    name: "Binaryen cleanup",
    stage: "Simplifying control flow with binaryen",
    percent: 55,
    passes: [
      "remove-unused-names",
      "remove-unused-brs",
      "merge-blocks",
      "simplify-locals",
      "vacuum",
      "untee",
      "simplify-globals",
    ],
    enabled: () => true,
  },
  {
    name: "Binaryen dead-code elimination",
    stage: "Removing unreachable code with binaryen",
    percent: 66,
    passes: ["dce", "remove-unused-module-elements"],
    enabled: (passes) => passes.deadCodeElimination,
  },
  {
    name: "Binaryen inlining",
    stage: "Inlining hot functions with binaryen",
    percent: 76,
    passes: ["inlining-optimizing"],
    enabled: (passes) => passes.inlining,
  },
  {
    name: "Binaryen constant folding",
    stage: "Folding constants with binaryen",
    percent: 84,
    passes: ["precompute", "optimize-casts", "reorder-locals", "optimize-instructions"],
    enabled: (passes) => passes.constMerging,
  },
];

function readLeb128(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = bytes[cursor++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

function decodeSectionName(bytes: Uint8Array, start: number, end: number): string | null {
  const length = readLeb128(bytes, start);
  if (!length || length.next + length.value > end) return null;
  try {
    return new TextDecoder().decode(bytes.subarray(length.next, length.next + length.value));
  } catch {
    return null;
  }
}

export function parseWasmSections(bytes: Uint8Array): ParsedSection[] | null {
  if (bytes.length < 8) return null;
  for (let i = 0; i < 4; i += 1) {
    if (bytes[i] !== WASM_HEADER[i]) return null;
  }

  const sections: ParsedSection[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset];
    const size = readLeb128(bytes, offset + 1);
    if (!size) break;
    const payloadStart = size.next;
    const payloadEnd = payloadStart + size.value;
    if (payloadEnd > bytes.length) break;
    const name = id === 0 ? decodeSectionName(bytes, payloadStart, payloadEnd) : null;
    sections.push({
      id,
      name,
      start: offset,
      end: payloadEnd,
      raw: bytes.subarray(offset, payloadEnd),
    });
    offset = payloadEnd;
  }
  return sections;
}

export function profileWasm(bytes: Uint8Array): WasmSectionProfile {
  const categories: Record<SectionCategory, number> = {
    code: 0,
    data: 0,
    types: 0,
    custom: 0,
    other: WASM_HEADER.length,
  };
  const sizes = new Map<number, number>();
  const sections = parseWasmSections(bytes) ?? [];

  for (const section of sections) {
    const size = section.end - section.start;
    sizes.set(section.id, (sizes.get(section.id) ?? 0) + size);
    categories[SECTION_CATEGORIES[section.id] ?? "other"] += size;
  }

  return {
    totalBytes: bytes.byteLength,
    sections: [
      { id: -1, name: "Header", sizeBytes: WASM_HEADER.length, category: "other" },
      ...Array.from(sizes.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, sizeBytes]) => ({
          id,
          name: SECTION_NAMES[id] ?? `Section ${id}`,
          sizeBytes,
          category: SECTION_CATEGORIES[id] ?? "other",
        })),
    ],
    categories,
  };
}

function assembleSections(keep: ParsedSection[]): Uint8Array {
  let length = WASM_HEADER.length;
  for (const section of keep) length += section.raw.length;
  const out = new Uint8Array(length);
  out.set(WASM_HEADER, 0);
  let cursor = WASM_HEADER.length;
  for (const section of keep) {
    out.set(section.raw, cursor);
    cursor += section.raw.length;
  }
  return out;
}

function stripCustomSections(
  sections: ParsedSection[],
  shouldStrip: (name: string) => boolean,
): { sections: ParsedSection[]; saved: number } {
  let saved = 0;
  const kept = sections.filter((section) => {
    if (section.id !== 0 || section.name === null) return true;
    if (SOROBAN_REQUIRED.has(section.name)) return true;
    if (shouldStrip(section.name)) {
      saved += section.raw.length;
      return false;
    }
    return true;
  });
  return { sections: kept, saved };
}

function restoreSorobanSections(input: Uint8Array, output: Uint8Array): Uint8Array {
  const inputSections = parseWasmSections(input);
  const outputSections = parseWasmSections(output);
  if (!inputSections || !outputSections) return output;

  const present = new Set(
    outputSections
      .filter((section) => section.id === 0 && section.name !== null)
      .map((section) => section.name),
  );
  const missing = inputSections.filter(
    (section) =>
      section.id === 0 &&
      section.name !== null &&
      SOROBAN_REQUIRED.has(section.name) &&
      !present.has(section.name),
  );
  if (missing.length === 0) return output;

  const restored = new Uint8Array(
    output.length + missing.reduce((sum, section) => sum + section.raw.length, 0),
  );
  restored.set(output, 0);
  let cursor = output.length;
  for (const section of missing) {
    restored.set(section.raw, cursor);
    cursor += section.raw.length;
  }
  return restored;
}

function isWasmValid(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61) return false;
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") {
    return true;
  }
  try {
    return WebAssembly.validate(bytes as unknown as BufferSource);
  } catch {
    return false;
  }
}

function verifyIntegrity(input: Uint8Array, output: Uint8Array): void {
  const before = parseSorobanMetadata(input);
  const after = parseSorobanMetadata(output);
  const missing = before.sorobanSectionNames.filter(
    (name) => !after.sorobanSectionNames.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Optimisation would remove required Soroban sections: ${missing.join(", ")}. Aborting to preserve contract spec integrity.`,
    );
  }
  if (
    before.specIdentifiers.length > 0 &&
    after.specIdentifiers.length < before.specIdentifiers.length
  ) {
    throw new Error("Optimisation lost contract spec identifiers. Aborting.");
  }
  if (!isWasmValid(output)) {
    throw new Error("Optimised binary failed WebAssembly validation. Aborting.");
  }
}

function runStructuralPasses(
  input: Uint8Array,
  passes: WasmOptPasses,
  onProgress?: ProgressCallback,
): { output: Uint8Array; passResults: WasmOptPassResult[] } {
  const originalSections = parseWasmSections(input);
  if (!originalSections) {
    return { output: input, passResults: [] };
  }

  let sections = originalSections;
  const passResults: WasmOptPassResult[] = [];

  const strip = (
    name: string,
    predicate: (sectionName: string) => boolean,
    note: string,
    stage: string,
    percent: number,
  ) => {
    onProgress?.(stage, percent);
    const result = stripCustomSections(sections, predicate);
    sections = result.sections;
    passResults.push({
      pass: name,
      applied: result.saved > 0,
      bytesSaved: result.saved,
      note: result.saved > 0 ? note : `${note} (no matching sections found)`,
    });
  };

  if (passes.stripDebugNames) {
    strip(
      "Strip Debug Names",
      (name) => name === "name",
      "Removed the 'name' custom section (debug symbol annotations)",
      "Stripping debug names",
      15,
    );
  }
  if (passes.stripProducers) {
    strip(
      "Strip Producers Metadata",
      (name) => name === "producers",
      "Removed the 'producers' custom section (build-tool metadata)",
      "Stripping producers metadata",
      25,
    );
  }
  if (passes.stripUnknownCustom) {
    strip(
      "Strip Unknown Custom Sections",
      (name) =>
        !ALWAYS_KEEP_CUSTOM.has(name) &&
        !name.startsWith("reloc.") &&
        name !== "name" &&
        name !== "producers",
      "Removed non-Soroban custom sections (DWARF / build metadata)",
      "Stripping non-Soroban custom sections",
      35,
    );
  }

  if (passes.mergeDataSegments) {
    const hasData = sections.some((section) => section.id === 0x0b);
    passResults.push({
      pass: "Merge Data Segments",
      applied: false,
      bytesSaved: 0,
      note: hasData
        ? "Adjacent data segments require an IR rewriter — use wasm-opt --merge-data-segments offline"
        : "No data section found",
    });
  }

  return { output: assembleSections(sections), passResults };
}

function runBinaryenPasses(
  input: Uint8Array,
  passes: WasmOptPasses,
  binaryen: BinaryenLike,
  onProgress?: ProgressCallback,
  passResults: WasmOptPassResult[] = [],
): Uint8Array {
  onProgress?.("Loading binaryen optimiser", 45);
  binaryen.setOptimizeLevel(2);
  binaryen.setShrinkLevel(1);

  const wasmModule = binaryen.readBinary(input);
  try {
    for (const group of BINARYEN_PASS_GROUPS) {
      if (!group.enabled(passes)) continue;
      onProgress?.(group.stage, group.percent);
      try {
        wasmModule.runPasses(group.passes);
        passResults.push({
          pass: group.name,
          applied: true,
          bytesSaved: 0,
          note: `binaryen: ${group.passes.join(", ")}`,
        });
      } catch {
        passResults.push({
          pass: group.name,
          applied: false,
          bytesSaved: 0,
          note: "Pass unavailable in this binaryen build",
        });
      }
    }
    onProgress?.("Emitting optimised bytecode", 88);
    const emitted = wasmModule.emitBinary();
    if (isWasmValid(emitted)) return new Uint8Array(emitted);
    return input;
  } finally {
    wasmModule.dispose();
  }
}

export async function optimiseWasm(
  input: Uint8Array,
  passes: WasmOptPasses,
  onProgress?: ProgressCallback,
  binaryen?: BinaryenLike | null,
): Promise<OptimizeResult> {
  onProgress?.("Reading binary", 5);
  const before = profileWasm(input);
  const structural = runStructuralPasses(input, passes, onProgress);
  let output = structural.output;
  const passResults = structural.passResults;

  if (binaryen && output.byteLength > 0) {
    try {
      const optimised = runBinaryenPasses(output, passes, binaryen, onProgress, passResults);
      if (optimised !== output) {
        const saved = output.byteLength - optimised.byteLength;
        passResults.push({
          pass: "Binaryen -Oz transforms",
          applied: true,
          bytesSaved: Math.max(0, saved),
          note: "In-browser binaryen optimisation (shrink level 1)",
        });
        output = optimised;
      }
    } catch (error) {
      passResults.push({
        pass: "Binaryen -Oz transforms",
        applied: false,
        bytesSaved: 0,
        note: error instanceof Error ? error.message : "Binaryen unavailable",
      });
    }
  }

  onProgress?.("Verifying contract spec", 92);
  output = restoreSorobanSections(input, output);
  verifyIntegrity(input, output);
  onProgress?.("Optimisation complete", 100);

  return {
    output,
    passResults,
    profile: { before, after: profileWasm(output) },
  };
}
