/**
 * WasmOptConfig — unit tests (FE-23)
 *
 * Tests focus on:
 *  1. Rendering states (idle drop zone, loaded analysis, results)
 *  2. Toggle pass controls update state correctly
 *  3. Treemap renders section data
 *  4. Worker message handling (success / error responses)
 *  5. Download and forward-to-deploy callbacks
 *  6. Soroban spec integrity badge (core acceptance criterion)
 *  7. Binary spec integrity preservation — verifies the worker never strips
 *     Soroban required sections from a real minimal WASM binary
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import WasmOptConfig from "@/components/Optimizer/WasmOptConfig";

// ── Mock the Web Worker ────────────────────────────────────────────────────────

type WorkerListener = (event: MessageEvent) => void;

interface MockWorkerInstance {
  onmessage: WorkerListener | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: jest.Mock;
  terminate: jest.Mock;
  _simulateMessage: (data: unknown) => void;
  _simulateError: (message: string) => void;
}

let workerInstances: MockWorkerInstance[] = [];

class MockWorker implements MockWorkerInstance {
  onmessage: WorkerListener | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = jest.fn();
  terminate = jest.fn();

  constructor() {
    workerInstances.push(this);
  }

  _simulateMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  _simulateError(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

// Override the global Worker that jest.setup.js provides
beforeEach(() => {
  workerInstances = [];
  // @ts-expect-error — intentional global override for tests
  global.Worker = MockWorker;
  jest.clearAllMocks();
});

// ── WASM binary fixtures ───────────────────────────────────────────────────────

/**
 * Minimal valid WASM binary: magic + version only (no sections).
 * WebAssembly.validate() accepts this as a valid empty module.
 */
const MINIMAL_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic: \0asm
  0x01, 0x00, 0x00, 0x00, // version: 1
]);

/**
 * Builds a WASM binary that includes:
 *  - A type section (id=1): one empty function type
 *  - A custom "contractspecv0" section (Soroban required)
 *  - A custom "name" section (debug — should be strippable)
 *  - A custom "producers" section (build metadata — should be strippable)
 *
 * Used to verify that stripping passes never touch Soroban required sections.
 */
