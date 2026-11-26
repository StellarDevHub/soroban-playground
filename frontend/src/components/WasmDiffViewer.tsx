"use client";

import React, { useCallback, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Binary,
  CheckCircle2,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  FileCode2,
  Filter,
  Layers,
  Maximize2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Rows3,
  Search,
  Sparkles,
  UploadCloud,
  Zap,
} from "lucide-react";
import {
  computeWasmDiff,
  disassembleWasmBinary,
  WASM_DIFF_PRESETS,
  type WasmDiffMetrics,
  type WasmDisassemblyResult,
} from "@/services/wasmDisassemblyService";
import type { WasmDisassemblySummary } from "@/workers/wasmDisassembly.worker";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-950/80 text-sm text-slate-400">
        <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
        Loading Monaco Side-by-Side Diff Engine…
      </div>
    ),
  },
);

function formatByteSize(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

export interface WasmDiffViewerProps {
  initialOriginalWat?: string;
  initialModifiedWat?: string;
  onDiffComputed?: (metrics: WasmDiffMetrics) => void;
}

export default function WasmDiffViewer({
  initialOriginalWat,
  initialModifiedWat,
  onDiffComputed,
}: WasmDiffViewerProps) {
  const defaultPreset = WASM_DIFF_PRESETS[0];

  const [originalWat, setOriginalWat] = useState<string>(
    initialOriginalWat || defaultPreset.originalWat,
  );
  const [modifiedWat, setModifiedWat] = useState<string>(
    initialModifiedWat || defaultPreset.modifiedWat,
  );

  const [originalFileName, setOriginalFileName] = useState<string>("baseline_contract.wasm");
  const [modifiedFileName, setModifiedFileName] = useState<string>("optimized_contract.wasm");

  const [originalSummary, setOriginalSummary] = useState<WasmDisassemblySummary>({
    byteSize: defaultPreset.originalBytes,
    watLineCount: defaultPreset.originalWat.split("\n").length,
    exports: [
      { name: "memory", kind: "memory" },
      { name: "increment", kind: "function" },
      { name: "get_count", kind: "function" },
    ],
    imports: [
      { module: "v", name: "get_current_call_stack", kind: "function" },
      { module: "e", name: "vec_new", kind: "function" },
    ],
    functionCount: 2,
    memoryCount: 1,
    tableCount: 0,
    globalCount: 0,
  });

  const [modifiedSummary, setModifiedSummary] = useState<WasmDisassemblySummary>({
    byteSize: defaultPreset.modifiedBytes,
    watLineCount: defaultPreset.modifiedWat.split("\n").length,
    exports: [
      { name: "memory", kind: "memory" },
      { name: "increment", kind: "function" },
      { name: "decrement", kind: "function" },
      { name: "get_count", kind: "function" },
    ],
    imports: [
      { module: "v", name: "get_current_call_stack", kind: "function" },
      { module: "l", name: "extend_current_contract_instance_and_code_ttl", kind: "function" },
    ],
    functionCount: 3,
    memoryCount: 1,
    tableCount: 0,
    globalCount: 0,
  });

  const [isSideBySide, setIsSideBySide] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"editor" | "breakdown" | "bloat">("editor");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Compute diff metrics
  const diffMetrics = useMemo(() => {
    const metrics = computeWasmDiff(originalSummary, modifiedSummary);
    if (onDiffComputed) onDiffComputed(metrics);
    return metrics;
  }, [originalSummary, modifiedSummary, onDiffComputed]);

  // Load Preset
  const handleSelectPreset = (presetId: string) => {
    const preset = WASM_DIFF_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    setOriginalWat(preset.originalWat);
    setModifiedWat(preset.modifiedWat);
    setOriginalFileName(`${preset.id}_baseline.wasm`);
    setModifiedFileName(`${preset.id}_target.wasm`);
    setErrorMessage(null);

    // Mock summary from preset
    const origLines = preset.originalWat.split("\n").length;
    const modLines = preset.modifiedWat.split("\n").length;

    setOriginalSummary({
      byteSize: preset.originalBytes,
      watLineCount: origLines,
      exports: [{ name: "export_baseline", kind: "function" }],
      imports: [{ module: "env", name: "host_fn", kind: "function" }],
      functionCount: 2,
      memoryCount: 1,
      tableCount: 0,
      globalCount: 0,
    });

    setModifiedSummary({
      byteSize: preset.modifiedBytes,
      watLineCount: modLines,
      exports: [
        { name: "export_baseline", kind: "function" },
        { name: "export_new", kind: "function" },
      ],
      imports: [{ module: "env", name: "host_fn", kind: "function" }],
      functionCount: 3,
      memoryCount: 1,
      tableCount: 0,
      globalCount: 0,
    });
  };

  // Upload handlers
  const handleUploadOriginal = useCallback(async (file: File) => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const result = await disassembleWasmBinary(buffer);
      setOriginalWat(result.wat);
      setOriginalSummary(result.summary);
      setOriginalFileName(file.name);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? `Baseline parse error: ${err.message}` : "Failed to parse baseline WASM",
      );
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleUploadModified = useCallback(async (file: File) => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const result = await disassembleWasmBinary(buffer);
      setModifiedWat(result.wat);
      setModifiedSummary(result.summary);
      setModifiedFileName(file.name);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? `Target parse error: ${err.message}` : "Failed to parse target WASM",
      );
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Copy WAT diff
  const handleCopyDiff = () => {
    const diffText = `;; ORIGINAL WAT: ${originalFileName}\n${originalWat}\n\n;; MODIFIED WAT: ${modifiedFileName}\n${modifiedWat}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(diffText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // Download WAT files
  const handleDownloadWat = (wat: string, filename: string) => {
    const blob = new Blob([wat], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/\.wasm$/i, "") + ".wat";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="w-full space-y-6" data-testid="wasm-diff-viewer">
      {/* Top Banner & Control Bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 shadow-2xl backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
              <Columns2 size={15} />
            </span>
            <h2 className="text-base font-semibold tracking-wide text-white">
              Interactive WASM Disassembly Diff Viewer
            </h2>
            <span className="rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[10px] font-semibold text-teal-300">
              Web Worker Powered
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Compare WebAssembly Text (WAT) instructions off the main thread with zero UI freezing.
          </p>
        </div>

        {/* View Toggle & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Preset Picker */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 p-1 text-xs">
            <span className="px-2 text-[11px] font-medium text-slate-500">Presets:</span>
            {WASM_DIFF_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset.id)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                title={preset.description}
              >
                {preset.id === "soroban-counter" ? "Counter" : "Token Auth"}
              </button>
            ))}
          </div>

          {/* Side-by-Side vs Unified Toggle */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900/60 p-1">
            <button
              onClick={() => setIsSideBySide(true)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                isSideBySide
                  ? "bg-teal-500/20 text-teal-300 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Split View (Side-by-Side)"
              data-testid="toggle-side-by-side"
            >
              <Columns2 size={13} />
              Side-by-Side
            </button>
            <button
              onClick={() => setIsSideBySide(false)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                !isSideBySide
                  ? "bg-teal-500/20 text-teal-300 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Unified View (Inline)"
              data-testid="toggle-inline"
            >
              <Rows3 size={13} />
              Inline
            </button>
          </div>

          {/* Copy & Export */}
          <button
            onClick={handleCopyDiff}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors"
          >
            {copySuccess ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copySuccess ? "Copied!" : "Copy WAT"}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-xs text-rose-300">
          <AlertCircle size={15} className="shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Bloat & Diff Metric Highlights */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {/* Footprint Delta */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5" data-testid="metric-footprint">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Binary Footprint
            </span>
            {diffMetrics.isBloatReduced ? (
              <span className="flex items-center gap-0.5 text-[11px] font-bold text-emerald-400">
                <ArrowDownRight size={13} />
                {Math.abs(diffMetrics.sizeDeltaPercentage)}%
              </span>
            ) : diffMetrics.sizeDeltaBytes > 0 ? (
              <span className="flex items-center gap-0.5 text-[11px] font-bold text-rose-400">
                <ArrowUpRight size={13} />
                +{diffMetrics.sizeDeltaPercentage}%
              </span>
            ) : (
              <span className="text-[11px] font-bold text-slate-400">0%</span>
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-base font-bold text-white">
              {formatByteSize(modifiedSummary.byteSize)}
            </span>
            <span className="text-[11px] text-slate-500">
              from {formatByteSize(originalSummary.byteSize)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {diffMetrics.sizeDeltaBytes < 0
              ? `${formatByteSize(Math.abs(diffMetrics.sizeDeltaBytes))} bloat reduction`
              : diffMetrics.sizeDeltaBytes > 0
              ? `+${formatByteSize(diffMetrics.sizeDeltaBytes)} footprint increase`
              : "Identical binary size"}
          </p>
        </div>

        {/* Function Delta */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Functions
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-base font-bold text-white">
              {modifiedSummary.functionCount}
            </span>
            <span
              className={`rounded px-1.5 py-0.2 text-[10px] font-semibold ${
                diffMetrics.functionCountDelta > 0
                  ? "bg-teal-500/10 text-teal-300"
                  : diffMetrics.functionCountDelta < 0
                  ? "bg-rose-500/10 text-rose-300"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {diffMetrics.functionCountDelta > 0 ? `+${diffMetrics.functionCountDelta}` : diffMetrics.functionCountDelta}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {modifiedSummary.watLineCount} total WAT lines
          </p>
        </div>

        {/* Added Exports */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Export Changes
          </span>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex items-center gap-1 font-mono text-xs font-semibold text-teal-300">
              <PlusCircle size={12} />
              {diffMetrics.addedExports.length} added
            </span>
            <span className="flex items-center gap-1 font-mono text-xs font-semibold text-rose-400">
              <MinusCircle size={12} />
              {diffMetrics.removedExports.length} removed
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {diffMetrics.addedExports.length > 0
              ? diffMetrics.addedExports.map((e) => e.name).join(", ")
              : "No added exports"}
          </p>
        </div>

        {/* Added Imports */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Host Imports
          </span>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex items-center gap-1 font-mono text-xs font-semibold text-cyan-300">
              <PlusCircle size={12} />
              {diffMetrics.addedImports.length} added
            </span>
            <span className="flex items-center gap-1 font-mono text-xs font-semibold text-slate-400">
              <MinusCircle size={12} />
              {diffMetrics.removedImports.length} removed
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {diffMetrics.addedImports.length > 0
              ? diffMetrics.addedImports.map((i) => `${i.module}.${i.name}`).join(", ")
              : "No added host imports"}
          </p>
        </div>

        {/* Memory / Table Status */}
        <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 sm:col-span-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Memory &amp; Table
          </span>
          <div className="mt-2 flex flex-col gap-1">
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                diffMetrics.memoryChanged ? "text-amber-300" : "text-emerald-400"
              }`}
            >
              <CheckCircle2 size={12} />
              Memory: {diffMetrics.memoryChanged ? "Pages Adjusted" : "Unchanged"}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
              Tables: {diffMetrics.tableChanged ? "Modified" : "Static"}
            </span>
          </div>
        </div>
      </div>

      {/* Dual File Upload / Drag Zones */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Baseline Input */}
        <div className="relative rounded-2xl border border-slate-800 bg-slate-950/40 p-4 transition-all hover:border-slate-700">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Baseline / Original Binary
              </span>
            </div>
            <button
              onClick={() => handleDownloadWat(originalWat, originalFileName)}
              className="text-[11px] text-slate-400 hover:text-teal-300 transition-colors"
              title="Download baseline WAT"
            >
              <Download size={12} className="inline mr-1" />
              WAT
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center gap-2.5 truncate">
              <Binary size={16} className="text-slate-400 shrink-0" />
              <div className="truncate">
                <p className="truncate font-mono text-xs font-medium text-slate-200">
                  {originalFileName}
                </p>
                <p className="text-[10px] text-slate-500">
                  {formatByteSize(originalSummary.byteSize)} · {originalSummary.watLineCount} WAT lines
                </p>
              </div>
            </div>
            <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition-colors shrink-0">
              Change
              <input
                type="file"
                accept=".wasm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadOriginal(file);
                }}
              />
            </label>
          </div>
        </div>

        {/* Target Input */}
        <div className="relative rounded-2xl border border-teal-900/40 bg-slate-950/40 p-4 transition-all hover:border-teal-700/60">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                Target / Modified Binary
              </span>
            </div>
            <button
              onClick={() => handleDownloadWat(modifiedWat, modifiedFileName)}
              className="text-[11px] text-teal-400 hover:text-teal-200 transition-colors"
              title="Download target WAT"
            >
              <Download size={12} className="inline mr-1" />
              WAT
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-dashed border-teal-800/40 bg-teal-950/10 p-3">
            <div className="flex items-center gap-2.5 truncate">
              <Binary size={16} className="text-teal-400 shrink-0" />
              <div className="truncate">
                <p className="truncate font-mono text-xs font-medium text-teal-200">
                  {modifiedFileName}
                </p>
                <p className="text-[10px] text-teal-400/80">
                  {formatByteSize(modifiedSummary.byteSize)} · {modifiedSummary.watLineCount} WAT lines
                </p>
              </div>
            </div>
            <label className="cursor-pointer rounded-lg border border-teal-700/60 bg-teal-900/40 px-2.5 py-1 text-[11px] font-medium text-teal-200 hover:bg-teal-800 transition-colors shrink-0">
              Change
              <input
                type="file"
                accept=".wasm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadModified(file);
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Tabs: Monaco DiffEditor vs Structural Breakdown */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("editor")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "editor"
                  ? "bg-teal-500/20 text-teal-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Side-by-Side WAT Editor
            </button>
            <button
              onClick={() => setActiveTab("breakdown")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "breakdown"
                  ? "bg-teal-500/20 text-teal-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Differential Matrix
            </button>
          </div>
          <span className="font-mono text-[11px] text-slate-500">
            Language: WAT (WebAssembly Text)
          </span>
        </div>

        {/* Tab 1: Monaco Diff Editor */}
        {activeTab === "editor" && (
          <div className="h-[520px] w-full bg-[#1e1e1e]" data-testid="monaco-diff-container">
            <DiffEditor
              height="520px"
              language="clike"
              theme="vs-dark"
              original={originalWat}
              modified={modifiedWat}
              options={{
                renderSideBySide: isSideBySide,
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineNumbers: "on",
                renderIndicators: true,
                smoothScrolling: true,
                wordWrap: "on",
              }}
            />
          </div>
        )}

        {/* Tab 2: Differential Matrix */}
        {activeTab === "breakdown" && (
          <div className="p-5 space-y-5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Export Identifiers &amp; Function Signatures
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <p className="text-xs font-medium text-slate-300 mb-2">
                    Baseline Exports ({originalSummary.exports.length})
                  </p>
                  <div className="space-y-1.5 font-mono text-xs">
                    {originalSummary.exports.map((e) => (
                      <div
                        key={e.name}
                        className="flex items-center justify-between rounded px-2 py-1 bg-slate-800/40 text-slate-300"
                      >
                        <span>{e.name}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{e.kind}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-teal-900/30 bg-teal-950/10 p-4">
                  <p className="text-xs font-medium text-teal-300 mb-2">
                    Target Exports ({modifiedSummary.exports.length})
                  </p>
                  <div className="space-y-1.5 font-mono text-xs">
                    {modifiedSummary.exports.map((e) => {
                      const isAdded = diffMetrics.addedExports.some((ae) => ae.name === e.name);
                      return (
                        <div
                          key={e.name}
                          className={`flex items-center justify-between rounded px-2 py-1 ${
                            isAdded
                              ? "bg-teal-500/20 text-teal-200 border border-teal-500/40"
                              : "bg-slate-800/40 text-slate-300"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {isAdded && <PlusCircle size={12} className="text-teal-400" />}
                            {e.name}
                          </span>
                          <span className="text-[10px] text-slate-500 uppercase">{e.kind}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Host Imports Diff */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Soroban Host Environment Imports
              </h3>
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="p-2.5">Module</th>
                      <th className="p-2.5">Symbol</th>
                      <th className="p-2.5">Kind</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950/60 text-slate-300">
                    {modifiedSummary.imports.map((imp) => {
                      const isAdded = diffMetrics.addedImports.some(
                        (ai) => ai.module === imp.module && ai.name === imp.name,
                      );
                      return (
                        <tr key={`${imp.module}:${imp.name}`}>
                          <td className="p-2.5 text-slate-400">{imp.module}</td>
                          <td className="p-2.5 text-teal-300">{imp.name}</td>
                          <td className="p-2.5 uppercase text-[10px] text-slate-500">{imp.kind}</td>
                          <td className="p-2.5">
                            {isAdded ? (
                              <span className="rounded bg-teal-500/10 px-2 py-0.5 text-[10px] font-semibold text-teal-300 border border-teal-500/30">
                                + Added Host Import
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px]">Existing</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
