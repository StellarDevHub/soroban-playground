import { analyzeRustSyntax, type RustDiagnostic } from "@/lib/rustSyntax";

export type RustLanguageServiceStatus = "starting" | "ready" | "offline";

interface RustDocument {
  code: string;
  version: number;
  opened: boolean;
}

interface RustWorkerClientOptions {
  createWorker: () => Worker;
  onDiagnostics: (uri: string, diagnostics: RustDiagnostic[]) => void;
  onStatusChange: (status: RustLanguageServiceStatus) => void;
  analyzeOffline?: (code: string) => RustDiagnostic[];
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  startupTimeoutMs?: number;
  restartBaseDelayMs?: number;
  restartMaxDelayMs?: number;
}

export interface RustLanguageWorkerClient {
  analyze: (uri: string, code: string) => void;
  dispose: () => void;
}

export function createRustLanguageWorkerClient(
  options: RustWorkerClientOptions,
): RustLanguageWorkerClient {
  const {
    createWorker,
    onDiagnostics,
    onStatusChange,
    analyzeOffline = analyzeRustSyntax,
    heartbeatIntervalMs = 10_000,
    heartbeatTimeoutMs = 3_000,
    startupTimeoutMs = 5_000,
    restartBaseDelayMs = 250,
    restartMaxDelayMs = 5_000,
  } = options;

  const documents = new Map<string, RustDocument>();
  let worker: Worker | null = null;
  let status: RustLanguageServiceStatus = "starting";
  let disposed = false;
  let restartAttempts = 0;
  let nextRequestId = 0;
  let initializeRequestId: number | null = null;
  let pendingHeartbeatId: number | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;
  let restartTimeout: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (nextStatus: RustLanguageServiceStatus) => {
    if (status === nextStatus) return;
    status = nextStatus;
    onStatusChange(status);
  };

  const publishOfflineDiagnostics = () => {
    for (const [uri, document] of documents) {
      onDiagnostics(uri, analyzeOffline(document.code));
    }
  };

  const stopMonitoring = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
    if (startupTimeout) clearTimeout(startupTimeout);
    heartbeatInterval = null;
    heartbeatTimeout = null;
    startupTimeout = null;
    pendingHeartbeatId = null;
  };

  const postDocument = (target: Worker, uri: string, document: RustDocument) => {
    if (document.opened) {
      target.postMessage({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version: document.version },
          contentChanges: [{ text: document.code }],
        },
      });
      return;
    }

    target.postMessage({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "rust",
          version: document.version,
          text: document.code,
        },
      },
    });
    document.opened = true;
  };

  const scheduleRestart = () => {
    if (disposed || restartTimeout) return;
    const delay = Math.min(
      restartBaseDelayMs * 2 ** restartAttempts,
      restartMaxDelayMs,
    );
    restartAttempts += 1;
    restartTimeout = setTimeout(() => {
      restartTimeout = null;
      if (disposed) return;
      setStatus("starting");
      startWorker();
    }, delay);
  };

  const failWorker = (failedWorker?: Worker) => {
    if (disposed || restartTimeout) return;
    if (failedWorker && worker !== failedWorker) return;

    const previousWorker = worker;
    worker = null;
    initializeRequestId = null;
    for (const document of documents.values()) document.opened = false;
    stopMonitoring();
    previousWorker?.terminate();
    setStatus("offline");
    publishOfflineDiagnostics();
    scheduleRestart();
  };

  const startHeartbeat = (activeWorker: Worker) => {
    heartbeatInterval = setInterval(() => {
      if (pendingHeartbeatId !== null) {
        failWorker(activeWorker);
        return;
      }

      const heartbeatId = ++nextRequestId;
      pendingHeartbeatId = heartbeatId;
      heartbeatTimeout = setTimeout(
        () => failWorker(activeWorker),
        heartbeatTimeoutMs,
      );

      try {
        activeWorker.postMessage({
          jsonrpc: "2.0",
          id: heartbeatId,
          method: "$/heartbeat",
          params: {},
        });
      } catch {
        failWorker(activeWorker);
      }
    }, heartbeatIntervalMs);
  };

  function startWorker() {
    if (disposed) return;

    let nextWorker: Worker;
    try {
      nextWorker = createWorker();
    } catch {
      failWorker();
      return;
    }

    worker = nextWorker;
    nextWorker.onmessage = (event: MessageEvent) => {
      if (worker !== nextWorker || disposed) return;
      const message = event.data;

      if (message?.id === initializeRequestId) {
        if (startupTimeout) clearTimeout(startupTimeout);
        startupTimeout = null;
        initializeRequestId = null;
        if (message.error || !message.result) {
          failWorker(nextWorker);
          return;
        }
        setStatus("ready");
        try {
          nextWorker.postMessage({
            jsonrpc: "2.0",
            method: "initialized",
            params: {},
          });
          for (const [uri, document] of documents) {
            document.opened = false;
            postDocument(nextWorker, uri, document);
          }
        } catch {
          failWorker(nextWorker);
          return;
        }
        startHeartbeat(nextWorker);
        return;
      }

      if (message?.id === pendingHeartbeatId) {
        pendingHeartbeatId = null;
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
        restartAttempts = 0;
        return;
      }

      if (message?.method === "textDocument/publishDiagnostics") {
        const params = message.params;
        if (!params || typeof params.uri !== "string") return;
        const document = documents.get(params.uri);
        if (!document || params.version !== document.version) return;

        const diagnostics = Array.isArray(params.diagnostics)
          ? params.diagnostics.flatMap((diagnostic: unknown) => {
              if (!diagnostic || typeof diagnostic !== "object") return [];
              const value = diagnostic as {
                range?: {
                  start?: { line?: number; character?: number };
                  end?: { line?: number; character?: number };
                };
                severity?: number;
                message?: string;
              };
              const { start, end } = value.range ?? {};
              if (
                typeof start?.line !== "number" ||
                typeof start.character !== "number" ||
                typeof end?.line !== "number" ||
                typeof end.character !== "number" ||
                typeof value.message !== "string"
              ) {
                return [];
              }

              return [{
                startLineNumber: start.line + 1,
                startColumn: start.character + 1,
                endLineNumber: end.line + 1,
                endColumn: end.character + 1,
                severity:
                  value.severity === 1
                    ? "error" as const
                    : value.severity === 2
                      ? "warning" as const
                      : "info" as const,
                message: value.message,
              }];
            })
          : [];
        onDiagnostics(params.uri, diagnostics);
      }
    };
    nextWorker.onerror = () => failWorker(nextWorker);
    nextWorker.onmessageerror = () => failWorker(nextWorker);
    startupTimeout = setTimeout(
      () => failWorker(nextWorker),
      startupTimeoutMs,
    );

    initializeRequestId = ++nextRequestId;
    try {
      nextWorker.postMessage({
        jsonrpc: "2.0",
        id: initializeRequestId,
        method: "initialize",
        params: {
          processId: null,
          rootUri: null,
          capabilities: {},
          clientInfo: { name: "Soroban Playground", version: "1" },
        },
      });
    } catch {
      failWorker(nextWorker);
    }
  };

  onStatusChange(status);
  startWorker();

  return {
    analyze(uri, code) {
      if (disposed) return;
      const previousDocument = documents.get(uri);
      const document = {
        code,
        version: (previousDocument?.version ?? 0) + 1,
        opened: previousDocument?.opened ?? false,
      };
      documents.set(uri, document);

      if (status === "ready" && worker) {
        try {
          postDocument(worker, uri, document);
        } catch {
          failWorker(worker);
        }
      } else if (status === "offline") {
        onDiagnostics(uri, analyzeOffline(code));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (restartTimeout) clearTimeout(restartTimeout);
      restartTimeout = null;
      stopMonitoring();
      worker?.terminate();
      worker = null;
    },
  };
}