"use client";

import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface TemplateSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
}

export default function TemplateSearchBar({
  value,
  onChange,
  resultCount,
}: TemplateSearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (next: string) => {
    setLocalValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(next);
    }, 200);
  };

  const handleClear = () => {
    setLocalValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <label
          htmlFor="template-search"
          className="sr-only"
        >
          Search templates
        </label>
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
        />
        <input
          id="template-search"
          type="text"
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search templates by name, category, or keywords..."
          aria-label="Search contract templates"
          className="w-full rounded-xl border border-slate-800 bg-slate-900/60 pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
        />
        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <p
        className="text-xs text-slate-500"
        aria-live="polite"
        aria-atomic="true"
      >
        {resultCount} {resultCount === 1 ? "template" : "templates"} found
      </p>
    </div>
  );
}
