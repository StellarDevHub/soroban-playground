"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  HardDrive,
  Layers,
  MemoryStick,
  Zap,
} from "lucide-react";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";
import {
  DoubleBufferedImageData,
  HEATMAP_CELL_PX,
  HEATMAP_COLS,
  HEATMAP_ROWS,
  SOROBAN_MEMORY_CEILING_BYTES,
  allocateCells,
  computeSegmentUsage,
  paintHeatmap,
  type SegmentUsage,
} from "@/utils/wasmMemoryHeatmap";

interface WasmMemoryProfilerProps {
  profile: WasmMemoryProfile | null;
  onSelectFunction?: (funcName: string, lineHint?: number) => void;
}

function formatBytes(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

const SEGMENT_META = [
  { key: "data", label: "Data segment", dot: "bg-rose-500" },
  { key: "stack", label: "Stack", dot: "bg-amber-500" },
  { key: "heap", label: "Heap", dot: "bg-emerald-400" },
] as const;

/**
 * Allocation heatmap drawn on a canvas. The two ImageData buffers are created
 * once and recycled (double-buffering) so redraws never allocate new pixel
 * arrays, and they are released on unmount.
 */
function MemoryHeatmapCanvas({ usage }: { usage: SegmentUsage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buffersRef = useRef<DoubleBufferedImageData | null>(null);
  const width = HEATMAP_COLS * HEATMAP_CELL_PX;
  const height = HEATMAP_ROWS * HEATMAP_CELL_PX;

  useEffect(() => {
    const canvas = canvasRef.current;
    // ImageData / 2D canvas are unavailable in some environments (e.g. jsdom).
    if (!canvas || typeof ImageData === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!buffersRef.current || buffersRef.current.disposed) {
      buffersRef.current = new DoubleBufferedImageData(width, height);
    }
    const buffers = buffersRef.current;
    paintHeatmap(buffers.backBuffer.data, allocateCells(usage));
    ctx.putImageData(buffers.swap(), 0, 0);
  }, [usage, width, height]);

  useEffect(
    () => () => {
      buffersRef.current?.dispose();
      buffersRef.current = null;
    },
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      role="img"
      aria-label={`Memory allocation heatmap: ${(usage.ratio * 100).toFixed(1)}% of the 256 KB ceiling used`}
      className="w-full rounded border border-white/10 bg-slate-950"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default function WasmMemoryProfiler({
  profile,
  onSelectFunction,
}: WasmMemoryProfilerProps) {
  const [activeTab, setActiveTab] = useState<
    "sections" | "functions" | "heatmap"
  >("sections");
  const usage = useMemo(
    () => (profile ? computeSegmentUsage(profile) : null),
    [profile],
  );

  if (!profile || !usage) {
    return (
      <div className="p-4 rounded-xl border border-white/10 bg-slate-900/60 text-slate-400 text-xs italic">
        No WASM memory profile available. Compile or upload a WASM file to
        inspect heap, stack, and section distributions.
      </div>
    );
  }

  const sectionColors: Record<number, string> = {
    0: "bg-purple-500", // Custom/Spec
    1: "bg-blue-400", // Type
    2: "bg-indigo-400", // Import
    3: "bg-cyan-400", // Function
    5: "bg-emerald-400", // Memory
    6: "bg-amber-400", // Global
    7: "bg-pink-400", // Export
    10: "bg-cyan-500", // Code
    11: "bg-rose-400", // Data
  };

  return (
    <div className="space-y-4 p-4 rounded-xl border border-white/10 bg-slate-900/90 text-slate-200 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-cyan-400 animate-pulse" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            WASM Memory Profiler & Allocation Visualizer
          </h3>
        </div>
        <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/5 text-[11px]">
          <button
            onClick={() => setActiveTab("sections")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTab === "sections"
                ? "bg-cyan-500/20 text-cyan-300 font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Sections
          </button>
          <button
            onClick={() => setActiveTab("functions")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTab === "functions"
                ? "bg-cyan-500/20 text-cyan-300 font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Functions ({profile.heavyFunctions.length})
          </button>
          <button
            onClick={() => setActiveTab("heatmap")}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              activeTab === "heatmap"
                ? "bg-cyan-500/20 text-cyan-300 font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Heatmap
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <HardDrive size={12} className="text-cyan-400" /> Total Size
          </div>
          <p className="mt-1 font-mono font-bold text-white text-sm">
            {formatBytes(profile.totalBytes)}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Database size={12} className="text-rose-400" /> Static Data
          </div>
          <p className="mt-1 font-mono font-bold text-rose-300 text-sm">
            {formatBytes(profile.staticDataBytes)}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <MemoryStick size={12} className="text-emerald-400" /> Heap Min/Max
          </div>
          <p className="mt-1 font-mono font-bold text-emerald-300 text-xs truncate">
            {formatBytes(profile.heapMinBytes)} /{" "}
            {profile.heapMaxBytes ? formatBytes(profile.heapMaxBytes) : "∞"}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Layers size={12} className="text-amber-400" /> Stack Footprint
          </div>
          <p className="mt-1 font-mono font-bold text-amber-300 text-sm">
            {formatBytes(profile.stackEstimateBytes)}
          </p>
        </div>
      </div>

      {/* Soroban 256 KB memory ceiling */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-[10px]">
            Memory vs Soroban ceiling
          </span>
          <span className="font-mono">
            {formatBytes(usage.total)} / {formatBytes(SOROBAN_MEMORY_CEILING_BYTES)}{" "}
            ({(usage.ratio * 100).toFixed(1)}%)
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full overflow-hidden bg-slate-950 border border-white/10"
          role="progressbar"
          aria-label="Memory usage against the Soroban ceiling"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(usage.ratio * 100))}
        >
          <div
            style={{ width: `${Math.min(100, usage.ratio * 100)}%` }}
            className={`h-full transition-all ${
              usage.pressure === "critical"
                ? "bg-rose-500"
                : usage.pressure === "warning"
                  ? "bg-amber-400"
                  : "bg-emerald-400"
            }`}
          />
        </div>
        {usage.pressure !== "ok" && (
          <div
            role={usage.pressure === "critical" ? "alert" : "status"}
            className={`flex items-start gap-2 rounded-lg border p-2 text-[11px] ${
              usage.pressure === "critical"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                : "border-amber-500/40 bg-amber-500/10 text-amber-200"
            }`}
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {usage.pressure === "critical"
                ? "Estimated memory meets or exceeds Soroban's 256 KB ceiling; this contract is likely to trap at runtime."
                : "Estimated memory is above 80% of Soroban's 256 KB ceiling. Reduce static data, stack depth or initial heap before deploying."}
            </span>
          </div>
        )}
      </div>

      {/* Visual Memory Allocation Heatmap Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-[10px]">
            WASM Bytecode Distribution
          </span>
          <span className="font-mono">{profile.sections.length} Sections</span>
        </div>
        <div className="h-3 w-full flex rounded-full overflow-hidden bg-slate-950 border border-white/10">
          {profile.sections.map((sec) => (
            <div
              key={sec.id}
              style={{ width: `${Math.max(sec.percentage, 1)}%` }}
              title={`${sec.name}: ${formatBytes(sec.sizeBytes)} (${sec.percentage}%)`}
              className={`h-full transition-all hover:brightness-125 cursor-pointer ${sectionColors[sec.id] || "bg-slate-600"}`}
            />
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "sections" && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {profile.sections.map((sec) => (
            <div
              key={sec.id}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-white/5 text-xs font-mono"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${sectionColors[sec.id] || "bg-slate-600"}`}
                />
                <span className="text-slate-200 truncate">{sec.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-slate-400">
                <span>{sec.percentage}%</span>
                <span className="font-bold text-cyan-300">
                  {formatBytes(sec.sizeBytes)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "functions" && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {profile.heavyFunctions.map((fn) => (
            <div
              key={fn.name}
              onClick={() => onSelectFunction?.(fn.name, fn.lineHint)}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-white/5 text-xs font-mono hover:bg-slate-800/60 cursor-pointer transition-all"
            >
              <div className="flex items-center gap-2 truncate">
                <Zap size={14} className="text-amber-400 shrink-0" />
                <span className="text-slate-200 truncate">{fn.name}</span>
              </div>
              <span className="font-bold text-emerald-400 shrink-0">
                {formatBytes(fn.estimatedSize)}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "heatmap" && (
        <div className="space-y-3 p-3 rounded-lg bg-slate-950/80 border border-white/5 text-xs">
          <div className="flex items-center gap-2 text-cyan-300 font-semibold">
            <BarChart3 size={14} /> Allocation Density Heatmap
          </div>
          <MemoryHeatmapCanvas usage={usage} />
          <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
            {SEGMENT_META.map(({ key, label, dot }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-1 rounded bg-slate-900 px-2 py-1"
              >
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  {label}
                </span>
                <span className="text-slate-400">
                  {formatBytes(usage[key])}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
            {profile.heavyFunctions
              .concat(
                Array.from(
                  { length: Math.max(0, 24 - profile.heavyFunctions.length) },
                  (_, i) => ({
                    name: `block_${i}`,
                    estimatedSize: (i + 1) * 128,
                  }),
                ),
              )
              .map((item, idx) => {
                const intensity = Math.min(
                  100,
                  Math.round(
                    (item.estimatedSize / (profile.totalBytes || 1)) * 1000,
                  ),
                );
                const colorClass =
                  intensity > 50
                    ? "bg-rose-500 text-white"
                    : intensity > 20
                      ? "bg-amber-500 text-slate-900"
                      : intensity > 5
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-slate-800 text-slate-400";

                return (
                  <div
                    key={idx}
                    title={`${item.name}: ${formatBytes(item.estimatedSize)}`}
                    className={`h-8 rounded flex items-center justify-center font-mono text-[9px] font-bold transition-transform hover:scale-105 cursor-pointer ${colorClass}`}
                  >
                    {formatBytes(item.estimatedSize).split(" ")[0]}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
