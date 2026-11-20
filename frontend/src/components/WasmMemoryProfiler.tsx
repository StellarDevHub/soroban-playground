"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Flame,
  HardDrive,
  Info,
  Layers,
  MemoryStick,
  Sparkles,
  Zap,
} from "lucide-react";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";

export const SOROBAN_MEMORY_LIMIT_BYTES = 256 * 1024; // 256 KB (4 WASM pages)
export const SOROBAN_MEMORY_WARNING_THRESHOLD = 0.8; // 80% (204.8 KB)

export interface WasmMemoryProfilerProps {
  profile: WasmMemoryProfile | null;
  onSelectFunction?: (funcName: string, lineHint?: number) => void;
  simulationTick?: number;
}

function formatBytes(value: number | null): string {
  if (value === null || value === undefined) return "n/a";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export default function WasmMemoryProfiler({
  profile,
  onSelectFunction,
  simulationTick = 0,
}: WasmMemoryProfilerProps) {
  const [activeTab, setActiveTab] = useState<"sections" | "functions" | "heatmap">("sections");
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Canvas double-buffering refs to prevent memory leaks across render ticks
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedImageDataRef = useRef<ImageData | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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

  // Ceiling calculation
  const totalMemoryUsage = profile ? (profile.totalBytes || 0) : 0;
  const memoryUsageRatio = totalMemoryUsage / SOROBAN_MEMORY_LIMIT_BYTES;
  const isApproachingCeiling = memoryUsageRatio >= SOROBAN_MEMORY_WARNING_THRESHOLD;
  const isExceedingCeiling = totalMemoryUsage > SOROBAN_MEMORY_LIMIT_BYTES;

  // Double-buffering canvas draw logic with recycled ImageData buffer
  useEffect(() => {
    if (activeTab !== "heatmap" || !profile) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Allocate ImageData ONCE and reuse across all renders/ticks to prevent memory leaks
    if (
      !cachedImageDataRef.current ||
      cachedImageDataRef.current.width !== width ||
      cachedImageDataRef.current.height !== height
    ) {
      cachedImageDataRef.current = ctx.createImageData(width, height);
    }

    const imgData = cachedImageDataRef.current;
    const data = imgData.data;

    // Proportions
    const staticRatio = Math.min(1, (profile.staticDataBytes || 0) / SOROBAN_MEMORY_LIMIT_BYTES);
    const stackRatio = Math.min(1, (profile.stackEstimateBytes || 0) / SOROBAN_MEMORY_LIMIT_BYTES);
    const heapRatio = Math.min(
      1,
      ((profile.heapMaxBytes || profile.heapMinBytes || 0) - (profile.staticDataBytes || 0)) /
        SOROBAN_MEMORY_LIMIT_BYTES,
    );

    const totalPixels = width * height;
    const staticCutoff = Math.floor(totalPixels * staticRatio);
    const stackCutoff = staticCutoff + Math.floor(totalPixels * stackRatio);
    const heapCutoff = stackCutoff + Math.floor(totalPixels * Math.max(0, heapRatio));

    // Render memory cells without allocating new arrays
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const noise = ((i * 17 + simulationTick * 13) % 25) - 12;

      if (i < staticCutoff) {
        // Static Data: Rose/Red
        data[idx] = Math.min(255, Math.max(0, 244 + noise)); // R
        data[idx + 1] = Math.min(255, Math.max(0, 63 + noise)); // G
        data[idx + 2] = Math.min(255, Math.max(0, 94 + noise)); // B
        data[idx + 3] = 230; // Alpha
      } else if (i < stackCutoff) {
        // Stack: Blue/Cyan
        data[idx] = Math.min(255, Math.max(0, 14 + noise)); // R
        data[idx + 1] = Math.min(255, Math.max(0, 165 + noise)); // G
        data[idx + 2] = Math.min(255, Math.max(0, 233 + noise)); // B
        data[idx + 3] = 230;
      } else if (i < heapCutoff) {
        // Dynamic Heap: Emerald Green
        data[idx] = Math.min(255, Math.max(0, 16 + noise)); // R
        data[idx + 1] = Math.min(255, Math.max(0, 185 + noise)); // G
        data[idx + 2] = Math.min(255, Math.max(0, 129 + noise)); // B
        data[idx + 3] = 230;
      } else {
        // Unallocated Memory: Dark slate
        data[idx] = 15;
        data[idx + 1] = 23;
        data[idx + 2] = 42;
        data[idx + 3] = 200;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [activeTab, profile, simulationTick]);

  if (!profile) {
    return (
      <div className="p-4 rounded-xl border border-white/10 bg-slate-900/60 text-slate-400 text-xs italic">
        No WASM memory profile available. Compile or upload a WASM file to inspect heap, stack, and
        section distributions.
      </div>
    );
  }

  return (
    <div
      className="space-y-4 p-5 rounded-2xl border border-white/10 bg-slate-900/90 text-slate-200 shadow-2xl backdrop-blur-xl"
      data-testid="wasm-memory-profiler"
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Activity size={18} className="animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              WASM Memory Profiler &amp; Allocation Heatmap
            </h3>
            <p className="text-[11px] text-slate-400">
              Double-buffered memory page inspector with zero canvas leaks
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 bg-slate-950 p-1 rounded-xl border border-white/5 text-xs">
          <button
            onClick={() => setActiveTab("sections")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "sections"
                ? "bg-cyan-500/20 text-cyan-300 font-bold shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Sections
          </button>
          <button
            onClick={() => setActiveTab("functions")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "functions"
                ? "bg-cyan-500/20 text-cyan-300 font-bold shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Heavy Functions
          </button>
          <button
            onClick={() => setActiveTab("heatmap")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === "heatmap"
                ? "bg-cyan-500/20 text-cyan-300 font-bold shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="tab-heatmap"
          >
            Heatmap
          </button>
        </div>
      </div>

      {/* Soroban 256KB Memory Ceiling Alert Banner */}
      {isApproachingCeiling && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-3.5 text-xs transition-all ${
            isExceedingCeiling
              ? "border-rose-900/80 bg-rose-950/40 text-rose-300"
              : "border-amber-900/80 bg-amber-950/40 text-amber-300"
          }`}
          data-testid="soroban-memory-alert"
        >
          <AlertTriangle
            size={18}
            className={`shrink-0 mt-0.5 ${isExceedingCeiling ? "text-rose-400" : "text-amber-400"}`}
          />
          <div className="space-y-1">
            <p className="font-bold">
              {isExceedingCeiling
                ? "Critical: Contract Exceeds Soroban 256KB Linear Memory Ceiling!"
                : "Warning: Approaching Soroban 256KB Memory Ceiling (80%+ Consumed)"}
            </p>
            <p className="text-[11px] opacity-90 leading-relaxed">
              Soroban smart contracts are capped at 256KB (4 pages) of linear memory during execution.
              Current allocation: <strong>{formatBytes(totalMemoryUsage)}</strong> (
              {(memoryUsageRatio * 100).toFixed(1)}% of ceiling). Exceeding this limit will cause
              on-chain transaction aborts and lost fee deposits.
            </p>
          </div>
        </div>
      )}

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <HardDrive size={13} className="text-cyan-400" /> Total Footprint
          </div>
          <p className="mt-1.5 font-mono font-bold text-white text-base">
            {formatBytes(profile.totalBytes)}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {((totalMemoryUsage / SOROBAN_MEMORY_LIMIT_BYTES) * 100).toFixed(1)}% of Soroban cap
          </p>
        </div>

        <div className="p-3 rounded-xl border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Database size={13} className="text-rose-400" /> Static Data
          </div>
          <p className="mt-1.5 font-mono font-bold text-rose-300 text-base">
            {formatBytes(profile.staticDataBytes)}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Static constant pools</p>
        </div>

        <div className="p-3 rounded-xl border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <MemoryStick size={13} className="text-emerald-400" /> Heap Min/Max
          </div>
          <p className="mt-1.5 font-mono font-bold text-emerald-300 text-base">
            {formatBytes(profile.heapMinBytes)} / {formatBytes(profile.heapMaxBytes)}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Dynamic heap growth</p>
        </div>

        <div className="p-3 rounded-xl border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Layers size={13} className="text-amber-400" /> Stack Estimate
          </div>
          <p className="mt-1.5 font-mono font-bold text-amber-300 text-base">
            {formatBytes(profile.stackEstimateBytes)}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Call stack frames</p>
        </div>
      </div>

      {/* WASM Bytecode Distribution Bar */}
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
              className={`h-full transition-all hover:brightness-125 cursor-pointer ${
                sectionColors[sec.id] || "bg-slate-600"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Tab Content: Sections */}
      {activeTab === "sections" && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {profile.sections.map((sec) => (
            <div
              key={sec.id}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-white/5 text-xs font-mono"
            >
              <div className="flex items-center gap-2 truncate">
                <span className={`w-2.5 h-2.5 rounded-full ${sectionColors[sec.id] || "bg-slate-600"}`} />
                <span className="text-slate-200 truncate">{sec.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-slate-400">
                <span>{sec.percentage}%</span>
                <span className="font-bold text-cyan-300">{formatBytes(sec.sizeBytes)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab Content: Heavy Functions */}
      {activeTab === "functions" && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {profile.heavyFunctions.map((fn) => (
            <div
              key={fn.name}
              onClick={() => onSelectFunction?.(fn.name, fn.lineHint)}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-white/5 text-xs font-mono hover:bg-slate-800/60 cursor-pointer transition-all"
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

      {/* Tab Content: Heatmap Canvas with Double-Buffering */}
      {activeTab === "heatmap" && (
        <div className="space-y-4 p-4 rounded-xl bg-slate-950/80 border border-white/5 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-300 font-semibold">
              <BarChart3 size={15} />
              <span>Dynamic Linear Memory Allocation Canvas (Double-Buffered)</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-rose-500" /> Static Data
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-sky-500" /> Stack
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-emerald-500" /> Dynamic Heap
              </span>
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-2.5 h-2.5 rounded bg-slate-800" /> Unallocated
              </span>
            </div>
          </div>

          {/* Canvas Rendering */}
          <div className="rounded-xl border border-white/10 overflow-hidden bg-slate-950 flex items-center justify-center p-2">
            <canvas
              ref={canvasRef}
              width={480}
              height={96}
              className="w-full h-24 rounded image-rendering-pixelated"
              data-testid="memory-heatmap-canvas"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} className="text-emerald-400" />
              Recycled Pixel Buffer: Zero memory leaks across simulation frames
            </span>
            <span className="font-mono">
              Cap: 256.00 KB ({formatBytes(totalMemoryUsage)} used)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
