"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import type { DataType } from "./DataTypeFormatter";

export const DATA_TYPES: DataType[] = [
  "address", "boolean", "base64", "decimal", "hex", "integer", "json", "null", "string",
];

export interface StorageSearchState {
  query: string;
  types: DataType[];
}

interface StorageSearchBarProps {
  value: StorageSearchState;
  onChange: (s: StorageSearchState) => void;
  className?: string;
}

const StorageSearchBar: React.FC<StorageSearchBarProps> = ({ value, onChange, className = "" }) => {
  const [localQuery, setLocalQuery] = useState(value.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalQuery(value.query);
  }, [value.query]);

  const handleQueryChange = (q: string) => {
    setLocalQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange({ ...value, query: q }), 200);
  };

  const toggleType = (type: DataType) => {
    const next = value.types.includes(type)
      ? value.types.filter((t) => t !== type)
      : [...value.types, type];
    onChange({ ...value, types: next });
  };

  const clearAll = () => {
    setLocalQuery("");
    onChange({ query: "", types: [] });
  };

  const hasFilters = localQuery || value.types.length > 0;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={localQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search keys or values…"
          aria-label="Search storage"
          autoComplete="off"
          spellCheck={false}
          className="w-full pl-9 pr-9 py-2 text-sm bg-gray-900 text-gray-100 border border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none placeholder-gray-500"
        />
        {hasFilters && (
          <button
            onClick={clearAll}
            aria-label="Clear filters"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by data type">
        {DATA_TYPES.map((type) => {
          const active = value.types.includes(type);
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              aria-pressed={active}
              className={`px-2 py-0.5 text-xs rounded font-mono transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {type}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StorageSearchBar;
