"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, GitBranch, History, RotateCcw } from "lucide-react";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-60 items-center justify-center rounded border border-white/10 text-xs text-slate-500">
        Loading diff editor…
      </div>
    ),
  },
);
import {
  getSnapshotDepth,
  type EditorConflict,
  type EditorSnapshot,
} from "@/utils/editorHistory";
import type {
  ConflictResolution,
  EditorHistoryStatus,
} from "@/hooks/useEditorHistory";

interface EditorHistoryPanelProps {
  snapshots: EditorSnapshot[];
  headId: string | null;
  conflict: EditorConflict | null;
  status: EditorHistoryStatus;
  error: string | null;
  currentCode: string;
  onRestore: (snapshotId: string) => void;
  onResolveConflict: (
    resolution: ConflictResolution,
    manualCode?: string,
  ) => void;
}

const diffOptions = {
  fontSize: 12,
  readOnly: true,
  renderSideBySide: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
};

export default function EditorHistoryPanel({
  snapshots,
  headId,
  conflict,
  status,
  error,
  currentCode,
  onRestore,
  onResolveConflict,
}: EditorHistoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(headId);
  const [manualCode, setManualCode] = useState(conflict?.localCode ?? "");
  const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const childCounts = new Map<string, number>();

  for (const snapshot of snapshots) {
    if (snapshot.parentId) {
      childCounts.set(
        snapshot.parentId,
        (childCounts.get(snapshot.parentId) ?? 0) + 1,
      );
    }
  }

  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.id === selectedId) ??
    snapshots.find((snapshot) => snapshot.id === headId) ??
    snapshots.at(-1);

  useEffect(() => {
    setManualCode(conflict?.localCode ?? "");
  }, [conflict?.detectedAt, conflict?.localCode]);

  const statusLabel: Record<EditorHistoryStatus, string> = {
    loading: "Loading history",
    saved: "Saved locally",
    saving: "Saving version",
    conflict: "Conflict needs review",
    unavailable: "History unavailable",
  };

  return (
    <section className="shrink-0 rounded-lg border border-white/10 bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={isOpen || Boolean(conflict)}
          className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-slate-200 hover:text-white"
          onClick={() => setIsOpen((open) => !open)}
        >
          <History size={16} />
          Version history
          <span className="font-mono text-xs text-slate-500">
            {snapshots.length}
          </span>
        </button>
        <span
          role="status"
          className={`inline-flex items-center gap-1.5 text-xs ${
            status === "conflict"
              ? "text-amber-300"
              : status === "unavailable"
                ? "text-rose-300"
                : "text-slate-400"
          }`}
        >
          {status === "conflict" || status === "unavailable" ? (
            <AlertCircle size={14} />
          ) : null}
          {statusLabel[status]}
        </span>
      </div>

      {error && (
        <p className="border-t border-white/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {(isOpen || conflict) && (
        <div className="space-y-3 border-t border-white/10 p-3">
          {conflict && (
            <div className="space-y-3 rounded-md border border-amber-400/30 bg-amber-400/5 p-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                  <AlertCircle size={16} />
                  Concurrent edits detected
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  This buffer changed in another tab while local edits were in
                  progress. Choose a version or edit a merged result; neither
                  copy has been discarded.
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-slate-300">
                    Local changes from shared base
                  </p>
                  <DiffEditor
                    height="200px"
                    language="rust"
                    original={conflict.baseCode}
                    modified={conflict.localCode}
                    options={diffOptions}
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-slate-300">
                    Latest saved changes from shared base
                  </p>
                  <DiffEditor
                    height="200px"
                    language="rust"
                    original={conflict.baseCode}
                    modified={conflict.remoteSnapshot.code}
                    options={diffOptions}
                  />
                </div>
              </div>
              <label className="block text-xs font-medium text-slate-300">
                Manual resolution
                <textarea
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  rows={5}
                  spellCheck={false}
                  className="mt-1 w-full resize-y rounded border border-white/10 bg-slate-950 p-2 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-teal-400/60"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-9 rounded border border-white/15 px-3 text-xs text-slate-200 hover:bg-white/5"
                  onClick={() => onResolveConflict("local")}
                >
                  Keep local
                </button>
                <button
                  type="button"
                  className="min-h-9 rounded border border-white/15 px-3 text-xs text-slate-200 hover:bg-white/5"
                  onClick={() => onResolveConflict("remote")}
                >
                  Use latest saved
                </button>
                <button
                  type="button"
                  className="min-h-9 rounded border border-teal-400/40 bg-teal-400/10 px-3 text-xs font-medium text-teal-100 hover:bg-teal-400/15"
                  onClick={() => onResolveConflict("manual", manualCode)}
                >
                  Save manual resolution
                </button>
              </div>
            </div>
          )}

          {isOpen && (
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {[...snapshots].reverse().map((snapshot) => {
                  const depth = Math.min(
                    getSnapshotDepth(snapshot, snapshotsById),
                    6,
                  );
                  const isSelected = snapshot.id === selectedSnapshot?.id;
                  return (
                    <div
                      key={snapshot.id}
                      style={{ paddingInlineStart: `${depth * 12}px` }}
                      className={`flex min-h-12 items-center gap-2 rounded px-2 py-1.5 ${
                        isSelected ? "bg-white/10" : "hover:bg-white/5"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedId(snapshot.id)}
                      >
                        <span className="flex items-center gap-1.5 truncate text-xs text-slate-200">
                          {depth > 0 ? <GitBranch size={13} /> : null}
                          {snapshot.reason === "resolution"
                            ? "Conflict resolution"
                            : "Autosaved version"}
                          {snapshot.id === headId && (
                            <span className="rounded bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-200">
                              HEAD
                            </span>
                          )}
                          {(childCounts.get(snapshot.id) ?? 0) > 1 && (
                            <span className="text-[10px] text-amber-200">
                              {childCounts.get(snapshot.id)} branches
                            </span>
                          )}
                        </span>
                        <time className="mt-1 block font-mono text-[10px] text-slate-500">
                          {new Intl.DateTimeFormat(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(snapshot.createdAt)}
                        </time>
                      </button>
                      {snapshot.id !== headId && (
                        <button
                          type="button"
                          aria-label="Restore this version"
                          title="Restore this version"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
                          onClick={() => onRestore(snapshot.id)}
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {snapshots.length === 0 && (
                  <p className="px-2 py-4 text-xs text-slate-500">
                    No saved versions yet.
                  </p>
                )}
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-slate-300">
                  Working copy vs selected version
                </p>
                {selectedSnapshot ? (
                  <DiffEditor
                    height="240px"
                    language="rust"
                    original={currentCode}
                    modified={selectedSnapshot.code}
                    options={diffOptions}
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center rounded border border-white/10 text-xs text-slate-500">
                    Save a change to start version history.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}