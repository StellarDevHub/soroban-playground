import { format } from "@scalar/rust-fmt";
import type { RustFormatDiagnostic, RustfmtConfig } from "@/lib/rustfmtDiagnostics";
import {
  parseRustfmtDiagnostic,
  parseRustfmtToml,
  applyRustfmtHeuristics,
} from "@/lib/rustfmtDiagnostics";

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
      const { id, code, config } = event.data;
      const parsedConfig =
        typeof config === "string"
          ? parseRustfmtToml(config)
          : config || {};

      let formatted: string;
      try {
        formatted = await format(code, {
          edition: parsedConfig.edition || "2021",
        });
      } catch (formatterErr) {
        // Fallback to heuristic formatting if scalar engine fails or is unavailable
        formatted = applyRustfmtHeuristics(code, parsedConfig);
      }

      // Apply user heuristics (tab_spaces, struct styling, etc.)
      const finalFormatted = applyRustfmtHeuristics(formatted, parsedConfig);
      const executionTimeMs = performance.now() - startTime;

      workerScope.postMessage({
        id,
        formatted: finalFormatted,
        executionTimeMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic = parseRustfmtDiagnostic(message);
      if (diagnostic) {
        workerScope.postMessage({
          id: event.data.id,
          diagnostics: [diagnostic],
          executionTimeMs: performance.now() - startTime,
        });
      } else {
        workerScope.postMessage({
          id: event.data.id,
          error: message,
          executionTimeMs: performance.now() - startTime,
        });
      }
    }
  })();
});
