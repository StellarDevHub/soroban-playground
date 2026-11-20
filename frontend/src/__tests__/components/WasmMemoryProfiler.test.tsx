import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import WasmMemoryProfiler, {
  SOROBAN_MEMORY_LIMIT_BYTES,
} from "@/components/WasmMemoryProfiler";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";

// Mock HTMLCanvasElement.getContext for Jest environment
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    createImageData: jest.fn((w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    })),
    putImageData: jest.fn(),
  })) as any;
});

describe("WasmMemoryProfiler", () => {
  const normalProfile: WasmMemoryProfile = {
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
    stackEstimateBytes: 32768,
    heavyFunctions: [
      { name: "hello", estimatedSize: 40000, lineHint: 12 },
      { name: "transfer", estimatedSize: 20000, lineHint: 24 },
    ],
  };

  const highMemoryProfile: WasmMemoryProfile = {
    ...normalProfile,
    totalBytes: 220000, // > 80% of 256KB (209,715)
  };

  const exceedingMemoryProfile: WasmMemoryProfile = {
    ...normalProfile,
    totalBytes: 280000, // > 256KB (262,144)
  };

  it("renders null state message when no profile is passed", () => {
    render(<WasmMemoryProfiler profile={null} />);
    expect(
      screen.getByText(/No WASM memory profile available/i),
    ).toBeInTheDocument();
  });

  it("renders metric cards and section distribution", () => {
    render(<WasmMemoryProfiler profile={normalProfile} />);
    expect(screen.getByText(/WASM Memory Profiler/i)).toBeInTheDocument();
    expect(screen.getByText(/125.00 KB/i)).toBeInTheDocument();
    expect(screen.getByText(/Code \(Compiled Bytecode\)/i)).toBeInTheDocument();
  });

  it("switches to heatmap tab and renders memory canvas", () => {
    render(<WasmMemoryProfiler profile={normalProfile} />);
    const heatmapTab = screen.getByTestId("tab-heatmap");
    fireEvent.click(heatmapTab);

    expect(screen.getByTestId("memory-heatmap-canvas")).toBeInTheDocument();
    expect(
      screen.getByText(/Dynamic Linear Memory Allocation Canvas/i),
    ).toBeInTheDocument();
  });

  it("triggers warning when approaching 256KB ceiling (>80%)", () => {
    render(<WasmMemoryProfiler profile={highMemoryProfile} />);
    const alert = screen.getByTestId("soroban-memory-alert");
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByText(/Approaching Soroban 256KB Memory Ceiling/i),
    ).toBeInTheDocument();
  });

  it("triggers critical alert when exceeding 256KB limit", () => {
    render(<WasmMemoryProfiler profile={exceedingMemoryProfile} />);
    const alert = screen.getByTestId("soroban-memory-alert");
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByText(/Critical: Contract Exceeds Soroban 256KB/i),
    ).toBeInTheDocument();
  });

  it("calls onSelectFunction callback when heavy function is clicked", () => {
    const handleSelect = jest.fn();
    render(
      <WasmMemoryProfiler
        profile={normalProfile}
        onSelectFunction={handleSelect}
      />,
    );

    const functionsTab = screen.getByRole("button", { name: /Heavy Functions/i });
    fireEvent.click(functionsTab);

    const helloFn = screen.getByText("hello");
    fireEvent.click(helloFn);

    expect(handleSelect).toHaveBeenCalledWith("hello", 12);
  });
});
