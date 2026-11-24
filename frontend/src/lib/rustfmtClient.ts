import type { RustFormatDiagnostic, RustfmtConfig } from "@/lib/rustfmtDiagnostics";

export type RustFormatResult =
  | { formatted: string; executionTimeMs?: number }
  | { diagnostics: RustFormatDiagnostic[]; executionTimeMs?: number };

interface FormatRequest {
  id: number;
  code: string;
  config?: Partial<RustfmtConfig> | string;
}

interface FormatResponse {
  id: number;
  formatted?: string;
  diagnostics?: RustFormatDiagnostic[];
  error?: string;
  executionTimeMs?: number;
}

interface PendingRequest {
  resolve: (result: RustFormatResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (worker) return worker;

  const formatterWorker = new Worker(
    new URL("../workers/rustfmt.worker.ts", import.meta.url),
    { type: "module" },
  );
  formatterWorker.onmessage = (event: MessageEvent<FormatResponse>) => {
    const request = pendingRequests.get(event.data.id);
    if (!request) return;
    pendingRequests.delete(event.data.id);

    if (event.data.error) {
      request.reject(new Error(event.data.error));
    } else if (typeof event.data.formatted === "string") {
      request.resolve({
        formatted: event.data.formatted,
        executionTimeMs: event.data.executionTimeMs,
      });
    } else {
      request.resolve({
        diagnostics: event.data.diagnostics ?? [],
        executionTimeMs: event.data.executionTimeMs,
      });
    }
  };
  formatterWorker.onerror = (event: ErrorEvent) => {
    if (worker === formatterWorker) worker = undefined;
    formatterWorker.terminate();
    const error = new Error(event.message || "Rustfmt worker failed");
    for (const request of pendingRequests.values()) request.reject(error);
    pendingRequests.clear();
  };

  worker = formatterWorker;
  return formatterWorker;
}

export function formatRustInWorker(
  code: string,
  config?: Partial<RustfmtConfig> | string,
): Promise<RustFormatResult> {
  const formatterWorker = getWorker();
  const id = ++nextRequestId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    const request: FormatRequest = { id, code, config };
    try {
      formatterWorker.postMessage(request);
    } catch (error) {
      pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
