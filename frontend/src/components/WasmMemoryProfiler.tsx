"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Database,
  HardDrive,
  Layers,
  MemoryStick,
  Zap,
} from "lucide-react";
import {
  SOROBAN_MEMORY_CEILING_BYTES,
  buildMemorySegments,
  estimateLinearMemoryBytes,
  formatMemoryBytes,
  getMemoryPressure,
  type MemorySegment,
} from "@/utils/wasmMemoryHeatmap";
import type { WasmMemoryProfile } from "@/utils/wasmInspector";

interface WasmMemoryProfilerProps {
  profile: WasmMemoryProfile | null;
  onSelectFunction?: (funcName: string, lineHint?: number) => void;
}

interface HeatmapBuffers {
  front: ImageData;
  back: ImageData;
  width: number;
  height: number;
}

const HEATMAP_WIDTH = 256;
const HEATMAP_HEIGHT = 48;

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Writes directly into an existing ImageData buffer. No ImageData, typed
 * array, or colour string is allocated per frame, which is what keeps long
 * simulation runs from leaking memory into the browser tab.
 */
function paintHeatmap(
  image: ImageData,
  segments: readonly MemorySegment[],
  tick: number,
): void {
  const { data, width, height } = image;
  const totalBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0) || 1;
  const phase = tick % 24;

  let cumulative = 0;
  let segmentIndex = 0;
  let segment = segments[0];

  for (let x = 0; x < width; x += 1) {
    const ratio = x / width;
    while (
      segmentIndex < segments.length - 1 &&
      ratio >= cumulative + segment.bytes / totalBytes
    ) {
      cumulative += segment.bytes / totalBytes;
      segmentIndex += 1;
      segment = segments[segmentIndex];
    }

    const shimmer = ((x + phase) % 24) / 24;
    const red = clampByte(segment.color[0] + shimmer * 14 - 7);
    const green = clampByte(segment.color[1] + shimmer * 14 - 7);
    const blue = clampByte(segment.color[2] + shimmer * 14 - 7);
    const isEdge = x === 0 || x === width - 1;

    for (let y = 0; y < height; y += 1) {
      const isBorder = isEdge || y === 0 || y === height - 1;
      const offset = (y * width + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = isBorder ? 255 : 210;
    }
  }
}

