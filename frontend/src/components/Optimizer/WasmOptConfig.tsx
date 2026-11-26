"use client";

/**
 * WasmOptConfig — FE-23
 *
 * Interactive WASM binary optimisation panel.
 *
 * Features
 * ────────
 * • Drag/drop or prop-fed WASM binary input
 * • Toggle switches for each optimisation pass (wasm-opt parity)
 * • Real-time section treemap visualiser showing binary composition
 * • Pre/post size delta cards with percentage reduction badge
 * • Soroban spec metadata integrity status
 * • Download optimised binary or forward to deployment modal
 * • Runs the optimiser in a dedicated Web Worker — zero UI jank
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  Database,
  FileCode2,
  Loader2,
  Rocket,
  Settings2,
  Sliders,
  Sparkles,
  SquareCode,
  Trash2,
  XCircle,
} from "lucide-react";
import { parseSorobanMetadata } from "@/utils/sorobanMetadata";
import { profileWasm } from "@/workers/wasmOptCore";
import type {
  BytecodeProfile,
  WasmOptPasses,
  WasmOptPassResult,
  WasmOptRequest,
  WasmOptResponse,
  WasmSectionProfile,
} from "@/workers/wasmOpt.worker";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WasmOptConfigProps {
  /**
   * Pre-loaded WASM binary bytes.  When provided the drop zone is hidden and
   * the component immediately analyses the input.
   */
  initialBytes?: Uint8Array | null;
  /**
   * Called after a successful optimisation with the result binary so a parent
   * (e.g. the deploy wizard) can consume it.
   */
  onOptimized?: (bytes: Uint8Array, filename: string) => void;
  /** File name hint used for the download anchor and forwarding. */
  filename?: string;
}

type OptPhase = "idle" | "analysing" | "ready" | "running" | "done" | "error";

interface SectionEntry {
  id: number;
  name: string;
  sizeBytes: number;
  pct: number;
}

interface AnalysisResult {
  sizeBytes: number;
  sections: SectionEntry[];
  isSoroban: boolean;
  sorobanSections: string[];
  specIdentifiers: string[];
}

interface OptProgress {
  percent: number;
  stage: string;
}

interface OptResult {
  originalBytes: number;
  optimizedBytes: number;
  reductionBytes: number;
  reductionPct: number;
  passResults: WasmOptPassResult[];
  output: Uint8Array;
  sorobanSections: string[];
  specIdentifiers: string[];
  profile: BytecodeProfile;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const SECTION_NAME: Record<number, string> = {
  0: "Custom / Spec",
  1: "Type Defs",
  2: "Imports",
  3: "Functions",
  4: "Tables",
  5: "Memory",
  6: "Globals",
  7: "Exports",
  8: "Start",
  9: "Elements",
  10: "Code",
  11: "Data",
  12: "Data Count",
};

const SECTION_COLOR: Record<number, string> = {
  0: "bg-purple-500",
  1: "bg-blue-400",
  2: "bg-indigo-400",
  3: "bg-cyan-400",
  5: "bg-emerald-400",
  6: "bg-amber-400",
  7: "bg-pink-400",
  10: "bg-cyan-500",
  11: "bg-rose-400",
};

const SECTION_TEXT_COLOR: Record<number, string> = {
  0: "text-purple-300",
  1: "text-blue-300",
  2: "text-indigo-300",
  3: "text-cyan-300",
  5: "text-emerald-300",
  6: "text-amber-300",
  7: "text-pink-300",
  10: "text-cyan-200",
  11: "text-rose-300",
};

const PROFILE_CATEGORIES: Array<{
  key: keyof WasmSectionProfile["categories"];
  label: string;
  color: string;
}> = [
  { key: "code", label: "Code", color: "bg-cyan-500" },
  { key: "data", label: "Data", color: "bg-rose-400" },
  { key: "types", label: "Types", color: "bg-blue-400" },
  { key: "custom", label: "Custom / Spec", color: "bg-purple-500" },
  { key: "other", label: "Other", color: "bg-slate-500" },
];

const DEFAULT_PASSES: WasmOptPasses = {
  stripDebugNames: true,
  stripProducers: true,
  stripUnknownCustom: true,
  mergeDataSegments: false,
  inlining: false,
  deadCodeElimination: false,
  constMerging: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function hasWasmMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === WASM_MAGIC[0] &&
    bytes[1] === WASM_MAGIC[1] &&
    bytes[2] === WASM_MAGIC[2] &&
    bytes[3] === WASM_MAGIC[3]
  );
}

