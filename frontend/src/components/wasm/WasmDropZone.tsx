"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Binary, FileCode2, UploadCloud } from "lucide-react";

const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface WasmDropZoneProps {
  onFile: (file: File) => void;
  isAnalyzing?: boolean;
  error?: string | null;
  compact?: boolean;
}

async function hasWasmMagic(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return (
      head.length === 4 &&
      head[0] === 0x00 &&
      head[1] === 0x61 &&
      head[2] === 0x73 &&
      head[3] === 0x6d
    );
  } catch {
    return false;
  }
}

/**
 * Drag-and-drop surface for `.wasm` binaries.
 *
 * Dropping anywhere on the page works (window-level listeners) and the file is
 * validated before it is handed back through `onFile`.
 */
export default function WasmDropZone({ onFile, isAnalyzing = false, error, compact = false }: WasmDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const depthRef = useRef(0);

  const accept = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setLocalError(null);

      const looksLikeWasm =
        file.name.toLowerCase().endsWith(".wasm") || file.type === "application/wasm";

      if (!looksLikeWasm && !(await hasWasmMagic(file))) {
        setLocalError(`"${file.name}" is not a WebAssembly binary. Drop a .wasm file instead.`);
        return;
      }

      if (file.size === 0) {
        setLocalError(`"${file.name}" is empty.`);
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        setLocalError(
          `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the inspector limit is 32 MB.`,
        );
        return;
      }

      onFile(file);
    },
    [onFile],
  );

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depthRef.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsDragging(false);
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depthRef.current = 0;
      setIsDragging(false);
      const file = event.dataTransfer?.files?.[0];
      void accept(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [accept]);

  const message = localError ?? error ?? null;

  const body = (
    <div
      onDragOver={(event) => event.preventDefault()}
      className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-all ${
        compact ? "px-4 py-6" : "px-6 py-10 sm:py-14"
      } ${
        isDragging
          ? "border-teal-400 bg-teal-500/10 shadow-[0_0_40px_rgba(45,212,191,0.15)]"
          : "border-slate-700 bg-slate-950/50 hover:border-slate-600"
      }`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl border transition-colors ${
          isDragging
            ? "border-teal-400/50 bg-teal-400/15 text-teal-300"
            : "border-slate-700 bg-slate-900 text-slate-400"
        }`}
      >
        {isDragging ? <FileCode2 size={26} /> : <UploadCloud size={26} />}
      </span>

      <div>
        <p className="text-sm font-semibold text-white sm:text-base">
          {isDragging ? "Release to inspect the binary" : "Drag & drop a .wasm binary"}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Drop anywhere on this page to decompile exported functions, types, memory usage and
          Soroban metadata — everything is parsed in your browser.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isAnalyzing}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-400 to-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:from-teal-300 hover:to-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Binary size={14} />
          {isAnalyzing ? "Analyzing…" : "Browse files"}
        </button>
        <span className="rounded-full border border-slate-700 px-3 py-2 text-[11px] font-medium text-slate-400">
          .wasm · max 32 MB
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".wasm,application/wasm"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void accept(file);
        }}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {body}

      {message && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs leading-5 text-rose-200"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center rounded-3xl border-4 border-teal-400/60 bg-slate-950/40">
          <span className="rounded-full bg-teal-400 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-950">
            Drop to inspect
          </span>
        </div>
      )}
    </div>
  );
}