function MemoryHeatmapCanvas({
  segments,
}: {
  segments: readonly MemorySegment[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const buffersRef = useRef<HeatmapBuffers | null>(null);
  const frameRef = useRef<number | null>(null);
  const tickRef = useRef(0);
  const [canvasActive, setCanvasActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== "function") return;

    const context = canvas.getContext("2d");
    if (
      !context ||
      typeof context.createImageData !== "function" ||
      typeof context.putImageData !== "function"
    ) {
      return;
    }

    // Allocate the two pixel buffers exactly once for this canvas size.
    canvas.width = HEATMAP_WIDTH;
    canvas.height = HEATMAP_HEIGHT;
    buffersRef.current = {
      front: context.createImageData(HEATMAP_WIDTH, HEATMAP_HEIGHT),
      back: context.createImageData(HEATMAP_WIDTH, HEATMAP_HEIGHT),
      width: HEATMAP_WIDTH,
      height: HEATMAP_HEIGHT,
    };
    setCanvasActive(true);

    const drawFrame = () => {
      const buffers = buffersRef.current;
      if (!buffers) return;

      // Paint the back buffer, present it, then swap. The next frame reuses
      // the buffer that was just displayed instead of allocating a new one.
      paintHeatmap(buffers.back, segments, tickRef.current);
      context.putImageData(buffers.back, 0, 0);
      const displayed = buffers.front;
      buffers.front = buffers.back;
      buffers.back = displayed;
      tickRef.current += 1;

      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        frameRef.current = window.requestAnimationFrame(drawFrame);
      }
    };

    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      frameRef.current = window.requestAnimationFrame(drawFrame);
    } else {
      // No scheduler (SSR or a minimal DOM): draw one static frame only.
      drawFrame();
    }

    return () => {
      if (
        frameRef.current !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      // Drop references so the ImageData buffers can be collected immediately.
      buffersRef.current = null;
    };
  }, [segments]);

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="wasm-memory-heatmap-canvas"
        aria-label="Soroban linear memory allocation heatmap"
        className="h-12 w-full rounded border border-white/10"
      />
      {!canvasActive && (
        <div
          data-testid="wasm-memory-heatmap-fallback"
          className="flex h-3 w-full overflow-hidden rounded-full border border-white/10 bg-slate-950"
        >
          {segments.map((segment) => (
            <div
              key={segment.key}
              title={`${segment.label}: ${formatMemoryBytes(segment.bytes)}`}
              style={{ width: `${segment.percentage}%` }}
              className="h-full"
              data-segment={segment.key}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function WasmMemoryProfiler({
  profile,
  onSelectFunction,
}: WasmMemoryProfilerProps) {
  const [activeTab, setActiveTab] = useState<
    "sections" | "functions" | "heatmap"
  >("sections");

  const segments = useMemo(
    () => (profile ? buildMemorySegments(profile) : []),
    [profile],
  );
  const estimatedBytes = useMemo(
    () => (profile ? estimateLinearMemoryBytes(profile) : 0),
    [profile],
  );
  const pressure = getMemoryPressure(estimatedBytes);

  if (!profile) {
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

  const usagePercentage = Math.min(
    100,
    (estimatedBytes / SOROBAN_MEMORY_CEILING_BYTES) * 100,
  );

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
            {formatMemoryBytes(profile.totalBytes)}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Database size={12} className="text-rose-400" /> Static Data
          </div>
          <p className="mt-1 font-mono font-bold text-rose-300 text-sm">
            {formatMemoryBytes(profile.staticDataBytes)}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <MemoryStick size={12} className="text-emerald-400" /> Heap Min/Max
          </div>
          <p className="mt-1 font-mono font-bold text-emerald-300 text-xs truncate">
            {formatMemoryBytes(profile.heapMinBytes)} /{" "}
            {profile.heapMaxBytes ? formatMemoryBytes(profile.heapMaxBytes) : "∞"}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-white/5 bg-slate-950/60">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold uppercase">
            <Layers size={12} className="text-amber-400" /> Stack Footprint
          </div>
          <p className="mt-1 font-mono font-bold text-amber-300 text-sm">
            {formatMemoryBytes(profile.stackEstimateBytes)}
          </p>
        </div>
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
              title={`${sec.name}: ${formatMemoryBytes(sec.sizeBytes)} (${sec.percentage}%)`}
              className={`h-full transition-all hover:brightness-125 cursor-pointer ${sectionColors[sec.id] || "bg-slate-600"}`}
            />
          ))}
        </div>
      </div>

      {/* Soroban linear memory ceiling status */}
      <div className="space-y-1.5" data-testid="memory-ceiling-status">
        <div className="flex justify-between text-[11px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-[10px]">
            Soroban Linear Memory
          </span>
          <span className="font-mono">
            {formatMemoryBytes(estimatedBytes)} / 256.00 KB (
            {usagePercentage.toFixed(1)}%)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-950 border border-white/10">
          <div
            role="progressbar"
            aria-label="Soroban linear memory usage"
            aria-valuemin={0}
            aria-valuemax={SOROBAN_MEMORY_CEILING_BYTES}
            aria-valuenow={Math.round(Math.min(estimatedBytes, SOROBAN_MEMORY_CEILING_BYTES))}
            style={{ width: `${usagePercentage}%` }}
            className={`h-full transition-all ${
              pressure === "critical"
                ? "bg-rose-500"
                : pressure === "warning"
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
          />
        </div>
        {pressure === "warning" && (
          <p
            role="alert"
            className="text-[11px] font-semibold text-amber-300"
          >
            Approaching Soroban&apos;s 256 KB memory ceiling. Reduce heap growth
            before the simulation runs out of linear memory.
          </p>
        )}
        {pressure === "critical" && (
          <p role="alert" className="text-[11px] font-bold text-rose-300">
            Soroban 256 KB memory ceiling breached. Contracts above this limit
            will abort and lose the submitted fee.
          </p>
        )}
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
                  {formatMemoryBytes(sec.sizeBytes)}
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
                {formatMemoryBytes(fn.estimatedSize)}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "heatmap" && (
        <div className="space-y-3 p-3 rounded-lg bg-slate-950/80 border border-white/5 text-xs">
          <div className="flex items-center justify-between gap-2 text-cyan-300 font-semibold">
            <span className="flex items-center gap-2">
              <BarChart3 size={14} /> Allocation Density Heatmap
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              256 KB linear memory
            </span>
          </div>

          <MemoryHeatmapCanvas segments={segments} />

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {segments.map((segment) => (
              <div
                key={segment.key}
                className="flex items-center justify-between rounded bg-slate-900/70 px-2 py-1 font-mono text-[10px]"
              >
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{
                      backgroundColor: `rgb(${segment.color.join(",")})`,
                    }}
                  />
                  {segment.label}
                </span>
                <span className="text-slate-400">{segment.percentage}%</span>
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
                    title={`${item.name}: ${formatMemoryBytes(item.estimatedSize)}`}
                    className={`h-8 rounded flex items-center justify-center font-mono text-[9px] font-bold transition-transform hover:scale-105 cursor-pointer ${colorClass}`}
                  >
                    {formatMemoryBytes(item.estimatedSize).split(" ")[0]}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
