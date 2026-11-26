import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import WasmDiffViewer from "@/components/WasmDiffViewer";
import { computeWasmDiff } from "@/services/wasmDisassemblyService";
import type { WasmDisassemblySummary } from "@/workers/wasmDisassembly.worker";

// Mock @monaco-editor/react DiffEditor
jest.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    original,
    modified,
    options,
  }: {
    original: string;
    modified: string;
    options: { renderSideBySide: boolean };
  }) => (
    <div
      data-testid="monaco-diff-editor-mock"
      data-original={original}
      data-modified={modified}
      data-side-by-side={String(options.renderSideBySide)}
    />
  ),
}));

describe("WasmDiffViewer Component", () => {
  it("renders the diff viewer header and control bar", () => {
    render(<WasmDiffViewer />);
    expect(
      screen.getByText(/Interactive WASM Disassembly Diff Viewer/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Web Worker Powered/i)).toBeInTheDocument();
  });

  it("renders binary footprint and bloat reduction metrics", () => {
    render(<WasmDiffViewer />);
    const footprintCard = screen.getByTestId("metric-footprint");
    expect(footprintCard).toBeInTheDocument();
    expect(screen.getByText(/bloat reduction/i)).toBeInTheDocument();
  });

  it("toggles between Side-by-Side and Inline view modes", () => {
    render(<WasmDiffViewer />);
    const sideBySideBtn = screen.getByTestId("toggle-side-by-side");
    const inlineBtn = screen.getByTestId("toggle-inline");

    expect(sideBySideBtn).toBeInTheDocument();
    expect(inlineBtn).toBeInTheDocument();

    fireEvent.click(inlineBtn);
    // Button state changes
    expect(inlineBtn).toHaveClass("bg-teal-500/20");

    fireEvent.click(sideBySideBtn);
    expect(sideBySideBtn).toHaveClass("bg-teal-500/20");
  });

  it("switches to Differential Matrix tab and shows added exports & host imports", () => {
    render(<WasmDiffViewer />);
    const matrixTabBtn = screen.getByText(/Differential Matrix/i);
    fireEvent.click(matrixTabBtn);

    expect(
      screen.getByText(/Export Identifiers & Function Signatures/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Soroban Host Environment Imports/i),
    ).toBeInTheDocument();
  });

  it("switches preset to Token Auth and updates view", () => {
    render(<WasmDiffViewer />);
    const tokenPresetBtn = screen.getByRole("button", { name: /Token Auth/i });
    fireEvent.click(tokenPresetBtn);

    expect(tokenPresetBtn).toBeInTheDocument();
  });
});

describe("computeWasmDiff Unit Logic", () => {
  const origSummary: WasmDisassemblySummary = {
    byteSize: 10000,
    watLineCount: 100,
    exports: [{ name: "init", kind: "function" }],
    imports: [{ module: "env", name: "auth", kind: "function" }],
    functionCount: 1,
    memoryCount: 1,
    tableCount: 0,
    globalCount: 0,
  };

  const modSummary: WasmDisassemblySummary = {
    byteSize: 8500,
    watLineCount: 90,
    exports: [
      { name: "init", kind: "function" },
      { name: "execute", kind: "function" },
    ],
    imports: [
      { module: "env", name: "auth", kind: "function" },
      { module: "env", name: "extend_ttl", kind: "function" },
    ],
    functionCount: 2,
    memoryCount: 1,
    tableCount: 0,
    globalCount: 0,
  };

  it("calculates bloat reduction and delta percentages accurately", () => {
    const diff = computeWasmDiff(origSummary, modSummary);
    expect(diff.sizeDeltaBytes).toBe(-1500);
    expect(diff.sizeDeltaPercentage).toBe(-15.0);
    expect(diff.isBloatReduced).toBe(true);
    expect(diff.lineDelta).toBe(-10);
    expect(diff.addedExports).toHaveLength(1);
    expect(diff.addedExports[0].name).toBe("execute");
    expect(diff.addedImports).toHaveLength(1);
    expect(diff.addedImports[0].name).toBe("extend_ttl");
    expect(diff.functionCountDelta).toBe(1);
    expect(diff.memoryChanged).toBe(false);
  });
});
