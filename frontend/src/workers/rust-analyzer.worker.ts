/// <reference lib="webworker" />

import { analyzeRustSyntax } from "../lib/rustSyntax";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent) => {
  const message = event.data;

  if (message?.type === "init") {
    workerScope.postMessage({ type: "ready" });
    return;
  }

  if (message?.type === "heartbeat") {
    workerScope.postMessage({ type: "heartbeat", id: message.id });
    return;
  }

  if (message?.type === "analyze" && typeof message.uri === "string") {
    workerScope.postMessage({
      type: "diagnostics",
      uri: message.uri,
      version: message.version,
      diagnostics: analyzeRustSyntax(String(message.code ?? "")),
    });
  }
};
