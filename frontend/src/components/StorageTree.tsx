"use client";

import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import DataTypeFormatter, { detectType } from "./DataTypeFormatter";
import type { LedgerState } from "@/utils/transactionGraph";

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

interface StorageEntry {
  key: string;
  value: unknown;
  diff: DiffKind;
}

interface StorageTreeProps {
  entries: StorageEntry[];
  className?: string;
}

const DIFF_DOT: Record<DiffKind, string> = {
  added:     "bg-emerald-400",
  removed:   "bg-rose-400",
  changed:   "bg-amber-400",
  unchanged: "bg-transparent",
};

const DIFF_ROW: Record<DiffKind, string> = {
  added:     "border-l-2 border-emerald-500/60",
  removed:   "border-l-2 border-rose-500/60 opacity-60",
  changed:   "border-l-2 border-amber-500/60",
  unchanged: "border-l-2 border-transparent",
};

function isExpandable(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function ExpandableNode({
  keyName,
  value,
  diff,
}: {
  keyName: string;
  value: Record<string, unknown> | unknown[];
  diff: DiffKind;
}) {
  const [open, setOpen] = useState(false);
  const entries = Array.isArray(value)
    ? value.map((v, i) => ({ k: String(i), v }))
    : Object.entries(value).map(([k, v]) => ({ k, v }));

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-800/60 rounded text-left ${DIFF_ROW[diff]}`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${DIFF_DOT[diff]}`} />
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        )}
        <span className="text-xs font-mono text-cyan-300 truncate">{keyName}</span>
        <span className="text-xs text-gray-500 ml-1">
          {Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}
        </span>
      </button>

      {open && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {entries.map(({ k, v }) =>
            isExpandable(v) ? (
              <ExpandableNode
                key={k}
                keyName={k}
                value={v as Record<string, unknown>}
                diff="unchanged"
              />
            ) : (
              <div
                key={k}
                className="flex items-baseline gap-2 px-2 py-1 text-xs font-mono"
              >
                <span className="text-cyan-400/70 shrink-0">{k}:</span>
                <DataTypeFormatter value={v} showBadge={false} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

const StorageTree: React.FC<StorageTreeProps> = ({ entries, className = "" }) => {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No storage entries match your search.
      </div>
    );
  }

  return (
    <div className={`space-y-0.5 font-mono text-xs ${className}`}>
      {entries.map(({ key, value, diff }) => {
        if (isExpandable(value)) {
          return (
            <ExpandableNode
              key={key}
              keyName={key}
              value={value as Record<string, unknown>}
              diff={diff}
            />
          );
        }

        return (
          <div
            key={key}
            className={`flex items-baseline gap-2 px-2 py-1.5 rounded hover:bg-gray-800/40 ${DIFF_ROW[diff]}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${DIFF_DOT[diff]}`} />
            <span className="text-cyan-300 shrink-0 truncate max-w-[40%]">{key}</span>
            <span className="text-gray-600">:</span>
            <DataTypeFormatter value={value} />
          </div>
        );
      })}
    </div>
  );
};

export type { StorageEntry };
export default StorageTree;
