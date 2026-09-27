"use client";

import React, { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import {
  Binary,
  Braces,
  CheckCircle2,
  Database,
  FileCode2,
  Layers,
  Search,
  XCircle,
} from "lucide-react";
import type { WasmArtifactAnalysis } from "@/utils/wasmInspector";
import {
  formatBytes,
  parseSorobanMetadata,
  type SorobanMetadataReport,
} from "@/utils/sorobanMetadata";
import WasmDropZone from "@/components/wasm/WasmDropZone";

const WasmArtifactPanel = dynamic(() => import("@/components/WasmArtifactPanel"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400">
      Loading inspector modules…
    </div>
  ),
});

interface ArtifactMeta {
  name: string;
  size: number;
  lastModified: number;
}

export default function WasmInspectorPage() {
  const [analysis, setAnalysis] = useState<WasmArtifactAnalysis | null>(null);
  const [metadata, setMetadata] = useState<SorobanMetadataReport | null>(null);
  const [meta, setMeta] = useState<ArtifactMeta | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setIsAnalyzing(true);
    setParseError(null);
    setAnalysis(null);
    setMetadata(null);

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      setMetadata(parseSorobanMetadata(buffer));

      const { parseWasmArtifact } = await import("@/utils/wasmInspector");
      const result = await parseWasmArtifact(buffer);

      setAnalysis(result);
      setMeta({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified || Date.now(),
      });
    } catch (cause) {
      setAnalysis(null);
      setMeta({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified || Date.now(),
      });
      setParseError(
        cause instanceof Error
          ? `Could not decompile "${file.name}": ${cause.message}`
          : `Could not decompile "${file.name}".`,
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">
            <FileCode2 size={14} />
            WASM Decompiler &amp; Inspector
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Drop a compiled contract binary to inspect it
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            The inspector reads exported functions, type/export kinds, linear memory usage and the
            Soroban custom sections embedded by the SDK — entirely client side, nothing is uploaded.
          </p>
        </div>

        {meta && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
            <p className="flex items-center gap-2 font-medium text-white">
              <Binary size={13} className="text-teal-300" />
              <span className="max-w-[14rem] truncate">{meta.name}</span>
            </p>
            <p className="mt-1 text-slate-500">
              {formatBytes(meta.size)} · modified {new Date(meta.lastModified).toLocaleString()}
            </p>
          </div>
        )}
      </header>

      <WasmDropZone onFile={(file) => void handleFile(file)} isAnalyzing={isAnalyzing} error={parseError} />

      {isAnalyzing && (
        <div className="flex items-center gap-3 rounded-xl border border-teal-900/60 bg-teal-950/30 px-4 py-3 text-sm text-teal-200">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
          Decompiling binary, extracting sections and profiling memory…
        </div>
      )}

      {metadata && (
        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
              <Layers size={15} className="text-cyan-300" />
              Module &amp; Soroban Metadata
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                metadata.isSoroban
                  ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"
                  : "border-slate-700 bg-slate-900 text-slate-400"
              }`}
            >
              {metadata.isSoroban ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {metadata.isSoroban ? "Soroban module" : "Plain WebAssembly"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Binary
              </p>
              <p className="mt-1 text-sm text-slate-200">
                {metadata.valid ? "Valid WASM magic header" : "Invalid WASM header"}
              </p>
              <p className="mt-1 text-xs text-slate-500">{metadata.totalSections} sections parsed</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Soroban Sections
              </p>
              <p className="mt-1 text-sm text-slate-200">
                {metadata.sorobanSectionNames.length > 0
                  ? metadata.sorobanSectionNames.join(", ")
                  : "None detected"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Custom Sections
              </p>
              <p className="mt-1 text-sm text-slate-200">{metadata.customSections.length}</p>
            </div>
          </div>

          {metadata.customSections.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Size</th>
                    <th className="hidden px-3 py-2 font-semibold sm:table-cell">Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 bg-slate-950/40">
                  {metadata.customSections.map((section) => (
                    <tr key={`${section.name}-${section.sizeBytes}`}>
                      <td className="px-3 py-2 font-mono text-teal-300">{section.name}</td>
                      <td className="px-3 py-2 text-slate-300">{formatBytes(section.sizeBytes)}</td>
                      <td className="hidden max-w-sm truncate px-3 py-2 text-slate-500 sm:table-cell">
                        {section.preview ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {metadata.producers && (
            <p className="mt-3 break-all text-xs text-slate-500">
              <span className="font-semibold text-slate-400">Producers:</span> {metadata.producers}
            </p>
          )}

          {metadata.specIdentifiers.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                <Search size={12} />
                Contract spec identifiers ({metadata.specIdentifiers.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {metadata.specIdentifiers.map((identifier) => (
                  <span
                    key={identifier}
                    className="rounded-md border border-cyan-800/50 bg-cyan-950/40 px-2 py-1 font-mono text-[11px] text-cyan-200"
                  >
                    {identifier}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {analysis && (
        <WasmArtifactPanel
          analysis={analysis}
          artifactName={meta?.name}
          artifactCreatedAt={meta ? new Date(meta.lastModified).toISOString() : undefined}
          isAnalyzing={isAnalyzing}
          parseError={parseError}
          onFileUpload={(file) => void handleFile(file)}
        />
      )}

      {metadata && !analysis && !isAnalyzing && !parseError && (
        <div className="rounded-2xl border border-amber-800/50 bg-amber-950/20 p-4 text-xs leading-5 text-amber-200">
          Sections and Soroban metadata were read directly from the binary, but the text
          disassembly could not be produced for this artifact.
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
          <Database size={15} className="text-indigo-300" />
          What the inspector reads
        </h2>
        <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="mb-1 font-semibold text-slate-200">Exported functions</p>
            Every function export with its export kind, used by the Call Panel to build arguments.
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="mb-1 font-semibold text-slate-200">Types</p>
            Type, table and memory declarations recovered from the module sections.
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="mb-1 font-semibold text-slate-200">Memory usage</p>
            <Braces size={11} className="mr-1 inline" />
            Section-by-section sizing, heap bounds and per-function size estimates.
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="mb-1 font-semibold text-slate-200">Soroban metadata</p>
            Contract spec, environment metadata, symbol table and producer custom sections.
          </div>
        </div>
      </section>
    </div>
  );
}
