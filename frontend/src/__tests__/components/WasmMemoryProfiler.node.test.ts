import test from "node:test";
import assert from "node:assert";
import {
  SOROBAN_MEMORY_CEILING_BYTES,
  SOROBAN_MEMORY_WARNING_BYTES,
  buildMemorySegments,
  estimateLinearMemoryBytes,
  formatMemoryBytes,
  getMemoryPressure,
} from "../../utils/wasmMemoryHeatmap";
import type { WasmMemoryProfile } from "../../utils/wasmInspector";

const profile: WasmMemoryProfile = {
  totalBytes: 128000,
  sections: [],
  staticDataBytes: 20 * 1024,
  heapMinBytes: 64 * 1024,
  heapMaxBytes: 128 * 1024,
  stackEstimateBytes: 64 * 1024,
  heavyFunctions: [],
};

test("Soroban memory ceiling constants describe four 64 KiB pages", () => {
  assert.strictEqual(SOROBAN_MEMORY_CEILING_BYTES, 262144);
  assert.strictEqual(SOROBAN_MEMORY_WARNING_BYTES, 209715.2);
  assert.strictEqual(formatMemoryBytes(128000), "125.00 KB");
  assert.strictEqual(formatMemoryBytes(null), "n/a");
});

test("estimated linear memory includes static, stack and peak heap bytes", () => {
  assert.strictEqual(estimateLinearMemoryBytes(profile), 212992);
});

test("pressure thresholds flag warning and ceiling breach correctly", () => {
  assert.strictEqual(getMemoryPressure(209715.1), "normal");
  assert.strictEqual(getMemoryPressure(209715.2), "warning");
  assert.strictEqual(getMemoryPressure(262143), "warning");
  assert.strictEqual(getMemoryPressure(262144), "critical");
});

test("heatmap segments cover the full ceiling and clamp over-budget profiles", () => {
  const segments = buildMemorySegments(profile);
  assert.deepStrictEqual(
    segments.map((segment) => segment.key),
    ["static", "stack", "heap", "unallocated"],
  );
  assert.strictEqual(
    segments.reduce((sum, segment) => sum + segment.bytes, 0),
    SOROBAN_MEMORY_CEILING_BYTES,
  );
  assert.strictEqual(segments[2].bytes, 128 * 1024);
  assert.strictEqual(segments[3].bytes, 262144 - 212992);

  const overBudget = buildMemorySegments({
    ...profile,
    heapMaxBytes: 1024 * 1024,
  });
  assert.strictEqual(
    overBudget.reduce((sum, segment) => sum + segment.bytes, 0),
    SOROBAN_MEMORY_CEILING_BYTES,
  );
  assert.strictEqual(overBudget[3].bytes, 0);
});
