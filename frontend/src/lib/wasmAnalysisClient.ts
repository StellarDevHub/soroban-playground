import type { WasmAnalysisPayload } from "@/utils/wasmAnalysis";

/**
 * wasmAnalysisClient.ts — main-thread manager for the WASM analysis worker.
 * Follows the same lazy-worker + pending-request-map pattern as
 * `rustfmtClient.ts` / `useEventStream.ts`: one worker instance, request IDs,
 * and rejections on worker failure.
 */

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

type WasmAnalysisResponse = WasmAnalysisSuccess | WasmAnalysisFailure;

interface PendingRequest {
  resolve: (payload: WasmAnalysisPayload) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (worker) return worker;

  const analysisWorker = new Worker(
    new URL("../workers/wasmAnalysis.worker.ts", import.meta.url),
    { type: "module" },
  );

  analysisWorker.onmessage = (event: MessageEvent<WasmAnalysisResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) return;
    pendingRequests.delete(event.data.id);
    if (event.data.type === "error") {
      pending.reject(new Error(event.data.message));
    } else {
      pending.resolve(event.data.payload);
    }
  };

  analysisWorker.onerror = (event: ErrorEvent) => {
    worker = undefined;
    analysisWorker.terminate();
    const error = new Error(event.message || "WASM analysis worker failed");
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
  };

  worker = analysisWorker;
  return analysisWorker;
}

/**
 * Offloads the heavy static analysis of `bytes` (section walk, instruction
 * budget estimate, SHA-256) to the Web Worker and resolves with the
 * `WasmAnalysisPayload` summary (hash + section offsets) once done.
 */
export function analyzeWasmInWorker(bytes: Uint8Array): Promise<WasmAnalysisPayload> {
  return new Promise<WasmAnalysisPayload>((resolve, reject) => {
    const id = ++nextRequestId;
    const request: WasmAnalysisRequest = { id, bytes: bytes.slice() };
    let analysisWorker: Worker;
    try {
      analysisWorker = getWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    pendingRequests.set(id, { resolve, reject });
    try {
      analysisWorker.postMessage(request, [request.bytes.buffer]);
    } catch (error) {
      pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
