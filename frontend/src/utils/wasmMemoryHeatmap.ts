import type { WasmMemoryProfile } from "./wasmInspector";

/** Soroban linear memory is capped at four 64 KiB WebAssembly pages. */
export const WASM_PAGE_BYTES = 64 * 1024;
export const SOROBAN_MEMORY_CEILING_BYTES = 4 * WASM_PAGE_BYTES;
export const SOROBAN_MEMORY_WARNING_RATIO = 0.8;
export const SOROBAN_MEMORY_WARNING_BYTES =
  SOROBAN_MEMORY_CEILING_BYTES * SOROBAN_MEMORY_WARNING_RATIO;

export type MemoryPressureLevel = "normal" | "warning" | "critical";
export type MemorySegmentKey = "static" | "stack" | "heap" | "unallocated";

export interface MemorySegment {
  key: MemorySegmentKey;
  label: string;
  bytes: number;
  /** Percentage of the 256 KiB Soroban ceiling, not of the WASM file size. */
  percentage: number;
  color: readonly [number, number, number];
}

const SEGMENT_META: Record<
  MemorySegmentKey,
  { label: string; color: readonly [number, number, number] }
> = {
  static: { label: "Static Data", color: [251, 113, 133] },
  stack: { label: "Call Stack", color: [251, 191, 36] },
  heap: { label: "Dynamic Heap", color: [52, 211, 153] },
  unallocated: { label: "Unallocated", color: [30, 41, 59] },
};

export function formatMemoryBytes(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function heapBytesFor(profile: WasmMemoryProfile): number {
  return Math.max(0, profile.heapMaxBytes ?? profile.heapMinBytes ?? 0);
}

/** Estimated peak linear memory used by a contract during simulation. */
export function estimateLinearMemoryBytes(profile: WasmMemoryProfile): number {
  return Math.max(
    0,
    profile.staticDataBytes + profile.stackEstimateBytes + heapBytesFor(profile),
  );
}

export function getMemoryPressure(bytes: number): MemoryPressureLevel {
  if (bytes >= SOROBAN_MEMORY_CEILING_BYTES) return "critical";
  if (bytes >= SOROBAN_MEMORY_WARNING_BYTES) return "warning";
  return "normal";
}

/**
 * Builds the four segments of Soroban linear memory. Bytes are clamped to the
 * ceiling so a profile that already breaches it still produces a valid map.
 */
export function buildMemorySegments(
  profile: WasmMemoryProfile,
): MemorySegment[] {
  const cappedUsage = Math.min(
    estimateLinearMemoryBytes(profile),
    SOROBAN_MEMORY_CEILING_BYTES,
  );

  const staticBytes = Math.min(
    Math.max(0, profile.staticDataBytes),
    cappedUsage,
  );
  const stackBytes = Math.min(
    Math.max(0, profile.stackEstimateBytes),
    cappedUsage - staticBytes,
  );
  const heapBytes = Math.min(heapBytesFor(profile), cappedUsage - staticBytes - stackBytes);
  const unallocatedBytes = SOROBAN_MEMORY_CEILING_BYTES - cappedUsage;

  const sizes: Array<[MemorySegmentKey, number]> = [
    ["static", staticBytes],
    ["stack", stackBytes],
    ["heap", heapBytes],
    ["unallocated", unallocatedBytes],
  ];

  return sizes.map(([key, bytes]) => ({
    key,
    label: SEGMENT_META[key].label,
    bytes,
    percentage: Number(
      ((bytes / SOROBAN_MEMORY_CEILING_BYTES) * 100).toFixed(1),
    ),
    color: SEGMENT_META[key].color,
  }));
}
