"use client";

import React, { useState, useMemo } from "react";
import { Database, Download, AlertCircle, RefreshCw } from "lucide-react";
import StorageTree from "@/components/StorageTree";
import StorageSearchBar, { type StorageSearchState } from "@/components/StorageSearchBar";
import DataTypeFormatter, { detectType } from "@/components/DataTypeFormatter";
import type { StorageEntry, DiffKind } from "@/components/StorageTree";

const DEMO_STORAGE: Record<string, unknown> = {
  "counter": 42,
  "owner": "GABC1234567890XYZTESTACCOUNTADDRESSFULL1234567890AB",
  "config": {
    "max_supply": 1000000,
    "decimals": 7,
    "paused": false,
  },
  "balances": {
    "GABC1234567890": 5000,
    "GDEF0987654321": 2500,
  },
  "metadata": "aGVsbG8gd29ybGQgZnJvbSBzb3JvYmFu",
  "prices": [1.23, 4.56, 7.89],
  "last_hash": "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081",
  "total_supply": 7500,
  "initialized": true,
  "admin_nonce": null,
};

const DEMO_DIFF: Record<string, DiffKind> = {
  counter: "changed",
  total_supply: "changed",
  "balances.GDEF0987654321": "added",
  last_hash: "changed",
};

function exportJSON(data: Record<string, unknown>, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(entries: StorageEntry[], filename: string) {
  const rows = entries.map((e) => {
    const v = typeof e.value === "object" ? JSON.stringify(e.value) : String(e.value);
    return `"${e.key}","${detectType(e.value)}","${v.replace(/"/g, '""')}","${e.diff}"`;
  });
  const csv = ["Key,Type,Value,Diff", ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StorageBrowserPage() {
  const [contractId, setContractId] = useState("CDEMO…CONTRACTID");
  const [searchState, setSearchState] = useState<StorageSearchState>({ query: "", types: [] });
  const [autoRefresh, setAutoRefresh] = useState(false);

  const entries: StorageEntry[] = useMemo(() => {
    const all: StorageEntry[] = Object.entries(DEMO_STORAGE).map(([key, value]) => ({
      key,
      value,
      diff: (DEMO_DIFF[key] ?? "unchanged") as DiffKind,
    }));

    let filtered = all;

    if (searchState.query) {
      const q = searchState.query.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.key.toLowerCase().includes(q) ||
          String(e.value).toLowerCase().includes(q)
      );
    }

    if (searchState.types.length > 0) {
      filtered = filtered.filter((e) => searchState.types.includes(detectType(e.value)));
    }

    return filtered;
  }, [searchState]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold">Contract Storage Browser</h1>
          </div>
          <p className="text-sm text-gray-400">
            Inspect, search, and export contract storage data with type detection and diff tracking.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* API integration notice */}
        <div className="flex items-start gap-3 p-4 bg-blue-950/20 border border-blue-800/40 rounded-lg">
          <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-blue-300 font-medium mb-1">Demo Mode</p>
            <p className="text-blue-200/70">
              Backend storage API integration pending. Showing mock data for UI testing. Real-time polling will fetch from{" "}
              <code className="bg-blue-950 px-1.5 py-0.5 rounded text-xs">
                GET /api/storage/:contractId
              </code>
            </p>
          </div>
        </div>

        {/* Contract ID input */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <label htmlFor="contractId" className="block text-sm font-medium text-gray-300 mb-2">
            Contract ID
          </label>
          <div className="flex gap-2">
            <input
              id="contractId"
              type="text"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="C… (56 chars)"
              className="flex-1 px-3 py-2 text-sm bg-gray-950 border border-gray-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none font-mono"
            />
            <button
              onClick={() => {/* API fetch here */}}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm rounded-lg transition-colors"
            >
              Load
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-gray-300 mb-3">Search & Filter</h2>
          <StorageSearchBar value={searchState} onChange={setSearchState} />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-600 focus:ring-cyan-500"
              />
              <RefreshCw className="w-3.5 h-3.5" />
              Auto-refresh (5s)
            </label>
            <span className="text-xs text-gray-500">
              {entries.length} / {Object.keys(DEMO_STORAGE).length} entries
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => exportJSON(DEMO_STORAGE, `storage-${Date.now()}.json`)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </button>
            <button
              onClick={() => exportCSV(entries, `storage-${Date.now()}.csv`)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        {/* Storage Tree */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-gray-300 mb-3">Storage Entries</h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 max-h-[600px] overflow-y-auto">
            <StorageTree entries={entries} />
          </div>
        </div>
      </div>
    </div>
  );
}
