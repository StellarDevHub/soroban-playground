"use client";

import React from "react";
import { useMonaco } from "@/hooks/useMonaco";
import { useCollaborativeEditor } from "@/hooks/useCollaborativeEditor";
import { CollaborativeHeaderIndicator } from "@/components/CollaborativeHeaderIndicator";
import type { RustFormatDiagnostic } from "@/lib/rustfmtDiagnostics";

interface EditorProps {
  code: string;
  setCode: (value: string) => void;
  viewStateKey?: string;
  onFormat?: (source?: string) => void;
  formatDiagnostics?: RustFormatDiagnostic[];
  vimMode?: boolean;
}

function EditorLoadingState() {
  return (
    <div className="flex items-center justify-center h-full w-full text-gray-500">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full w-8 h-8 border-b-2 border-teal-500" />
        <span className="text-xs font-mono text-gray-400">
          Loading editor...
        </span>
      </div>
    </div>
  );
}

export default function Editor({
  code,
  setCode,
  viewStateKey,
  onFormat,
  formatDiagnostics,
  vimMode,
}: EditorProps) {
  const { peers, isConnected } = useCollaborativeEditor();
  const { containerRef, isEditorReady, languageServiceStatus, vimModeActive } = useMonaco({
    language: "rust",
    value: code,
    onChange: setCode,
    viewStateKey,
    onFormat,
    formatDiagnostics,
    vimMode,
  });

  return (
    <div id="workspace-editor" role="region" aria-label="Contract editor" aria-describedby="editor-keyboard-help" tabIndex={-1} className="relative h-[500px] w-full rounded-xl overflow-hidden border border-gray-800 bg-[#1e1e1e] shadow-2xl flex flex-col">
      <p id="editor-keyboard-help" className="sr-only">Use the editor command Toggle Tab Key Moves Focus to switch Tab between indentation and leaving the editor.</p>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/90 text-xs text-gray-400">
        <span className="font-mono text-[11px] font-semibold tracking-wide text-slate-300">
          lib.rs (Soroban Smart Contract)
        </span>
        <div className="flex items-center gap-3">
          {vimModeActive && (
            <span
              role="status"
              data-testid="monaco-vim-badge"
              aria-label="Monaco Vim editing mode active"
              className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 tracking-wider"
            >
              VIM
            </span>
          )}
          {languageServiceStatus && (
            <span
              role="status"
              aria-live="polite"
              aria-label={
                languageServiceStatus === "ready"
                  ? "Rust language worker ready"
                  : languageServiceStatus === "offline"
                    ? "Rust worker offline, using local syntax checks"
                    : "Rust language worker starting"
              }
              className={`text-[10px] font-medium ${
                languageServiceStatus === "ready"
                  ? "text-emerald-400"
                  : languageServiceStatus === "offline"
                    ? "text-amber-300"
                    : "text-slate-500"
              }`}
            >
              {languageServiceStatus === "ready"
                ? "Rust worker"
                : languageServiceStatus === "offline"
                  ? "Offline syntax"
                  : "Rust starting"}
            </span>
          )}
          <CollaborativeHeaderIndicator peers={peers} isConnected={isConnected} />
        </div>
      </div>
      <div className="flex-1 w-full relative">
        <div
          ref={containerRef}
          className="h-full w-full"
          data-testid="monaco-editor"
        />
        {!isEditorReady && <EditorLoadingState />}
      </div>
    </div>
  );
}