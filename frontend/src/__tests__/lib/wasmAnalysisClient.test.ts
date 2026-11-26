import type { WasmAnalysisPayload } from "@/utils/wasmAnalysis";

const TEST_PAYLOAD: WasmAnalysisPayload = {
  sha256Hex: "deadbeef",
  sizeBytes: 4,
  sections: [],
  functionCount: 0,
  instructionEstimate: 0,
  codeSectionBytes: 0,
};

type MockResponse =
  | { type: "success"; payload: WasmAnalysisPayload }
  | { type: "error"; message: string }
  | { type: "worker-error"; message: string };

interface MockWorkerInstance {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  posted: Array<{ id: number; bytes: Uint8Array }>;
  terminated: boolean;
}

function createMockWorkerClass(
  handle: (msg: { id: number; bytes: Uint8Array }) => MockResponse,
): { MockAnalysisWorker: new () => MockWorkerInstance; instances: MockWorkerInstance[] } {
  const instances: MockWorkerInstance[] = [];
  class MockAnalysisWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    posted: Array<{ id: number; bytes: Uint8Array }> = [];
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage(msg: { id: number; bytes: Uint8Array }) {
      this.posted.push(msg);
      const response = handle(msg);
      if (response.type === "worker-error") {
        this.onerror?.({ message: response.message } as ErrorEvent);
        return;
      }
      if (response.type === "error") {
        this.onmessage?.({
          data: { type: "error", id: msg.id, message: response.message },
        });
        return;
      }
      this.onmessage?.({ data: { type: "success", id: msg.id, payload: response.payload } });
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { MockAnalysisWorker, instances };
}

describe("analyzeWasmInWorker", () => {
  const OriginalWorker = (global as { Worker?: unknown }).Worker;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    (global as { Worker?: unknown }).Worker = OriginalWorker;
  });

  it("resolves with the worker response payload and transfers the bytes", async () => {
    const { MockAnalysisWorker, instances } = createMockWorkerClass(() => ({
      type: "success",
      payload: TEST_PAYLOAD,
    }));
    (global as { Worker?: unknown }).Worker = MockAnalysisWorker;

    const { analyzeWasmInWorker } = await import("@/lib/wasmAnalysisClient");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(analyzeWasmInWorker(bytes)).resolves.toEqual(TEST_PAYLOAD);

    expect(instances).toHaveLength(1);
    expect(instances[0].posted).toHaveLength(1);
    expect(instances[0].posted[0].bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects when the worker reports an error", async () => {
    const { MockAnalysisWorker } = createMockWorkerClass(() => ({
      type: "error",
      message: "Invalid wasm: truncated",
    }));
    (global as { Worker?: unknown }).Worker = MockAnalysisWorker;

    const { analyzeWasmInWorker } = await import("@/lib/wasmAnalysisClient");
    await expect(analyzeWasmInWorker(new Uint8Array([1]))).rejects.toThrow(
      "Invalid wasm: truncated",
    );
  });

  it("rejects and terminates the worker when it fails", async () => {
    const { MockAnalysisWorker, instances } = createMockWorkerClass(() => ({
      type: "worker-error",
      message: "worker died",
    }));
    (global as { Worker?: unknown }).Worker = MockAnalysisWorker;

    const { analyzeWasmInWorker } = await import("@/lib/wasmAnalysisClient");
    await expect(analyzeWasmInWorker(new Uint8Array([1]))).rejects.toThrow("worker died");
    expect(instances[0].terminated).toBe(true);
  });

  it("rejects when posting to the worker throws", async () => {
    class ThrowingWorker {
      onmessage = null;
      onerror = null;
      terminated = false;
      constructor() {}
      postMessage(): never {
        throw new Error("post failed");
      }
      terminate() {
        this.terminated = true;
      }
    }
    (global as { Worker?: unknown }).Worker = ThrowingWorker;

    const { analyzeWasmInWorker } = await import("@/lib/wasmAnalysisClient");
    await expect(analyzeWasmInWorker(new Uint8Array([1]))).rejects.toThrow("post failed");
  });
});
