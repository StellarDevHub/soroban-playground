// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState } from "react";

export type StorageDataType =
  | "address"
  | "bytes"
  | "integer"
  | "number"
  | "bool"
  | "string"
  | "vec"
  | "map"
  | "null"
  | "unknown"
  | string;

interface DataTypeFormatterProps {
  value: unknown;
  type: StorageDataType;
  /** If true, renders a compact badge-style version of the type label */
  showBadge?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  address: "text-sky-300 bg-sky-950/50 border-sky-800/60",
  bytes: "text-violet-300 bg-violet-950/50 border-violet-800/60",
  integer: "text-amber-300 bg-amber-950/50 border-amber-800/60",
  number: "text-amber-300 bg-amber-950/50 border-amber-800/60",
  bool: "text-rose-300 bg-rose-950/50 border-rose-800/60",
  string: "text-emerald-300 bg-emerald-950/50 border-emerald-800/60",
  vec: "text-cyan-300 bg-cyan-950/50 border-cyan-800/60",
  map: "text-teal-300 bg-teal-950/50 border-teal-800/60",
  null: "text-gray-500 bg-gray-900/50 border-gray-800/60",
  unknown: "text-gray-400 bg-gray-900/50 border-gray-800/60",
};

function badgeClass(type: StorageDataType): string {
  return (
    TYPE_COLORS[type] ??
    "text-slate-300 bg-slate-900/50 border-slate-700/60"
  );
}

function truncate(str: string, maxLen = 80): string {
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

function safeStr(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function AddressValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="flex items-center gap-1.5 font-mono text-sky-300">
      <span title={value}>{`${value.slice(0, 6)}…${value.slice(-4)}`}</span>
      <button
        onClick={copy}
        className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        title={copied ? "Copied!" : "Copy address"}
        aria-label={copied ? "Copied!" : "Copy address"}
      >
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}

function BytesValue({ value }: { value: string }) {
  const byteLen = Math.floor(value.replace(/\s/g, "").length / 2);
  return (
    <span className="font-mono text-violet-300" title={value}>
      {truncate(value, 40)}{" "}
      <span className="text-[10px] text-slate-500">({byteLen}B)</span>
    </span>
  );
}

export function TypeBadge({ type }: { type: StorageDataType }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${badgeClass(type)}`}
    >
      {type}
    </span>
  );
}

export default function DataTypeFormatter({
  value,
  type,
  showBadge = false,
}: DataTypeFormatterProps) {
  const [expanded, setExpanded] = useState(false);

  const renderValue = () => {
    if (type === "address" && typeof value === "string") {
      return <AddressValue value={value} />;
    }
    if (type === "bytes" && typeof value === "string") {
      return <BytesValue value={value} />;
    }
    if (type === "bool") {
      return (
        <span className={value ? "text-emerald-400" : "text-rose-400"}>
          {String(value)}
        </span>
      );
    }
    if (type === "null") {
      return <span className="text-gray-500 italic">null</span>;
    }
    if (type === "vec" || type === "map") {
      const str = safeStr(value);
      return (
        <span className="font-mono text-cyan-300">
          {expanded ? (
            <>
              <pre className="whitespace-pre-wrap break-all text-xs">{str}</pre>
              <button
                onClick={() => setExpanded(false)}
                className="text-[10px] text-slate-500 hover:text-slate-300 mt-1"
              >
                collapse
              </button>
            </>
          ) : (
            <>
              {truncate(str)}{" "}
              {str.length > 80 && (
                <button
                  onClick={() => setExpanded(true)}
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                >
                  expand
                </button>
              )}
            </>
          )}
        </span>
      );
    }
    // integer, number, string, unknown
    const str = safeStr(value);
    return (
      <span className="font-mono break-all">
        {truncate(str)}
      </span>
    );
  };

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      {showBadge && <TypeBadge type={type} />}
      {renderValue()}
    </span>
  );
}