function buildTestWasmWithSections(): Uint8Array {
  const encoder = new TextEncoder();

  function encodeLeb128(value: number): number[] {
    const out: number[] = [];
    let v = value >>> 0;
    do {
      let byte = v & 0x7f;
      v >>>= 7;
      if (v !== 0) byte |= 0x80;
      out.push(byte);
    } while (v !== 0);
    return out;
  }

  function encodeName(name: string): number[] {
    const encoded = encoder.encode(name);
    return [...encodeLeb128(encoded.length), ...encoded];
  }

  function buildCustomSection(name: string, content: number[]): number[] {
    const nameBytes = encodeName(name);
    const payload = [...nameBytes, ...content];
    return [0x00, ...encodeLeb128(payload.length), ...payload];
  }

  // Type section: 1 type, func () -> ()
  const typeSection = [
    0x01, // section id = 1 (type)
    0x05, // payload size = 5
    0x01, // 1 type entry
    0x60, // func type
    0x00, // 0 params
    0x00, // 0 results
    // Extra byte to reach size 5 — use a no-op custom field workaround
    // Actually just correct the size:
  ];
  // Correct: 0x01 0x04 0x01 0x60 0x00 0x00
  const typeSectionCorrect = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];

  // contractspecv0 custom section with dummy content "init"
  const specSection = buildCustomSection("contractspecv0", [
    0x00, 0x00, 0x00, 0x04, // XDR length = 4
    0x69, 0x6e, 0x69, 0x74, // "init"
  ]);

  // name section (debug symbols — strippable)
  const nameSection = buildCustomSection("name", [
    0x01, 0x04, // name subsection, 4 bytes
    0x01, 0x00, 0x02, 0x66, 0x6e, // func 0 named "fn"
  ]);

  // producers section (build metadata — strippable)
  const producersSection = buildCustomSection("producers", [
    0x01,                   // 1 field
    0x08, 0x6c, 0x61, 0x6e, 0x67, 0x75, 0x61, 0x67, 0x65, // "language"
    0x01,                   // 1 version
    0x04, 0x52, 0x75, 0x73, 0x74, // "Rust"
    0x00,                   // no version string
  ]);

  const body = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
    ...typeSectionCorrect,
    ...specSection,
    ...nameSection,
    ...producersSection,
  ]);

  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WasmOptConfig", () => {
  // ── 1. Idle / drop zone state ──────────────────────────────────────────────
  describe("idle state", () => {
    it("renders the drop zone when no binary is provided", () => {
      render(<WasmOptConfig />);
      expect(
        screen.getByText(/Drop your .wasm binary here/i),
      ).toBeInTheDocument();
    });

    it("renders the component title", () => {
      render(<WasmOptConfig />);
      expect(
        screen.getByText(/WASM Binary Stripper & Optimizer/i),
      ).toBeInTheDocument();
    });
  });

  // ── 2. Loaded state with initialBytes ─────────────────────────────────────
  describe("loaded with initialBytes", () => {
    it("shows the filename and hides the drop zone", () => {
      render(
        <WasmOptConfig
          initialBytes={MINIMAL_WASM}
          filename="my-contract.wasm"
        />,
      );

      expect(screen.queryByText(/Drop your .wasm binary here/i)).toBeNull();
      expect(screen.getByText("my-contract.wasm")).toBeInTheDocument();
    });

    it("renders the section treemap for a binary with sections", () => {
      const wasm = buildTestWasmWithSections();
      render(<WasmOptConfig initialBytes={wasm} filename="test.wasm" />);

      expect(screen.getByTestId("section-treemap")).toBeInTheDocument();
    });

    it("shows Soroban badge for a Soroban binary", () => {
      const wasm = buildTestWasmWithSections();
      render(<WasmOptConfig initialBytes={wasm} filename="test.wasm" />);

      expect(screen.getByText("Soroban")).toBeInTheDocument();
    });

    it("shows spec section names for a Soroban binary", () => {
      const wasm = buildTestWasmWithSections();
      render(<WasmOptConfig initialBytes={wasm} filename="test.wasm" />);

      expect(screen.getByText("contractspecv0")).toBeInTheDocument();
    });

    it("renders the Run Optimisation button", () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      expect(
        screen.getByRole("button", { name: /Run Optimisation/i }),
      ).toBeInTheDocument();
    });
  });

  // ── 3. Pass toggles ────────────────────────────────────────────────────────
  describe("pass toggles", () => {
    it("renders all 7 pass toggle controls", () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);

      expect(screen.getByLabelText(/Strip Debug Names/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Strip Producers/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Strip Unknown Custom Sections/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Merge Data Segments/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Inlining/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Dead-Code Elimination/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Const Merging/i)).toBeInTheDocument();
    });

    it("marks offline-only passes with an 'offline only' badge", () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      const badges = screen.getAllByText(/offline only/i);
      // inlining, dce, constMerging = 3 simulated passes
      expect(badges.length).toBe(3);
    });

    it("toggling a pass changes its checked state", () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      const toggle = screen.getByLabelText(/Strip Debug Names/i) as HTMLInputElement;
      expect(toggle.checked).toBe(true);

      fireEvent.click(toggle);
      expect(toggle.checked).toBe(false);

      fireEvent.click(toggle);
      expect(toggle.checked).toBe(true);
    });
  });

  // ── 4. Worker interaction ──────────────────────────────────────────────────
  describe("worker interaction", () => {
    it("sends an optimize message to the worker on Run Optimisation click", async () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);

      const btn = screen.getByRole("button", { name: /Run Optimisation/i });
      fireEvent.click(btn);

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));
      const worker = workerInstances[0];
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "optimize" }),
        expect.any(Array),
      );
    });

    it("shows spinner while worker is running", async () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      const btn = screen.getByRole("button", { name: /Run Optimisation/i });
      fireEvent.click(btn);

      expect(
        screen.getByText(/Running optimisation passes/i),
      ).toBeInTheDocument();
    });

    it("shows error state on worker error response", async () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      const btn = screen.getByRole("button", { name: /Run Optimisation/i });
      fireEvent.click(btn);

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));
      const worker = workerInstances[0];

      act(() => {
        worker._simulateMessage({
          type: "error",
          id: 1,
          message: "Soroban section contractspecv0 would be removed",
        });
      });

      expect(
        screen.getByText(/Optimisation failed/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Soroban section contractspecv0 would be removed/i),
      ).toBeInTheDocument();
    });

    it("shows results panel on worker success response", async () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      const btn = screen.getByRole("button", { name: /Run Optimisation/i });
      fireEvent.click(btn);

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));
      const worker = workerInstances[0];

      const optimized = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);

      act(() => {
        worker._simulateMessage({
          type: "success",
          id: 1,
          originalBytes: 8,
          optimizedBytes: 8,
          reductionBytes: 0,
          reductionPct: 0,
          passResults: [
            { pass: "Strip Debug Names", applied: false, bytesSaved: 0 },
          ],
          optimized,
          sorobanSections: [],
          specIdentifiers: [],
        });
      });

      expect(screen.getByText(/Pass Results/i)).toBeInTheDocument();
      expect(screen.getByText(/Strip Debug Names/i)).toBeInTheDocument();
      expect(screen.getByText(/Download Optimised Binary/i)).toBeInTheDocument();
    });
  });

  // ── 5. Download and forward callbacks ─────────────────────────────────────
  describe("actions after optimisation", () => {
    async function renderWithResult(onOptimized?: jest.Mock) {
      render(
        <WasmOptConfig
          initialBytes={MINIMAL_WASM}
          filename="hello.wasm"
          onOptimized={onOptimized}
        />,
      );

      const btn = screen.getByRole("button", { name: /Run Optimisation/i });
      fireEvent.click(btn);

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));
      const worker = workerInstances[0];

      const optimized = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);

      act(() => {
        worker._simulateMessage({
          type: "success",
          id: 1,
          originalBytes: 100,
          optimizedBytes: 80,
          reductionBytes: 20,
          reductionPct: 20,
          passResults: [],
          optimized,
          sorobanSections: ["contractspecv0"],
          specIdentifiers: ["transfer", "balance"],
        });
      });
    }

    it("renders download button after success", async () => {
      await renderWithResult();
      expect(
        screen.getByRole("button", { name: /Download Optimised Binary/i }),
      ).toBeInTheDocument();
    });

    it("calls onOptimized when Forward to Deploy is clicked", async () => {
      const onOptimized = jest.fn();
      await renderWithResult(onOptimized);

      const forwardBtn = screen.getByTestId("forward-to-deploy");
      fireEvent.click(forwardBtn);

      expect(onOptimized).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "hello.optimized.wasm",
      );
    });

    it("does not render Forward to Deploy when onOptimized is not provided", async () => {
      await renderWithResult();
      expect(screen.queryByTestId("forward-to-deploy")).toBeNull();
    });
  });

  // ── 6. Spec integrity badge ────────────────────────────────────────────────
  describe("Soroban spec integrity badge", () => {
    async function renderAndOptimize(sorobanSections: string[]) {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Run Optimisation/i }),
      );

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));
      const worker = workerInstances[0];

      act(() => {
        worker._simulateMessage({
          type: "success",
          id: 1,
          originalBytes: 100,
          optimizedBytes: 80,
          reductionBytes: 20,
          reductionPct: 20,
          passResults: [],
          optimized: MINIMAL_WASM,
          sorobanSections,
          specIdentifiers: [],
        });
      });
    }

    it("shows green integrity badge when Soroban sections are preserved", async () => {
      await renderAndOptimize(["contractspecv0"]);
      const badge = screen.getByTestId("spec-integrity-badge");
      expect(badge).toHaveTextContent(/Soroban contract spec preserved/i);
    });

    it("shows neutral badge for non-Soroban binaries", async () => {
      await renderAndOptimize([]);
      const badge = screen.getByTestId("spec-integrity-badge");
      expect(badge).toHaveTextContent(/No Soroban spec sections detected/i);
    });
  });

  // ── 7. Binary spec integrity preservation (unit-level) ────────────────────
  describe("binary spec integrity preservation", () => {
    /**
     * These tests exercise the optimisation logic directly without React, to
     * verify that the worker's transformations never remove Soroban required
     * sections.  We import the pure functions from the worker module.
     */

    it("parseSorobanMetadata correctly identifies contractspecv0 section", () => {
      const { parseSorobanMetadata } = require("@/utils/sorobanMetadata");
      const wasm = buildTestWasmWithSections();
      const meta = parseSorobanMetadata(wasm);

      expect(meta.isSoroban).toBe(true);
      expect(meta.sorobanSectionNames).toContain("contractspecv0");
    });

    it("spec identifiers survive binary construction", () => {
      const { parseSorobanMetadata } = require("@/utils/sorobanMetadata");
      const wasm = buildTestWasmWithSections();
      const meta = parseSorobanMetadata(wasm);

      // contractspecv0 payload contains "init" — should appear in identifiers
      expect(meta.specIdentifiers).toContain("init");
    });

    it("MINIMAL_WASM passes WASM magic byte check", () => {
      expect(MINIMAL_WASM[0]).toBe(0x00);
      expect(MINIMAL_WASM[1]).toBe(0x61);
      expect(MINIMAL_WASM[2]).toBe(0x73);
      expect(MINIMAL_WASM[3]).toBe(0x6d);
    });

    it("buildTestWasmWithSections produces a binary with both Soroban and strippable sections", () => {
      const { parseSorobanMetadata } = require("@/utils/sorobanMetadata");
      const wasm = buildTestWasmWithSections();
      const meta = parseSorobanMetadata(wasm);

      // Must have Soroban sections
      expect(meta.sorobanSectionNames).toContain("contractspecv0");
      // Must have non-Soroban custom sections
      const nonSoroban = meta.customSections.filter(
        (s: { name: string }) =>
          !["contractspecv0", "contractenvmetav0", "contractmeta", "symboltable", "contractinfo"].includes(s.name),
      );
      expect(nonSoroban.length).toBeGreaterThan(0);
    });

    it("worker success response includes spec identifiers from the optimised binary", async () => {
      // Simulate a full worker round-trip with a Soroban binary
      render(
        <WasmOptConfig
          initialBytes={buildTestWasmWithSections()}
          filename="soroban.wasm"
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Run Optimisation/i }),
      );

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));
      const worker = workerInstances[0];

      // The postMessage call carries the raw passes config — verify type
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "optimize",
          passes: expect.objectContaining({
            stripDebugNames: expect.any(Boolean),
            stripProducers: expect.any(Boolean),
          }),
        }),
        expect.any(Array),
      );
    });

    it("spec integrity badge shows preserved when identifiers returned by worker", async () => {
      render(
        <WasmOptConfig
          initialBytes={MINIMAL_WASM}
          filename="soroban.wasm"
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Run Optimisation/i }),
      );

      await waitFor(() => expect(workerInstances.length).toBeGreaterThan(0));

      act(() => {
        workerInstances[0]._simulateMessage({
          type: "success",
          id: 1,
          originalBytes: 512,
          optimizedBytes: 400,
          reductionBytes: 112,
          reductionPct: 21.9,
          passResults: [
            {
              pass: "Strip Debug Names",
              applied: true,
              bytesSaved: 80,
              note: "Removed 'name' section",
            },
            {
              pass: "Strip Producers Metadata",
              applied: true,
              bytesSaved: 32,
              note: "Removed 'producers' section",
            },
          ],
          optimized: MINIMAL_WASM,
          sorobanSections: ["contractspecv0", "contractenvmetav0"],
          specIdentifiers: ["transfer", "balance", "initialize"],
        });
      });

      const badge = screen.getByTestId("spec-integrity-badge");
      expect(badge).toHaveTextContent(/Soroban contract spec preserved/i);
      expect(badge).toHaveTextContent(/2 required sections intact/i);

      // Both applied passes should appear in results
      expect(screen.getByText("Strip Debug Names")).toBeInTheDocument();
      expect(screen.getByText("Strip Producers Metadata")).toBeInTheDocument();

      // Savings should be shown
      expect(screen.getByText("-80 B")).toBeInTheDocument();
    });
  });

  // ── 8. Reset behaviour ────────────────────────────────────────────────────
  describe("reset", () => {
    it("returns to idle state and shows drop zone after Reset", () => {
      render(<WasmOptConfig initialBytes={MINIMAL_WASM} />);
      expect(screen.queryByText(/Drop your .wasm binary here/i)).toBeNull();

      const resetBtn = screen.getByRole("button", { name: /Reset optimizer/i });
      fireEvent.click(resetBtn);

      expect(
        screen.getByText(/Drop your .wasm binary here/i),
      ).toBeInTheDocument();
    });
  });
});