function readLeb128(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const b = bytes[cursor++];
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

function analyseBinary(bytes: Uint8Array): AnalysisResult {
  const meta = parseSorobanMetadata(bytes);
  const total = bytes.byteLength;
  const sectionSizes: Record<number, number> = {};

  if (bytes.length >= 8) {
    let offset = 8;
    while (offset < bytes.length) {
      const id = bytes[offset];
      const sz = readLeb128(bytes, offset + 1);
      if (!sz) break;
      sectionSizes[id] = (sectionSizes[id] ?? 0) + sz.value;
      offset = sz.next + sz.value;
    }
  }

  const sections: SectionEntry[] = Object.entries(sectionSizes)
    .map(([idStr, sizeBytes]) => {
      const id = Number(idStr);
      return {
        id,
        name: SECTION_NAME[id] ?? `Section ${id}`,
        sizeBytes,
        pct: total > 0 ? Number(((sizeBytes / total) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    sizeBytes: total,
    sections,
    isSoroban: meta.isSoroban,
    sorobanSections: meta.sorobanSectionNames,
    specIdentifiers: meta.specIdentifiers,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ToggleProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  simulated?: boolean;
  onChange: (v: boolean) => void;
}

function PassToggle({
  id,
  label,
  description,
  checked,
  simulated = false,
  onChange,
}: ToggleProps) {
  return (
    <label
      htmlFor={id}
      className="flex items-start justify-between gap-3 p-3 rounded-lg border border-white/5 bg-slate-950/50 hover:bg-slate-900/60 cursor-pointer transition-all group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">{label}</span>
          {simulated && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/25">
              offline only
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
          {description}
        </p>
      </div>
      <div className="relative mt-0.5 shrink-0">
        <input
          id={id}
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={`w-9 h-5 rounded-full transition-all duration-200 border
            ${
              checked
                ? simulated
                  ? "bg-amber-500/50 border-amber-500/50"
                  : "bg-cyan-500/70 border-cyan-500/60"
                : "bg-slate-800 border-white/10"
            }
          `}
        />
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
            ${checked ? "translate-x-4" : "translate-x-0"}
          `}
        />
      </div>
    </label>
  );
}

interface TreemapProps {
  sections: SectionEntry[];
  totalBytes: number;
  testId?: string;
}

function SectionTreemap({ sections, totalBytes, testId = "section-treemap" }: TreemapProps) {
  if (sections.length === 0) {
    return (
      <div data-testid={testId} className="text-[10px] text-slate-500">
        No sections to display
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-label="WASM section treemap">
      {/* Stacked bar */}
      <div className="h-4 w-full flex rounded-full overflow-hidden bg-slate-950 border border-white/10">
        {sections.map((sec) => (
          <div
            key={sec.id}
            style={{ width: `${Math.max(sec.pct, 1)}%` }}
            title={`${sec.name}: ${formatBytes(sec.sizeBytes)} (${sec.pct}%)`}
            className={`h-full transition-all hover:brightness-125 ${SECTION_COLOR[sec.id] ?? "bg-slate-600"}`}
            role="presentation"
          />
        ))}
      </div>

      {/* Treemap blocks */}
      <div
        className="w-full h-20 flex flex-wrap gap-0.5 rounded-lg overflow-hidden bg-slate-950/60 border border-white/5 p-1"
          data-testid={testId}

      >
        {sections.map((sec) => {
          const pct = totalBytes > 0 ? (sec.sizeBytes / totalBytes) * 100 : 0;
          const minW = 10;
          const w = Math.max(minW, Math.floor(pct));

          return (
            <div
              key={sec.id}
              title={`${sec.name}: ${formatBytes(sec.sizeBytes)} (${sec.pct}%)`}
              className={`flex items-center justify-center text-[8px] font-bold rounded overflow-hidden transition-all hover:scale-105 cursor-default ${SECTION_COLOR[sec.id] ?? "bg-slate-700"} text-slate-950/80`}
              style={{
                width: `${w}%`,
                minWidth: "24px",
                flexGrow: pct > 20 ? 1 : 0,
                flexShrink: 0,
              }}
            >
              <span className="truncate px-1">{sec.name.split(" ")[0]}</span>
            </div>
          );
        })}
      </div>

      {/* Section legend */}
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        {sections.map((sec) => (
          <div
            key={sec.id}
            className="flex items-center justify-between px-2 py-1 rounded bg-slate-950/40 border border-white/5 font-mono"
          >
            <div className="flex items-center gap-1.5 truncate">
              <span
                className={`w-2 h-2 rounded-sm shrink-0 ${SECTION_COLOR[sec.id] ?? "bg-slate-600"}`}
              />
              <span
                className={`truncate ${SECTION_TEXT_COLOR[sec.id] ?? "text-slate-300"}`}
              >
                {sec.name}
              </span>
            </div>
            <span className="text-slate-400 shrink-0 ml-1">
              {formatBytes(sec.sizeBytes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DeltaCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "cyan" | "emerald" | "amber" | "rose";
}

function DeltaCard({ label, value, sub, accent = "cyan" }: DeltaCardProps) {
  const colors = {
    cyan: "text-cyan-300",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
  };
  return (
    <div className="p-3 rounded-lg border border-white/5 bg-slate-950/60 text-xs">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
        {label}
      </div>
      <div className={`mt-1 font-mono font-bold text-sm ${colors[accent]}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

interface BytecodeProfilePanelProps {
  profile: BytecodeProfile;
}

function BytecodeProfilePanel({ profile }: BytecodeProfilePanelProps) {
  const totalDelta = profile.after.totalBytes - profile.before.totalBytes;
  const totalPct =
    profile.before.totalBytes > 0
      ? ((Math.abs(totalDelta) / profile.before.totalBytes) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-2" data-testid="bytecode-memory-profile">
      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
        <Database size={12} className="text-cyan-400" />
        Bytecode Memory Profile
        <span className="text-slate-500 normal-case tracking-normal font-normal">
          (before / after optimisation)
        </span>
      </div>
      <div className="rounded-lg border border-white/5 bg-slate-950/50 overflow-hidden">
        <div className="grid grid-cols-4 gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
          <span>Section</span>
          <span className="text-right">Before</span>
          <span className="text-right">After</span>
          <span className="text-right">Delta</span>
        </div>
        {PROFILE_CATEGORIES.map((category) => {
          const before = profile.before.categories[category.key];
          const after = profile.after.categories[category.key];
          const delta = after - before;
          return (
            <div
              key={category.key}
              className="grid grid-cols-4 gap-2 px-3 py-1.5 text-[11px] font-mono odd:bg-white/[0.01]"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span
                  className={`w-2 h-2 rounded-sm shrink-0 ${category.color}`}
                />
                <span className="truncate text-slate-300">{category.label}</span>
              </div>
              <span className="text-right text-slate-400">
                {formatBytes(before)}
              </span>
              <span className="text-right text-slate-200">
                {formatBytes(after)}
              </span>
              <span
                className={`text-right ${
                  delta < 0
                    ? "text-emerald-400"
                    : delta > 0
                      ? "text-rose-400"
                      : "text-slate-500"
                }`}
              >
                {delta === 0
                  ? "—"
                  : `${delta > 0 ? "+" : "-"}${formatBytes(Math.abs(delta))}`}
              </span>
            </div>
          );
        })}
        <div className="grid grid-cols-4 gap-2 px-3 py-2 text-[11px] font-mono font-semibold border-t border-white/10">
          <span className="text-slate-300">Total</span>
          <span className="text-right text-slate-400">
            {formatBytes(profile.before.totalBytes)}
          </span>
          <span className="text-right text-emerald-300">
            {formatBytes(profile.after.totalBytes)}
          </span>
          <span className="text-right text-emerald-400">{totalPct}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  onBytes: (bytes: Uint8Array, name: string) => void;
}

function DropZone({ onBytes }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const depthRef = useRef(0);

  const accept = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setError(null);

      if (file.size === 0) {
        setError("File is empty.");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`File too large (max ${formatBytes(MAX_FILE_BYTES)}).`);
        return;
      }

      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);

      if (!hasWasmMagic(bytes)) {
        setError(`"${file.name}" is not a valid WebAssembly binary.`);
        return;
      }

      onBytes(bytes, file.name);
    },
    [onBytes],
  );

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setIsDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setIsDragging(false);
      void accept(e.dataTransfer?.files?.[0]);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [accept]);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed transition-all cursor-pointer
        ${isDragging ? "border-cyan-400 bg-cyan-500/5" : "border-white/15 hover:border-white/30 bg-slate-950/30"}`}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-xl bg-cyan-500/8 pointer-events-none" />
      )}
      <SquareCode size={36} className="text-cyan-400 opacity-70" />
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-200">
          Drop your <code className="text-cyan-400">.wasm</code> binary here
        </p>
        <p className="mt-1 text-xs text-slate-400">
          or click to browse — up to {formatBytes(MAX_FILE_BYTES)}
        </p>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".wasm,application/wasm"
        className="sr-only"
        onChange={(e) => void accept(e.target.files?.[0])}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WasmOptConfig({
  initialBytes,
  onOptimized,
  filename = "contract.wasm",
}: WasmOptConfigProps) {
  const [phase, setPhase] = useState<OptPhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [passes, setPasses] = useState<WasmOptPasses>(DEFAULT_PASSES);
  const [inputBytes, setInputBytes] = useState<Uint8Array | null>(
    initialBytes ?? null,
  );
  const [inputFilename, setInputFilename] = useState(filename);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [optResult, setOptResult] = useState<OptResult | null>(null);
  const [progress, setProgress] = useState<OptProgress | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const inputBytesRef = useRef<Uint8Array | null>(inputBytes ?? null);

  // ── Load initial bytes ─────────────────────────────────────────────────
  useEffect(() => {
    if (initialBytes && initialBytes.length > 0) {
      setInputBytes(initialBytes);
    }
  }, [initialBytes]);

  useEffect(() => {
    inputBytesRef.current = inputBytes;
  }, [inputBytes]);

  // ── Analyse on input change ────────────────────────────────────────────
  useEffect(() => {
    if (!inputBytes) {
      setPhase("idle");
      setAnalysis(null);
      setOptResult(null);
      return;
    }

    setPhase("analysing");
    try {
      const result = analyseBinary(inputBytes);
      setAnalysis(result);
      setPhase("ready");
      setOptResult(null);
    } catch {
      setPhase("error");
      setErrorMsg("Failed to parse the WASM binary.");
    }
  }, [inputBytes]);

  // ── Worker setup ───────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const worker = new Worker(
      new URL("../../workers/wasmOpt.worker.ts", import.meta.url),
      { type: "module", name: "wasm-opt-worker" },
    );

    worker.onmessage = (e: MessageEvent<WasmOptResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        if (msg.id === reqIdRef.current) {
          setProgress({ percent: msg.percent, stage: msg.stage });
        }
        return;
      }
      if (msg.type === "error") {
        setProgress(null);
        setPhase("error");
        setErrorMsg(msg.message);
        return;
      }
      if (msg.type === "success") {
        setOptResult({
          originalBytes: msg.originalBytes,
          optimizedBytes: msg.optimizedBytes,
          reductionBytes: msg.reductionBytes,
          reductionPct: msg.reductionPct,
          passResults: msg.passResults,
          output: msg.optimized,
          sorobanSections: msg.sorobanSections,
          specIdentifiers: msg.specIdentifiers,
          profile:
            msg.profile ??
            {
              before: profileWasm(inputBytesRef.current ?? new Uint8Array()),
              after: profileWasm(msg.optimized),
            },
        });
        setProgress(null);
        setPhase("done");
      }
    };

    worker.onerror = (e) => {
      setProgress(null);
      setPhase("error");
      setErrorMsg(e.message ?? "Worker error");
    };

    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleFile = useCallback((bytes: Uint8Array, name: string) => {
    setInputBytes(bytes);
    setInputFilename(name);
    setOptResult(null);
    setErrorMsg(null);
    setProgress(null);
  }, []);

  const handleOptimise = useCallback(() => {
    if (!inputBytes || !workerRef.current) return;
    setPhase("running");
    setErrorMsg(null);
    setOptResult(null);
    setProgress({ percent: 0, stage: "Queued" });

    const id = ++reqIdRef.current;
    const workerBytes = inputBytes.slice();
    const request: WasmOptRequest = {
      type: "optimize",
      id,
      bytes: workerBytes,
      passes,
    };
    workerRef.current.postMessage(request, [workerBytes.buffer]);
  }, [inputBytes, passes]);

  const handleDownload = useCallback(() => {
    if (!optResult) return;
    const blob = new Blob([new Uint8Array(optResult.output).buffer], {
      type: "application/wasm",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = inputFilename.replace(/\.wasm$/, "");
    a.href = url;
    a.download = `${baseName}.optimized.wasm`;
    a.click();
    URL.revokeObjectURL(url);
  }, [optResult, inputFilename]);

  const handleForwardToDeploy = useCallback(() => {
    if (!optResult || !onOptimized) return;
    const baseName = inputFilename.replace(/\.wasm$/, "");
    onOptimized(optResult.output, `${baseName}.optimized.wasm`);
  }, [optResult, onOptimized, inputFilename]);

  const handleReset = useCallback(() => {
    setInputBytes(null);
    setAnalysis(null);
    setOptResult(null);
    setPhase("idle");
    setErrorMsg(null);
    setProgress(null);
  }, []);

  const togglePass = useCallback(
    (key: keyof WasmOptPasses) => (value: boolean) => {
      setPasses((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // ── Derived values ─────────────────────────────────────────────────────

  const treemapSections = useMemo(() => analysis?.sections ?? [], [analysis]);
  const treemapTotal = analysis?.sizeBytes ?? 0;

  const afterTreemapSections = useMemo(
    () => (optResult ? analyseBinary(optResult.output).sections : []),
    [optResult],
  );

  const appliedPassCount = useMemo(
    () => optResult?.passResults.filter((p) => p.applied).length ?? 0,
    [optResult],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 rounded-xl border border-white/10 bg-slate-900/90 text-slate-200 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Sliders size={16} className="text-cyan-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-white">
            WASM Binary Stripper & Optimizer
          </h2>
        </div>
        {(phase === "ready" || phase === "done") && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
            aria-label="Reset optimizer"
          >
            <Trash2 size={12} />
            Reset
          </button>
        )}
      </div>

      {/* Drop zone — shown when no binary loaded */}
      {phase === "idle" && <DropZone onBytes={handleFile} />}

      {/* Analysing spinner */}
      {phase === "analysing" && (
        <div className="flex items-center justify-center gap-2 py-8 text-cyan-400 text-sm">
          <Loader2 size={18} className="animate-spin" />
          <span>Analysing binary…</span>
        </div>
      )}

      {/* Error state */}
      {phase === "error" && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          <XCircle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Optimisation failed</p>
            <p className="mt-1 text-xs text-rose-400">{errorMsg}</p>
            <button
              onClick={handleReset}
              className="mt-2 text-xs text-rose-300 underline hover:text-white"
            >
              Try another file
            </button>
          </div>
        </div>
      )}

      {/* Main panel — shown when binary is loaded */}
      {(phase === "ready" || phase === "running" || phase === "done") &&
        analysis && (
          <div className="space-y-4">
            {/* File info row */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/60 border border-white/5 text-xs">
              <div className="flex items-center gap-2 truncate">
                <FileCode2 size={14} className="text-cyan-400 shrink-0" />
                <span className="font-mono text-slate-300 truncate">
                  {inputFilename}
                </span>
                {analysis.isSoroban && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                    Soroban
                  </span>
                )}
              </div>
              <span className="font-mono text-slate-400 shrink-0 ml-2">
                {formatBytes(
                  optResult ? optResult.originalBytes : analysis.sizeBytes,
                )}
              </span>
            </div>

            {/* Soroban spec metadata */}
            {analysis.isSoroban && (
              <div className="flex flex-wrap gap-1.5 items-center text-[11px]">
                <span className="text-slate-400 font-semibold">
                  Spec sections:
                </span>
                {analysis.sorobanSections.map((s) => (
                  <span
                    key={s}
                    className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25 font-mono"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}

            {/* Section treemaps — before / after */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                <SquareCode size={12} className="text-cyan-400" />
                Binary Composition
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Before optimisation
                  </div>
                  <SectionTreemap
                    sections={treemapSections}
                    totalBytes={treemapTotal}
                  />
                </div>
                {optResult && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      After optimisation
                    </div>
                    <SectionTreemap
                      sections={afterTreemapSections}
                      totalBytes={optResult.optimizedBytes}
                      testId="section-treemap-after"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Pass configuration */}
            {phase !== "done" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                  <Settings2 size={12} className="text-cyan-400" />
                  Optimisation Passes
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <PassToggle
                    id="pass-strip-debug"
                    label="Strip Debug Names"
                    description="Remove the 'name' custom section — debug symbol annotations with zero runtime effect."
                    checked={passes.stripDebugNames}
                    onChange={togglePass("stripDebugNames")}
                  />
                  <PassToggle
                    id="pass-strip-producers"
                    label="Strip Producers"
                    description="Remove the 'producers' custom section — build-tool version metadata (Rust/LLVM)."
                    checked={passes.stripProducers}
                    onChange={togglePass("stripProducers")}
                  />
                  <PassToggle
                    id="pass-strip-unknown"
                    label="Strip Unknown Custom Sections"
                    description="Remove non-Soroban custom sections (DWARF debug data, relocation tables)."
                    checked={passes.stripUnknownCustom}
                    onChange={togglePass("stripUnknownCustom")}
                  />
                  <PassToggle
                    id="pass-merge-data"
                    label="Merge Data Segments"
                    description="Coalesce adjacent static data segments to reduce Data section overhead."
                    checked={passes.mergeDataSegments}
                    onChange={togglePass("mergeDataSegments")}
                  />
                  <PassToggle
                    id="pass-inlining"
                    label="Inlining"
                    description="Inline hot small functions to eliminate call overhead."
                    checked={passes.inlining}
                    simulated
                    onChange={togglePass("inlining")}
                  />
                  <PassToggle
                    id="pass-dce"
                    label="Dead-Code Elimination"
                    description="Remove unreachable functions and data segments."
                    checked={passes.deadCodeElimination}
                    simulated
                    onChange={togglePass("deadCodeElimination")}
                  />
                  <PassToggle
                    id="pass-const-merge"
                    label="Const Merging"
                    description="De-duplicate identical constant values across the binary."
                    checked={passes.constMerging}
                    simulated
                    onChange={togglePass("constMerging")}
                  />
                </div>
              </div>
            )}

            {/* Optimise button */}
            {phase === "ready" && (
              <button
                onClick={handleOptimise}
                disabled={!inputBytes || inputBytes.length === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={16} />
                Run Optimisation
              </button>
            )}

            {/* Running state — streamed worker progress */}
            {phase === "running" && (
              <div className="space-y-2 py-2" data-testid="optimizer-progress">
                <div className="flex items-center justify-between gap-2 text-cyan-400 text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    Running optimisation passes…
                  </span>
                  <span className="font-mono font-bold tabular-nums text-xs">
                    {progress?.percent ?? 0}%
                  </span>
                </div>
                <div
                  className="h-2 w-full rounded-full overflow-hidden bg-slate-950 border border-white/10"
                  role="progressbar"
                  aria-label="Optimisation progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress?.percent ?? 0}
                >
                  <div
                    className="h-full bg-cyan-500 transition-all duration-200"
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  {progress?.stage ?? "Queued"}
                </p>
              </div>
            )}

            {/* Results */}
            {phase === "done" && optResult && (
              <div className="space-y-4">
                {/* Delta cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <DeltaCard
                    label="Original"
                    value={formatBytes(optResult.originalBytes)}
                    accent="cyan"
                  />
                  <DeltaCard
                    label="Optimised"
                    value={formatBytes(optResult.optimizedBytes)}
                    accent="emerald"
                  />
                  <DeltaCard
                    label="Saved"
                    value={formatBytes(optResult.reductionBytes)}
                    sub={`${optResult.reductionPct}% reduction`}
                    accent={optResult.reductionPct >= 15 ? "emerald" : "amber"}
                  />
                  <DeltaCard
                    label="Passes Applied"
                    value={`${appliedPassCount} / ${optResult.passResults.length}`}
                    accent="cyan"
                  />
                </div>

                <BytecodeProfilePanel profile={optResult.profile} />

                {/* Pass results breakdown */}
                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Pass Results
                  </div>
                  {optResult.passResults.map((pr) => (
                    <div
                      key={pr.pass}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/50 border border-white/5 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        {pr.applied ? (
                          <CheckCircle2
                            size={13}
                            className="text-emerald-400 shrink-0"
                          />
                        ) : (
                          <ChevronRight
                            size={13}
                            className="text-slate-500 shrink-0"
                          />
                        )}
                        <span
                          className={
                            pr.applied ? "text-slate-200" : "text-slate-400"
                          }
                        >
                          {pr.pass}
                        </span>
                        {pr.note && (
                          <span className="text-slate-500 truncate hidden sm:block">
                            — {pr.note}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-emerald-400 shrink-0 ml-2">
                        {pr.bytesSaved > 0
                          ? `-${formatBytes(pr.bytesSaved)}`
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Soroban spec integrity badge */}
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium
                  ${
                    optResult.sorobanSections.length > 0
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      : "bg-slate-950/40 border-white/5 text-slate-400"
                  }
                `}
                  data-testid="spec-integrity-badge"
                >
                  {optResult.sorobanSections.length > 0 ? (
                    <CheckCircle2
                      size={13}
                      className="text-emerald-400 shrink-0"
                    />
                  ) : (
                    <AlertTriangle
                      size={13}
                      className="text-amber-400 shrink-0"
                    />
                  )}
                  <span>
                    {optResult.sorobanSections.length > 0
                      ? `Soroban contract spec preserved — ${optResult.sorobanSections.length} required section${optResult.sorobanSections.length > 1 ? "s" : ""} intact`
                      : "No Soroban spec sections detected (non-Soroban binary)"}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 py-2 px-4 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold text-xs transition-all"
                  >
                    <ArrowDownToLine size={14} />
                    Download Optimised Binary
                  </button>
                  {onOptimized && (
                    <button
                      onClick={handleForwardToDeploy}
                      className="flex items-center gap-2 py-2 px-4 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-semibold text-xs transition-all"
                      data-testid="forward-to-deploy"
                    >
                      <Rocket size={14} />
                      Forward to Deploy
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-2 py-2 px-4 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 font-semibold text-xs transition-all"
                  >
                    <SquareCode size={14} />
                    Optimise Another
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
