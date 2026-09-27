/**
 * Lightweight, dependency-free reader for the Soroban-specific custom sections
 * that the Soroban SDK embeds into compiled `.wasm` artifacts.
 *
 * Known custom sections emitted by `soroban-cli` / `stellar contract build`:
 *  - `contractspecv0`  : XDR encoded contract spec (functions, types, doc)
 *  - `contractenvmetav0`: environment metadata (budget/cpu/memory limits)
 *  - `contractmeta`    : contract metadata (key/value pairs)
 *  - `symboltable`     : interned symbol table used by the Soroban host
 *  - `contractinfo`    : build info (source file, compiler version)
 */

export interface WasmCustomSection {
  id: number;
  name: string;
  sizeBytes: number;
  preview: string | null;
}

export interface SorobanMetadataReport {
  valid: boolean;
  totalSections: number;
  customSections: WasmCustomSection[];
  sorobanSectionNames: string[];
  isSoroban: boolean;
  specIdentifiers: string[];
  producers: string | null;
}

export const SOROBAN_CUSTOM_SECTIONS = [
  "contractspecv0",
  "contractenvmetav0",
  "contractmeta",
  "symboltable",
  "contractinfo",
] as const;

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d] as const;
const MAX_IDENTIFIER_LENGTH = 96;

interface Leb128 {
  value: number;
  next: number;
}

function readLeb128(bytes: Uint8Array, offset: number): Leb128 | null {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < bytes.length) {
    const current = bytes[cursor];
    value += (current & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((current & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 35) return null;
  }

  return null;
}

function readName(bytes: Uint8Array, offset: number): { value: string; next: number } | null {
  const length = readLeb128(bytes, offset);
  if (!length || length.value < 0) return null;
  const start = length.next;
  const end = start + length.value;
  if (end > bytes.length) return null;

  try {
    return {
      value: new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(start, end)),
      next: end,
    };
  } catch {
    return null;
  }
}

function previewPayload(payload: Uint8Array): string | null {
  const slice = payload.subarray(0, 160);
  let printable = 0;

  for (const byte of slice) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) {
      printable += 1;
    }
  }

  if (slice.length === 0 || printable / slice.length < 0.85) return null;

  const text = new TextDecoder("utf-8", { fatal: false }).decode(slice).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * Heuristic extraction of identifiers stored inside `contractspecv0`.
 *
 * XDR strings are encoded as a big-endian `u32` byte length followed by the
 * UTF-8 bytes, so a scan for well-formed short length-prefixed printable runs
 * recovers function and type names without pulling in a full XDR decoder.
 */
export function extractSpecIdentifiers(payload: Uint8Array): string[] {
  const found = new Set<string>();
  let cursor = 0;

  while (cursor + 4 <= payload.length && found.size < 400) {
    const length =
      ((payload[cursor] << 24) |
        (payload[cursor + 1] << 16) |
        (payload[cursor + 2] << 8) |
        payload[cursor + 3]) >>>
      0;

    if (length >= 1 && length <= MAX_IDENTIFIER_LENGTH && cursor + 4 + length <= payload.length) {
      const slice = payload.subarray(cursor + 4, cursor + 4 + length);
      let valid = true;
      for (const byte of slice) {
        const isAlphaNumeric =
          byte === 95 || // _
          (byte >= 48 && byte <= 57) || // 0-9
          (byte >= 65 && byte <= 90) || // A-Z
          (byte >= 97 && byte <= 122); // a-z
        if (!isAlphaNumeric) {
          valid = false;
          break;
        }
      }

      if (valid) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
        if (text.length > 1) found.add(text);
        cursor += 4 + length;
        continue;
      }
    }

    cursor += 1;
  }

  return Array.from(found);
}

export function parseSorobanMetadata(input: Uint8Array | ArrayBuffer): SorobanMetadataReport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  const report: SorobanMetadataReport = {
    valid: false,
    totalSections: 0,
    customSections: [],
    sorobanSectionNames: [],
    isSoroban: false,
    specIdentifiers: [],
    producers: null,
  };

  if (bytes.length < 8) return report;
  for (let index = 0; index < WASM_MAGIC.length; index += 1) {
    if (bytes[index] !== WASM_MAGIC[index]) return report;
  }
  report.valid = true;

  let offset = 8;

  while (offset < bytes.length) {
    const sectionId = bytes[offset];
    offset += 1;

    const size = readLeb128(bytes, offset);
    if (!size) break;

    offset = size.next;
    const end = offset + size.value;
    if (end > bytes.length) break;

    const payload = bytes.subarray(offset, end);
    report.totalSections += 1;

    if (sectionId === 0x00) {
      const name = readName(bytes, offset);
      if (name) {
        const customPayload = payload.subarray(name.next - offset);
        const section: WasmCustomSection = {
          id: sectionId,
          name: name.value,
          sizeBytes: size.value,
          preview: previewPayload(customPayload),
        };
        report.customSections.push(section);

        if ((SOROBAN_CUSTOM_SECTIONS as readonly string[]).includes(name.value)) {
          report.sorobanSectionNames.push(name.value);
        }

        if (name.value === "contractspecv0") {
          report.specIdentifiers = extractSpecIdentifiers(customPayload);
        }

        if (name.value === "producers") {
          report.producers = previewPayload(customPayload);
        }
      }
    }

    offset = end;
  }

  report.isSoroban = report.sorobanSectionNames.length > 0;
  return report;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
