import {
  createRustLanguageWorkerClient,
  type RustLanguageServiceStatus,
} from "@/lib/rustLanguageWorker";
import type { RustDiagnostic } from "@/lib/rustSyntax";

interface TestWorker extends Worker {
  emitMessage: (data: unknown) => void;
}

function createTestWorker(): TestWorker {
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: jest.fn(),
    terminate: jest.fn(),
    emitMessage(data: unknown) {
      worker.onmessage?.({ data } as MessageEvent);
    },
  } as unknown as TestWorker;

  return worker;
}

function initializeWorker(worker: TestWorker) {
  const initializeRequest = (worker.postMessage as jest.Mock).mock.calls
    .map(([message]) => message as { id?: number; method?: string })
    .find((message) => message.method === "initialize");

  if (!initializeRequest?.id) throw new Error("Missing LSP initialize request");
  worker.emitMessage({
    jsonrpc: "2.0",
    id: initializeRequest.id,
    result: { capabilities: { textDocumentSync: 1 } },
  });
}

describe("createRustLanguageWorkerClient", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("falls back on missed heartbeats, restarts, and replays the latest document", () => {
    const workers: TestWorker[] = [];
    const statuses: RustLanguageServiceStatus[] = [];
    const onDiagnostics = jest.fn();
    const analyzeOffline = jest.fn((): RustDiagnostic[] => []);
    const client = createRustLanguageWorkerClient({
      createWorker: () => {
        const worker = createTestWorker();
        workers.push(worker);
        return worker;
      },
      onDiagnostics,
      onStatusChange: (status) => statuses.push(status),
      analyzeOffline,
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 50,
      startupTimeoutMs: 200,
      restartBaseDelayMs: 20,
      restartMaxDelayMs: 20,
    });

    client.analyze("file:///lib.rs", "initial source");
    initializeWorker(workers[0]);
    client.analyze("file:///lib.rs", "latest source");

    jest.advanceTimersByTime(150);

    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("offline");
    expect(analyzeOffline).toHaveBeenCalledWith("latest source");

    jest.advanceTimersByTime(20);
    expect(workers).toHaveLength(2);
    initializeWorker(workers[1]);

    expect(statuses.at(-1)).toBe("ready");
    expect(workers[1].postMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: "file:///lib.rs",
          languageId: "rust",
          version: 2,
          text: "latest source",
        },
      },
    });

    client.dispose();
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
  });

  it("falls back and schedules restart when worker startup times out", () => {
    const workers: TestWorker[] = [];
    const statuses: RustLanguageServiceStatus[] = [];
    const client = createRustLanguageWorkerClient({
      createWorker: () => {
        const worker = createTestWorker();
        workers.push(worker);
        return worker;
      },
      onDiagnostics: jest.fn(),
      onStatusChange: (status) => statuses.push(status),
      startupTimeoutMs: 25,
      restartBaseDelayMs: 10,
    });

    client.analyze("file:///lib.rs", "source");
    jest.advanceTimersByTime(25);

    expect(statuses).toContain("offline");
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10);
    expect(workers).toHaveLength(2);

    client.dispose();
  });

  it("falls back and restarts after an uncaught worker error", () => {
    const workers: TestWorker[] = [];
    const statuses: RustLanguageServiceStatus[] = [];
    const onDiagnostics = jest.fn();
    const client = createRustLanguageWorkerClient({
      createWorker: () => {
        const worker = createTestWorker();
        workers.push(worker);
        return worker;
      },
      onDiagnostics,
      onStatusChange: (status) => statuses.push(status),
      restartBaseDelayMs: 10,
      restartMaxDelayMs: 10,
    });

    client.analyze("file:///lib.rs", "let value = 1];");
    initializeWorker(workers[0]);
    workers[0].onerror?.({ message: "worker crashed" } as ErrorEvent);

    expect(statuses).toContain("offline");
    expect(onDiagnostics).toHaveBeenCalledWith(
      "file:///lib.rs",
      expect.arrayContaining([
        expect.objectContaining({ message: "Unmatched closing bracket ']'" }),
      ]),
    );

    jest.advanceTimersByTime(10);
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it("applies only current-version LSP diagnostics", () => {
    const worker = createTestWorker();
    const onDiagnostics = jest.fn();
    const client = createRustLanguageWorkerClient({
      createWorker: () => worker,
      onDiagnostics,
      onStatusChange: jest.fn(),
    });
    const uri = "file:///lib.rs";

    initializeWorker(worker);
    client.analyze(uri, "first source");
    worker.emitMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        version: 1,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 2 },
              end: { line: 0, character: 3 },
            },
            severity: 1,
            message: "Unmatched bracket",
          },
        ],
      },
    });

    expect(onDiagnostics).toHaveBeenLastCalledWith(uri, [
      {
        startLineNumber: 1,
        startColumn: 3,
        endLineNumber: 1,
        endColumn: 4,
        severity: "error",
        message: "Unmatched bracket",
      },
    ]);

    client.analyze(uri, "second source");
    worker.emitMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, version: 1, diagnostics: [] },
    });
    expect(onDiagnostics).toHaveBeenCalledTimes(1);

    client.dispose();
  });
});