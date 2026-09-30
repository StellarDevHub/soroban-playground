import { analyzeRustSyntax, type RustDiagnostic } from "@/lib/rustSyntax";

export type RustLanguageServiceStatus = "starting" | "ready" | "offline";

interface RustDocument {
  code: string;
  version: number;
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
  let nextHeartbeatId = 0;
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
    target.postMessage({
      type: "analyze",
      uri,
      code: document.code,
      version: document.version,
    });
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

      const heartbeatId = ++nextHeartbeatId;
      pendingHeartbeatId = heartbeatId;
      heartbeatTimeout = setTimeout(
        () => failWorker(activeWorker),
        heartbeatTimeoutMs,
      );

      try {
        activeWorker.postMessage({ type: "heartbeat", id: heartbeatId });
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

      if (message?.type === "ready") {
        if (startupTimeout) clearTimeout(startupTimeout);
        startupTimeout = null;
        setStatus("ready");
        try {
          for (const [uri, document] of documents) {
            postDocument(nextWorker, uri, document);
          }
        } catch {
          failWorker(nextWorker);
          return;
        }
        startHeartbeat(nextWorker);
        return;
      }

      if (message?.type === "heartbeat" && message.id === pendingHeartbeatId) {
        pendingHeartbeatId = null;
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
        restartAttempts = 0;
        return;
      }

      if (message?.type === "diagnostics" && typeof message.uri === "string") {
        const document = documents.get(message.uri);
        if (!document || message.version !== document.version) return;
        onDiagnostics(message.uri, message.diagnostics ?? []);
      }
    };
    nextWorker.onerror = () => failWorker(nextWorker);
    nextWorker.onmessageerror = () => failWorker(nextWorker);
    startupTimeout = setTimeout(
      () => failWorker(nextWorker),
      startupTimeoutMs,
    );

    try {
      nextWorker.postMessage({ type: "init" });
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