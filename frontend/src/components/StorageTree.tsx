// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import DataTypeFormatter, { TypeBadge } from "./DataTypeFormatter";
import type { StorageDataType } from "./DataTypeFormatter";

export interface StorageEntry {
  id: number;
  key: string;
  keyRaw: unknown;
  value: unknown;
  type: StorageDataType;
}

interface StorageTreeProps {
  entries: StorageEntry[];
}

/** Recursively render a JSON value as a collapsible tree node */
function TreeNode({
  label,
  value,
  depth = 0,
}: {
  label: string;
  value: unknown;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isComplex = value !== null && typeof value === "object";
  const children = isComplex
    ? Array.isArray(value)
      ? (value as unknown[]).map((v, i) => ({ key: String(i), val: v }))
      : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
          key: k,
          val: v,
        }))
    : [];

  const indent = depth * 14;

  return (
    <div style={{ paddingLeft: indent }}>
      <div className="flex items-start gap-1 py-0.5 group">
        {isComplex && children.length > 0 ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 mt-0.5 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-slate-400 font-mono text-xs shrink-0">{label}:</span>
        {isComplex ? (
          <span className="text-slate-500 text-xs ml-1">
            {Array.isArray(value) ? `[${children.length}]` : `{${children.length}}`}
          </span>
        ) : (
          <span className="ml-1">
            <DataTypeFormatter
              value={value}
              type={
                typeof value === "boolean"
                  ? "bool"
                  : value === null
                  ? "null"
                  : typeof value === "number"
                  ? "number"
                  : "string"
              }
            />
          </span>
        )}
      </div>
      {isComplex && open && children.map(({ key, val }) => (
        <TreeNode key={key} label={key} value={val} depth={depth + 1} />
      ))}
    </div>
  );
}

function EntryRow({ entry }: { entry: StorageEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isComplex =
    entry.value !== null && typeof entry.value === "object";

  return (
    <div className="border-b border-slate-800/50 last:border-0">
      <div
        className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-800/30 transition-colors cursor-pointer"
        onClick={() => isComplex && setExpanded((e) => !e)}
        role={isComplex ? "button" : undefined}
        aria-expanded={isComplex ? expanded : undefined}
      >
        {/* Expand toggle */}
        <span className="mt-0.5 shrink-0 text-slate-600 w-3">
          {isComplex ? (
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>

        {/* Key */}
        <span className="font-mono text-xs text-cyan-300 break-all w-48 shrink-0">
          {entry.key}
        </span>

        {/* Type badge */}
        <span className="shrink-0">
          <TypeBadge type={entry.type} />
        </span>

        {/* Value */}
        <span className="text-xs flex-1 min-w-0">
          {isComplex && !expanded ? (
            <span className="text-slate-500 italic">
              {Array.isArray(entry.value)
                ? `Array(${(entry.value as unknown[]).length})`
                : `Object(${Object.keys(entry.value as object).length})`}
              {" — click to expand"}
            </span>
          ) : !isComplex ? (
            <DataTypeFormatter value={entry.value} type={entry.type} />
          ) : null}
        </span>
      </div>

      {/* Expanded tree */}
      {expanded && isComplex && (
        <div className="px-4 pb-3 bg-slate-900/40 border-t border-slate-800/40">
          {Array.isArray(entry.value)
            ? (entry.value as unknown[]).map((v, i) => (
                <TreeNode key={i} label={String(i)} value={v} depth={0} />
              ))
            : Object.entries(entry.value as Record<string, unknown>).map(
                ([k, v]) => <TreeNode key={k} label={k} value={v} depth={0} />
              )}
        </div>
      )}
    </div>
  );
}

export default function StorageTree({ entries }: StorageTreeProps) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic text-center py-8">
        No entries match your search.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800/60 overflow-hidden bg-slate-900/50">
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2 bg-slate-800/40 border-b border-slate-700/40">
        <span className="w-3 shrink-0" />
        <span className="font-semibold text-[10px] text-slate-500 uppercase tracking-wider w-48 shrink-0">Key</span>
        <span className="font-semibold text-[10px] text-slate-500 uppercase tracking-wider shrink-0">Type</span>
        <span className="font-semibold text-[10px] text-slate-500 uppercase tracking-wider">Value</span>
      </div>
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
