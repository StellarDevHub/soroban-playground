import React, { useMemo } from "react";
import { Binary, Braces, Cpu, FunctionSquare, HardDrive, MemoryStick } from "lucide-react";
import { List, type RowComponentProps } from "react-window";
import type { WasmArtifactAnalysis } from "@/utils/wasmInspector";

interface WasmArtifactPanelProps {
  analysis: WasmArtifactAnalysis | null;
  artifactName?: string;
  artifactCreatedAt?: string;
  isAnalyzing: boolean;
  parseError: string | null;
}

interface WatRowProps {
  lines: string[];
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function WatRow({ index, style, lines }: RowComponentProps<WatRowProps>) {
  return (
    <div style={style} className="flex border-b border-gray-900/40">
      <span className="w-14 shrink-0 select-none px-3 py-0.5 text-right font-mono text-[11px] leading-5 text-gray-600">
        {index + 1}
      </span>
      <code className="min-w-0 flex-1 overflow-hidden px-3 py-0.5 font-mono text-[11px] leading-5 whitespace-pre text-gray-200">
        {lines[index] || " "}
      </code>
    </div>
  );
}

export default function WasmArtifactPanel({
  analysis,
  artifactName,
  artifactCreatedAt,
  isAnalyzing,
  parseError,
}: WasmArtifactPanelProps) {
  const watRowProps = useMemo(
    () => ({
      lines: analysis?.watLines ?? [],
    }),
    [analysis?.watLines],
  );

  const memorySummary = analysis?.memory;
  const resolvedMemory = memorySummary && memorySummary.source !== "none" ? memorySummary : null;

  return (
    <div className="flex flex-col space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-lg">
      <h3 className="mb-1 flex items-center text-sm font-semibold tracking-widest text-gray-300 uppercase">
        <Binary size={16} className="mr-2 text-cyan-300" />
        Wasm Analysis
      </h3>

      {isAnalyzing && (
        <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-200">
          Parsing wasm artifact in browser...
        </div>
      )}

      {parseError && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{parseError}</div>
      )}

      {!analysis && !isAnalyzing && !parseError && (
        <p className="text-sm text-gray-500">Compile a contract to inspect exports, memory metrics, and WAT output.</p>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
              <p className="mb-2 text-xs tracking-wider text-gray-500 uppercase">Artifact</p>
              <p className="truncate font-mono text-xs text-gray-300">{artifactName ?? "soroban_contract.wasm"}</p>
              <p className="mt-2 flex items-center text-sm text-gray-100">
                <HardDrive size={14} className="mr-2 text-emerald-300" />
                {formatBytes(analysis.sizeBytes)} ({analysis.sizeKiB} KiB)
              </p>
              {artifactCreatedAt && (
                <p className="mt-2 text-xs text-gray-500">Built {new Date(artifactCreatedAt).toLocaleString()}</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
              <p className="mb-2 text-xs tracking-wider text-gray-500 uppercase">Memory Metrics</p>
              {!resolvedMemory ? (
                <p className="text-sm text-gray-400">No memory section declared.</p>
              ) : (
                <div className="space-y-1 text-sm text-gray-200">
                  <p className="flex items-center text-xs text-gray-400 uppercase tracking-wider">
                    <MemoryStick size={13} className="mr-2 text-indigo-300" />
                    {resolvedMemory.source === "defined" ? "Defined in module" : "Imported memory"}
                  </p>
                  <p>Minimum: {resolvedMemory.minPages} pages ({formatBytes(resolvedMemory.minBytes)})</p>
                  <p>
                    Maximum:{" "}
                    {resolvedMemory.maxPages === null
                      ? "unbounded"
                      : `${resolvedMemory.maxPages} pages (${formatBytes(resolvedMemory.maxBytes)})`}
                  </p>
                  <p>
                    Shared: {resolvedMemory.shared ? "yes" : "no"} | 64-bit memory: {resolvedMemory.memory64 ? "yes" : "no"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
              <p className="mb-2 flex items-center text-xs tracking-wider text-gray-500 uppercase">
                <FunctionSquare size={14} className="mr-2 text-amber-300" />
                Exported Functions ({analysis.exportFunctions.length})
              </p>
              {analysis.exportFunctions.length === 0 ? (
                <p className="text-sm text-gray-500">No function exports detected.</p>
              ) : (
                <div className="max-h-36 space-y-1 overflow-y-auto pr-1 font-mono text-xs text-gray-200">
                  {analysis.exportFunctions.map((name) => (
                    <div key={name} className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1">
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
              <p className="mb-2 flex items-center text-xs tracking-wider text-gray-500 uppercase">
                <Cpu size={14} className="mr-2 text-cyan-300" />
                Export Kinds
              </p>
              <div className="space-y-1 font-mono text-xs text-gray-200">
                {Object.entries(analysis.exportKinds).map(([kind, count]) => (
                  <div key={kind} className="flex items-center justify-between rounded border border-gray-800 bg-gray-900/70 px-2 py-1">
                    <span>{kind}</span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-950">
            <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
              <p className="flex items-center text-xs tracking-wider text-gray-500 uppercase">
                <Braces size={13} className="mr-2 text-cyan-300" />
                WebAssembly Text (WAT)
              </p>
              <p className="font-mono text-xs text-gray-500">{analysis.watLines.length.toLocaleString()} lines</p>
            </div>

            <div className="h-[360px] w-full overflow-hidden">
              <List
                className="w-full"
                defaultHeight={360}
                overscanCount={18}
                rowComponent={WatRow}
                rowCount={analysis.watLines.length}
                rowHeight={22}
                rowProps={watRowProps}
                style={{ height: 360 }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
