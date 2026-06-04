"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState, useCallback, useMemo } from "react";
import { Database, RefreshCw, Download } from "lucide-react";
import StorageTree from "@/components/StorageTree";
import StorageSearchBar from "@/components/StorageSearchBar";
import type { StorageEntry } from "@/components/StorageTree";
import type { StorageDataType } from "@/components/DataTypeFormatter";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

const NETWORKS = ["testnet", "mainnet", "futurenet", "standalone"] as const;
type Network = (typeof NETWORKS)[number];

function exportJson(entries: StorageEntry[], contractId: string) {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `storage-${contractId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(entries: StorageEntry[], contractId: string) {
  const rows = [
    ["id", "key", "type", "value"],
    ...entries.map((e) => [
      String(e.id),
      e.key,
      e.type,
      typeof e.value === "string" ? e.value : JSON.stringify(e.value),
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `storage-${contractId.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StorageBrowserPage() {
  const [contractId, setContractId] = useState("");
  const [network, setNetwork] = useState<Network>("testnet");
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedContract, setLoadedContract] = useState("");

  // Search / filter state
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<StorageDataType | "">("");

  const fetchEntries = useCallback(async () => {
    const id = contractId.trim();
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/storage/entries?contractId=${encodeURIComponent(id)}&network=${network}`
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setEntries(data.data.entries);
      setLoadedContract(id);
      setQuery("");
      setTypeFilter("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch storage");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [contractId, network]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") fetchEntries();
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (typeFilter && entry.type !== typeFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      const valueStr =
        typeof entry.value === "string"
          ? entry.value.toLowerCase()
          : JSON.stringify(entry.value).toLowerCase();
      return entry.key.toLowerCase().includes(q) || valueStr.includes(q);
    });
  }, [entries, query, typeFilter]);

  return (
    <main className="min-h-screen bg-[#060c18] text-slate-200 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20">
            <Database size={20} className="text-teal-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Storage Browser</h1>
            <p className="text-xs text-slate-500">
              Inspect and explore contract ledger storage entries
            </p>
          </div>
        </div>

        {/* Query bar */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Contract ID (C…)"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 bg-slate-800/70 text-slate-200 text-sm rounded-xl px-4 py-2.5 placeholder-slate-500 border border-slate-700/60 focus:outline-none focus:ring-1 focus:ring-teal-500/60 font-mono transition-colors"
            aria-label="Contract ID"
          />
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as Network)}
            className="bg-slate-800/70 text-slate-200 text-sm rounded-xl px-3 py-2.5 border border-slate-700/60 focus:outline-none focus:ring-1 focus:ring-teal-500/60 transition-colors"
            aria-label="Network"
          >
            {NETWORKS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            onClick={fetchEntries}
            disabled={loading || !contractId.trim()}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-2.5 rounded-xl transition-colors font-medium"
            aria-label="Load storage"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Load"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            className="bg-rose-900/25 border border-rose-700/50 text-rose-300 text-xs rounded-xl px-4 py-3"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Results section */}
        {loadedContract && (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <StorageSearchBar
                  query={query}
                  onQueryChange={setQuery}
                  typeFilter={typeFilter}
                  onTypeFilterChange={setTypeFilter}
                  resultCount={filteredEntries.length}
                  totalCount={entries.length}
                />
              </div>
              {/* Export buttons */}
              {entries.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => exportJson(filteredEntries, loadedContract)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 px-3 py-1.5 rounded-lg transition-colors"
                    title="Export as JSON"
                  >
                    <Download size={12} />
                    JSON
                  </button>
                  <button
                    onClick={() => exportCsv(filteredEntries, loadedContract)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 px-3 py-1.5 rounded-lg transition-colors"
                    title="Export as CSV"
                  >
                    <Download size={12} />
                    CSV
                  </button>
                </div>
              )}
            </div>

            {/* Info pill */}
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="font-mono text-slate-400">{loadedContract.slice(0, 10)}…</span>
              <span>·</span>
              <span>{network}</span>
              <span>·</span>
              <span>{entries.length} entries</span>
            </div>

            {/* Storage tree */}
            <StorageTree entries={filteredEntries} />
          </div>
        )}

        {/* Empty state */}
        {!loadedContract && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-600 space-y-2">
            <Database size={36} className="opacity-30" />
            <p className="text-sm">Enter a contract ID to browse its storage</p>
          </div>
        )}
      </div>
    </main>
  );
}
