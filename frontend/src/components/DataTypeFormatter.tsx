"use client";

import React from "react";

export type DataType =
  | "null"
  | "boolean"
  | "integer"
  | "decimal"
  | "hex"
  | "address"
  | "base64"
  | "json"
  | "string"
  | "unknown";

export function detectType(value: unknown): DataType {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "decimal";
  if (typeof value === "object") return "json";
  const s = String(value);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return "hex";
  if (/^G[A-Z0-9]{55}$/.test(s) || /^C[A-Z0-9]{55}$/.test(s)) return "address";
  if (/^[A-Za-z0-9+/]+=*$/.test(s) && s.length % 4 === 0 && s.length > 8) return "base64";
  if (/^-?\d+$/.test(s)) return "integer";
  if (/^-?\d+\.\d+$/.test(s)) return "decimal";
  return "string";
}

const TYPE_STYLE: Record<DataType, string> = {
  null:     "text-gray-400 italic",
  boolean:  "text-purple-400",
  integer:  "text-blue-400",
  decimal:  "text-blue-300",
  hex:      "text-yellow-400",
  address:  "text-green-400",
  base64:   "text-orange-400",
  json:     "text-cyan-300",
  string:   "text-emerald-300",
  unknown:  "text-gray-300",
};

const TYPE_LABEL: Record<DataType, string> = {
  null:    "null",
  boolean: "bool",
  integer: "i64",
  decimal: "f64",
  hex:     "hex",
  address: "addr",
  base64:  "b64",
  json:    "json",
  string:  "str",
  unknown: "?",
};

function formatDisplay(value: unknown, type: DataType): string {
  if (type === "null") return "∅";
  if (type === "json") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  const s = String(value);
  // truncate long hex
  if (type === "hex" && s.length > 42) return `${s.slice(0, 20)}…${s.slice(-10)}`;
  return s;
}

interface DataTypeFormatterProps {
  value: unknown;
  /** override auto-detected type */
  forceType?: DataType;
  showBadge?: boolean;
  className?: string;
}

const DataTypeFormatter: React.FC<DataTypeFormatterProps> = ({
  value,
  forceType,
  showBadge = true,
  className = "",
}) => {
  const type = forceType ?? detectType(value);
  const display = formatDisplay(value, type);
  const isMultiline = display.includes("\n");

  return (
    <span className={`inline-flex items-start gap-1.5 font-mono text-xs ${className}`}>
      {showBadge && (
        <span className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400 uppercase tracking-wide">
          {TYPE_LABEL[type]}
        </span>
      )}
      {isMultiline ? (
        <pre className={`whitespace-pre-wrap break-all ${TYPE_STYLE[type]}`}>{display}</pre>
      ) : (
        <span className={`break-all ${TYPE_STYLE[type]}`}>{display}</span>
      )}
    </span>
  );
};

export default DataTypeFormatter;
