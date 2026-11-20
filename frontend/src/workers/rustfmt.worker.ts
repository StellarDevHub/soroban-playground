import { format } from "@scalar/rust-fmt";
import type {
  RustFormatDiagnostic,
  RustfmtConfig,
} from "@/lib/rustfmtDiagnostics";
import {
  parseRustfmtDiagnostic,
  resolveRustfmtOptions,
} from "@/lib/rustfmtDiagnostics";

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

const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<FormatRequest>) => void,
  ) => void;
  postMessage: (response: FormatResponse) => void;
};

workerScope.addEventListener("message", (event) => {
  void (async () => {
    const startTime = performance.now();
    try {
      const options = resolveRustfmtOptions(event.data.config);
      const formatted = await format(event.data.code, options as any);
      const durationMs = performance.now() - startTime;
      workerScope.postMessage({
        id: event.data.id,
        formatted,
        durationMs,
      });
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic = parseRustfmtDiagnostic(message);
      if (diagnostic) {
        workerScope.postMessage({
          id: event.data.id,
          diagnostics: [diagnostic],
          durationMs,
        });
      } else {
        workerScope.postMessage({
          id: event.data.id,
          error: message,
          durationMs,
        });
      }
    }
  })();
});
