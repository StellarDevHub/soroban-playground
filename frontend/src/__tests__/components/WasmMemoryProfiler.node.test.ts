import test from "node:test";
import assert from "node:assert";
import {
  SOROBAN_MEMORY_LIMIT_BYTES,
  SOROBAN_MEMORY_WARNING_THRESHOLD,
} from "../../components/WasmMemoryProfiler";

test("WasmMemoryProfiler: Soroban memory limit constants", () => {
  assert.strictEqual(SOROBAN_MEMORY_LIMIT_BYTES, 262144); // 256 * 1024
  assert.strictEqual(SOROBAN_MEMORY_WARNING_THRESHOLD, 0.8);
  const warningCutoff = SOROBAN_MEMORY_LIMIT_BYTES * SOROBAN_MEMORY_WARNING_THRESHOLD;
  assert.strictEqual(warningCutoff, 209715.2);
});
