import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import WasmMemoryProfiler from "@/components/WasmMemoryProfiler";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";

interface FakeContext {
  createImageData: jest.Mock;
  putImageData: jest.Mock;
}

describe("WasmMemoryProfiler", () => {
  const mockProfile: WasmMemoryProfile = {
    totalBytes: 128000,
    sections: [
      {
        id: 10,
        name: "Code (Compiled Bytecode)",
        sizeBytes: 80000,
        percentage: 62.5,
      },
      {
        id: 11,
        name: "Data (Static Memory Buffers)",
        sizeBytes: 20000,
        percentage: 15.6,
      },
    ],
    staticDataBytes: 20000,
    heapMinBytes: 65536,
    heapMaxBytes: 131072,
    stackEstimateBytes: 65536,
    heavyFunctions: [
      { name: "hello", estimatedSize: 40000, lineHint: 12 },
      { name: "transfer", estimatedSize: 20000, lineHint: 24 },
    ],
  };

  let fakeContext: FakeContext;
  let frameCallbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  const flushFrames = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      const pending = Array.from(frameCallbacks.values());
      frameCallbacks.clear();
      pending.forEach((callback) => callback(0));
    }
  };

  beforeEach(() => {
    fakeContext = {
      createImageData: jest.fn((width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      })),
      putImageData: jest.fn(),
    };

    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);

    frameCallbacks = new Map();
    nextFrameId = 1;

    if (typeof window.requestAnimationFrame !== "function") {
      Object.defineProperty(window, "requestAnimationFrame", {
        writable: true,
        configurable: true,
        value: jest.fn(),
      });
    }
    if (typeof window.cancelAnimationFrame !== "function") {
      Object.defineProperty(window, "cancelAnimationFrame", {
        writable: true,
        configurable: true,
        value: jest.fn(),
      });
    }

    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        frameCallbacks.set(id, callback);
        return id;
      });
    jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frameCallbacks.delete(id);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders null state message when no profile is passed", () => {
    render(<WasmMemoryProfiler profile={null} />);
    expect(
      screen.getByText(/No WASM memory profile available/i),
    ).toBeInTheDocument();
  });

  it("renders metric cards and section distribution", () => {
    render(<WasmMemoryProfiler profile={mockProfile} />);
    expect(screen.getByText(/WASM Memory Profiler/i)).toBeInTheDocument();
    expect(screen.getByText(/125.00 KB/i)).toBeInTheDocument(); // total bytes format
    expect(screen.getByText(/Code \(Compiled Bytecode\)/i)).toBeInTheDocument();
  });

  it("recycles two ImageData buffers across heatmap frames", () => {
    render(<WasmMemoryProfiler profile={mockProfile} />);

    fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));

    expect(screen.getByTestId("wasm-memory-heatmap-canvas")).toBeInTheDocument();

    act(() => {
      flushFrames(3);
    });

    // Buffers are allocated once, then written and swapped every frame.
    expect(fakeContext.createImageData).toHaveBeenCalledTimes(2);
    expect(fakeContext.putImageData).toHaveBeenCalledTimes(3);

    const presented = fakeContext.putImageData.mock.calls.map(
      (call) => call[0],
    );
    expect(presented[0]).not.toBe(presented[1]);
    expect(presented[0]).toBe(presented[2]);
    expect(new Set(presented).size).toBe(2);
  });

  it("cancels animation and drops buffers on unmount", () => {
    const { unmount } = render(<WasmMemoryProfiler profile={mockProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));

    act(() => {
      flushFrames(1);
    });
    expect(frameCallbacks.size).toBe(1);

    unmount();

    expect(frameCallbacks.size).toBe(0);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();

    const callsAfterUnmount = fakeContext.putImageData.mock.calls.length;
    act(() => {
      flushFrames(2);
    });
    expect(fakeContext.putImageData).toHaveBeenCalledTimes(callsAfterUnmount);
  });

  it("warns when usage approaches the 256 KB ceiling", () => {
    const profile: WasmMemoryProfile = {
      ...mockProfile,
      staticDataBytes: 40 * 1024,
      stackEstimateBytes: 64 * 1024,
      heapMaxBytes: 110 * 1024,
    };

    render(<WasmMemoryProfiler profile={profile} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/Approaching/);
    expect(screen.getByTestId("memory-ceiling-status")).toHaveTextContent(
      /214.00 KB/,
    );
  });

  it("alerts when usage breaches the 256 KB ceiling", () => {
    const profile: WasmMemoryProfile = {
      ...mockProfile,
      staticDataBytes: 40 * 1024,
      stackEstimateBytes: 64 * 1024,
      heapMaxBytes: 180 * 1024,
    };

    render(<WasmMemoryProfiler profile={profile} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/ceiling breached/i);
  });

  it("falls back to a static heatmap when canvas is unavailable", () => {
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    render(<WasmMemoryProfiler profile={mockProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));

    expect(
      screen.getByTestId("wasm-memory-heatmap-fallback"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("wasm-memory-heatmap-fallback").querySelectorAll("[data-segment]"),
    ).toHaveLength(4);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
