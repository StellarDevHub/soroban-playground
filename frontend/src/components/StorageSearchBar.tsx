// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React from "react";
import { Search, X } from "lucide-react";
import { TypeBadge } from "./DataTypeFormatter";
import type { StorageDataType } from "./DataTypeFormatter";

export const DATA_TYPES: StorageDataType[] = [
  "address",
  "bytes",
  "integer",
  "number",
  "bool",
  "string",
  "vec",
  "map",
];

interface StorageSearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  typeFilter: StorageDataType | "";
  onTypeFilterChange: (t: StorageDataType | "") => void;
  resultCount: number;
  totalCount: number;
}

export default function StorageSearchBar({
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  resultCount,
  totalCount,
}: StorageSearchBarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {/* Text search */}
      <div className="relative flex-1">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search keys or values…"
          className="w-full bg-slate-800/70 text-slate-200 text-xs rounded-lg pl-8 pr-8 py-2 placeholder-slate-500 border border-slate-700/60 focus:outline-none focus:ring-1 focus:ring-teal-500/60 transition-colors"
          aria-label="Search storage entries"
        />
        {query && (
          <button
            onClick={() => onQueryChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Type filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onTypeFilterChange("")}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
            typeFilter === ""
              ? "bg-teal-500/15 border-teal-500/40 text-teal-300"
              : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-slate-200"
          }`}
          aria-pressed={typeFilter === ""}
        >
          All
        </button>
        {DATA_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => onTypeFilterChange(typeFilter === t ? "" : t)}
            className={`transition-opacity ${typeFilter !== "" && typeFilter !== t ? "opacity-50" : ""}`}
            aria-pressed={typeFilter === t}
            title={`Filter by ${t}`}
          >
            <TypeBadge type={t} />
          </button>
        ))}
      </div>

      {/* Result count */}
      {(query || typeFilter) && (
        <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0">
          {resultCount} / {totalCount}
        </span>
      )}
    </div>
  );
}
