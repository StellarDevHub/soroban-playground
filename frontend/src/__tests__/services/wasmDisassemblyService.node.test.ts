import test from "node:test";
import assert from "node:assert";
import {
  computeWasmDiff,
  WASM_DIFF_PRESETS,
} from "../../services/wasmDisassemblyService";
import type { WasmDisassemblySummary } from "../../workers/wasmDisassembly.worker";

test("WasmDisassemblyService: computeWasmDiff accurately calculates bloat and differentials", () => {
  const original: WasmDisassemblySummary = {
    byteSize: 20000,
    watLineCount: 200,
    exports: [
      { name: "init", kind: "function" },
      { name: "memory", kind: "memory" },
    ],
    imports: [{ module: "env", name: "require_auth", kind: "function" }],
    functionCount: 5,
    memoryCount: 1,
    tableCount: 0,
    globalCount: 0,
  };

  const modified: WasmDisassemblySummary = {
    byteSize: 15000,
    watLineCount: 150,
    exports: [
      { name: "init", kind: "function" },
      { name: "execute", kind: "function" },
      { name: "memory", kind: "memory" },
    ],
    imports: [
      { module: "env", name: "require_auth", kind: "function" },
      { module: "env", name: "extend_ttl", kind: "function" },
    ],
    functionCount: 6,
    memoryCount: 1,
    tableCount: 0,
    globalCount: 0,
  };

  const diff = computeWasmDiff(original, modified);

  assert.strictEqual(diff.sizeDeltaBytes, -5000);
  assert.strictEqual(diff.sizeDeltaPercentage, -25);
  assert.strictEqual(diff.isBloatReduced, true);
  assert.strictEqual(diff.lineDelta, -50);
  assert.strictEqual(diff.functionCountDelta, 1);
  assert.strictEqual(diff.addedExports.length, 1);
  assert.strictEqual(diff.addedExports[0].name, "execute");
  assert.strictEqual(diff.addedImports.length, 1);
  assert.strictEqual(diff.addedImports[0].name, "extend_ttl");
  assert.strictEqual(diff.memoryChanged, false);
});

test("WasmDisassemblyService: Preset verification", () => {
  assert.strictEqual(WASM_DIFF_PRESETS.length >= 2, true);
  const counterPreset = WASM_DIFF_PRESETS[0];
  assert.strictEqual(counterPreset.id, "soroban-counter");
  assert.strictEqual(counterPreset.originalWat.includes("(module"), true);
  assert.strictEqual(counterPreset.modifiedWat.includes("(module"), true);
});
