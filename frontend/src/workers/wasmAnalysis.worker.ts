/// <reference lib="webworker" />

/**
 * wasmAnalysis.worker.ts
 *
 * Offloads the heavy static analysis of a .wasm artifact to a Web Worker so
 * the main thread stays responsive for large (>50KB) binaries:
 *
 *  • parseWasmSections      — chunked, offset-indexed section walk
 *                             (1-byte section ID + ULEB128 size prefix per
 *                             section; bounds-checked, never copies the
 *                             binary wholesale for header inspection)
 *  • estimateInstructionBudget — static best-effort instruction count from
 *                             the code section
 *  • sha256Hex              — SHA-256 of the full module (crypto.subtle with
 *                             a pure-JS fallback) — the cryptographic
 *                             commitment payload submitted to the chain for
 *                             verification via `verify_wasm_hash`.
 *
 * The worker replies with a `WasmAnalysisPayload` on success, or
 * `{ type: "error", message }` on failure.
 */

import { buildWasmAnalysisPayload, type WasmAnalysisPayload } from "@/utils/wasmAnalysis";

interface WasmAnalysisRequest {
  id: number;
  bytes: Uint8Array;
}

interface WasmAnalysisSuccess {
  type: "success";
  id: number;
  payload: WasmAnalysisPayload;
}

interface WasmAnalysisFailure {
  type: "error";
  id: number;
  message: string;
}

(self as DedicatedWorkerGlobalScope).onmessage = (
  event: MessageEvent<WasmAnalysisRequest>,
) => {
  const { id, bytes } = event.data;
  void (async () => {
    try {
      const payload = await buildWasmAnalysisPayload(bytes);
      const response: WasmAnalysisSuccess = { type: "success", id, payload };
      (self as DedicatedWorkerGlobalScope).postMessage(response);
    } catch (err) {
      const response: WasmAnalysisFailure = {
        type: "error",
        id,
        message: err instanceof Error ? err.message : "WASM analysis failed",
      };
      (self as DedicatedWorkerGlobalScope).postMessage(response);
    }
  })();
};

export {};
