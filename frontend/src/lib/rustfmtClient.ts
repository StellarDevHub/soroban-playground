import type {
  RustFormatDiagnostic,
  RustfmtConfig,
  RustFormatResult,
} from "@/lib/rustfmtDiagnostics";
import { formatRustCode } from "@/lib/rustfmtDiagnostics";

export type { RustFormatResult };

export interface FormatRequest {
  id: number;
  code: string;
  config?: RustfmtConfig | string;
}

export interface FormatResponse {
  id: number;
  formatted?: string;
  diagnostics?: RustFormatDiagnostic[];
  durationMs?: number;
  error?: string;
}

export interface PendingRequest {
  resolve: (result: RustFormatResult) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export interface RustfmtWorkerClientOptions {
  createWorker?: () => Worker;
  timeoutMs?: number;
}

export interface RustfmtWorkerClient {
  format: (
    code: string,
    config?: RustfmtConfig | string,
  ) => Promise<RustFormatResult>;
  dispose: () => void;
}

export function createRustfmtWorkerClient(
  options: RustfmtWorkerClientOptions = {},
): RustfmtWorkerClient {
  const {
    createWorker = () =>
      new Worker(new URL("../workers/rustfmt.worker.ts", import.meta.url), {
        type: "module",
      }),
    timeoutMs = 15_000,
  } = options;

  let worker: Worker | undefined;
  let nextRequestId = 0;
  const pendingRequests = new Map<number, PendingRequest>();
  let disposed = false;

  function ensureWorker(): Worker {
    if (worker) return worker;

    const formatterWorker = createWorker();
    formatterWorker.onmessage = (event: MessageEvent<FormatResponse>) => {
      const request = pendingRequests.get(event.data.id);
      if (!request) return;
      if (request.timeoutId) clearTimeout(request.timeoutId);
      pendingRequests.delete(event.data.id);

      if (event.data.error) {
        request.reject(new Error(event.data.error));
      } else if (typeof event.data.formatted === "string") {
        request.resolve({
          formatted: event.data.formatted,
          durationMs: event.data.durationMs,
        });
      } else {
        request.resolve({
          diagnostics: event.data.diagnostics ?? [],
          durationMs: event.data.durationMs,
        });
      }
    };

    formatterWorker.onerror = (event: ErrorEvent) => {
      if (worker === formatterWorker) worker = undefined;
      formatterWorker.terminate();
      const error = new Error(event.message || "Rustfmt worker failed");
      for (const request of pendingRequests.values()) {
        if (request.timeoutId) clearTimeout(request.timeoutId);
        request.reject(error);
      }
      pendingRequests.clear();
    };

    worker = formatterWorker;
    return formatterWorker;
  }

  function format(
    code: string,
    config?: RustfmtConfig | string,
  ): Promise<RustFormatResult> {
    if (disposed) {
      return Promise.reject(
        new Error("Rustfmt worker client has been disposed"),
      );
    }

    // Direct fallback if Worker is not supported or when running in SSR/Node without custom worker
    if (typeof Worker === "undefined" && !options.createWorker) {
      return formatRustCode(code, config);
    }

    try {
      const formatterWorker = ensureWorker();
      const id = ++nextRequestId;

      return new Promise((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`Formatting timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }

        pendingRequests.set(id, { resolve, reject, timeoutId });
        const request: FormatRequest = { id, code, config };
        try {
          formatterWorker.postMessage(request);
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId);
          pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } catch {
      return formatRustCode(code, config);
    }
  }

  function dispose() {
    disposed = true;
    for (const request of pendingRequests.values()) {
      if (request.timeoutId) clearTimeout(request.timeoutId);
      request.reject(new Error("Rustfmt worker terminated"));
    }
    pendingRequests.clear();
    if (worker) {
      worker.terminate();
      worker = undefined;
    }
  }

  return { format, dispose };
}

let defaultClient: RustfmtWorkerClient | undefined;

function getDefaultClient(): RustfmtWorkerClient {
  if (!defaultClient) {
    defaultClient = createRustfmtWorkerClient();
  }
  return defaultClient;
}

export function formatRustInWorker(
  code: string,
  config?: RustfmtConfig | string,
): Promise<RustFormatResult> {
  return getDefaultClient().format(code, config);
}

export function terminateRustfmtWorker(): void {
  if (defaultClient) {
    defaultClient.dispose();
    defaultClient = undefined;
  }
}
