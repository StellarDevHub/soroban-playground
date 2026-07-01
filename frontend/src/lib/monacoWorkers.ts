"use client";

type MonacoWorkerEnvironment = {
  getWorker: (_moduleId: string, label: string) => Worker;
  __sorobanPlaygroundConfigured?: boolean;
};

function createWorker(label: string): Worker {
  switch (label) {
    case "json":
      return new Worker(
        new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
        { type: "module", name: "monaco-json-worker" }
      );
    case "css":
    case "scss":
    case "less":
      return new Worker(
        new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
        { type: "module", name: "monaco-css-worker" }
      );
    case "html":
    case "handlebars":
    case "razor":
      return new Worker(
        new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
        { type: "module", name: "monaco-html-worker" }
      );
    case "typescript":
    case "javascript":
      return new Worker(
        new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
        { type: "module", name: "monaco-ts-worker" }
      );
    default:
      return new Worker(
        new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
        { type: "module", name: "monaco-editor-worker" }
      );
  }
}

export function configureMonacoWorkers() {
  if (typeof window === "undefined") return;

  const globalTarget = globalThis as typeof globalThis & {
    MonacoEnvironment?: MonacoWorkerEnvironment;
  };

  if (globalTarget.MonacoEnvironment?.__sorobanPlaygroundConfigured) return;

  globalTarget.MonacoEnvironment = {
    __sorobanPlaygroundConfigured: true,
    getWorker: (_moduleId: string, label: string) => createWorker(label),
  };
}

