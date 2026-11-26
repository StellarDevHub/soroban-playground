"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Database,
  Download,
  AlertCircle,
  RefreshCw,
  Zap,
  Filter,
  Eye,
  Layers,
  FileCode,
  ShieldCheck,
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import StorageTree from "@/components/StorageTree";
import StorageSearchBar, {
  type StorageSearchState,
} from "@/components/StorageSearchBar";
import DataTypeFormatter, { detectType } from "@/components/DataTypeFormatter";
import StorageStateDiffDebugger from "@/components/StorageStateDiffDebugger";
import type { StorageEntry, DiffKind } from "@/components/StorageTree";
import type {
  StorageBrowserEntry,
  StorageDurability,
  TtlHealthStatus
} from "@/types/storageBrowser";
import {
  getMockStorageEntries,
  calculateTtlStatus
} from "@/services/storageBrowserService";
import { parseWasmContractSpec } from "@/services/wasmXdrParser";
import TtlBadge from "@/components/storage/TtlBadge";
import BumpTtlModal from "@/components/storage/BumpTtlModal";
import StorageEntryDetailModal from "@/components/storage/StorageEntryDetailModal";

const CURRENT_LEDGER_DEFAULT = 1000000;

export default function StorageBrowserPage() {
  const [contractId, setContractId] = useState(
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"
  );
  const [currentLedger, setCurrentLedger] = useState<number>(CURRENT_LEDGER_DEFAULT);
  const [viewMode, setViewMode] = useState<"abi" | "tree">("abi");
  const [durabilityFilter, setDurabilityFilter] = useState<string>("all");
  const [ttlFilter, setTtlFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Entries state
  const [entries, setEntries] = useState<StorageBrowserEntry[]>(() =>
    getMockStorageEntries(CURRENT_LEDGER_DEFAULT, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM")
  );

  // Active modals
  const [bumpEntry, setBumpEntry] = useState<StorageBrowserEntry | null>(null);
  const [detailEntry, setDetailEntry] = useState<StorageBrowserEntry | null>(null);
  const [expandedXdr, setExpandedXdr] = useState<Record<string, boolean>>({});

  // Tree mode search state
  const [searchState, setSearchState] = useState<StorageSearchState>({
    query: "",
    types: [],
  });

  const toggleXdrExpand = (id: string) => {
    setExpandedXdr((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleBumpSuccess = useCallback(
    (entryId: string, newLiveUntil: number) => {
      setEntries((prev) =>
        prev.map((entry) => {
          if (entry.id !== entryId) return entry;
          return {
            ...entry,
            ttl: calculateTtlStatus(newLiveUntil, currentLedger, entry.durability),
            diff: "changed"
          };
        })
      );
    },
    [currentLedger]
  );

  // Filtered on-chain entries
  const filteredAbiEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (durabilityFilter !== "all" && entry.durability !== durabilityFilter) {
        return false;
      }

      if (ttlFilter !== "all") {
        if (!entry.ttl && ttlFilter !== "none") return false;
        if (ttlFilter === "expiring" && !entry.ttl?.isExpiring) return false;
        if (ttlFilter === "critical" && !entry.ttl?.isCritical) return false;
        if (ttlFilter === "healthy" && entry.ttl?.status !== "healthy") return false;
        if (ttlFilter === "archived" && entry.ttl?.status !== "archived") return false;
      }

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const keyMatch =
          entry.keyDecoded.displayValue.toLowerCase().includes(q) ||
          entry.keyDecoded.type.toLowerCase().includes(q) ||
          entry.keyRaw.toLowerCase().includes(q);
        const valMatch =
          entry.valDecoded.displayValue.toLowerCase().includes(q) ||
          entry.valDecoded.type.toLowerCase().includes(q) ||
          entry.valRaw.toLowerCase().includes(q);
        return keyMatch || valMatch;
      }

      return true;
    });
  }, [entries, durabilityFilter, ttlFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = entries.length;
    const expiringPersistent = entries.filter(
      (e) => e.durability === "persistent" && e.ttl?.isExpiring
    ).length;
    const healthy = entries.filter((e) => e.ttl?.status === "healthy").length;
    const archived = entries.filter((e) => e.ttl?.status === "archived").length;
    return { total, expiringPersistent, healthy, archived };
  }, [entries]);

  // Export Decoded JSON
  const handleExportJSON = () => {
    const exportData = {
      contractId,
      currentLedger,
      exportedAt: new Date().toISOString(),
      entries: entries.map((e) => ({
        id: e.id,
        durability: e.durability,
        key: {
          type: e.keyDecoded.type,
          decoded: e.keyDecoded.nativeValue,
          rawXdr: e.keyRaw
        },
        value: {
          type: e.valDecoded.type,
          decoded: e.valDecoded.nativeValue,
          rawXdr: e.valRaw
        },
        ttl: e.ttl
          ? {
              status: e.ttl.status,
              ledgersRemaining: e.ttl.ledgersRemaining,
              liveUntilLedgerSeq: e.ttl.liveUntilLedgerSeq,
              estimatedTimeRemaining: e.ttl.estimatedTimeRemaining
            }
          : null,
        diff: e.diff
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soroban-storage-${contractId.slice(0, 8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export CSV
  const handleExportCSV = () => {
    const rows = entries.map((e) => {
      const keyStr = e.keyDecoded.displayValue.replace(/"/g, '""');
      const valStr = e.valDecoded.displayValue.replace(/"/g, '""');
      const ledgers = e.ttl ? e.ttl.ledgersRemaining : "N/A";
      const status = e.ttl ? e.ttl.status : "none";
      return `"${e.id}","${e.durability}","${e.keyDecoded.type}","${keyStr}","${e.valDecoded.type}","${valStr}","${status}","${ledgers}","${e.diff}"`;
    });
    const csv = [
      "ID,Durability,KeyType,DecodedKey,ValueType,DecodedValue,TtlStatus,LedgersRemaining,Diff",
      ...rows,
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soroban-storage-${contractId.slice(0, 8)}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Convert for legacy tree view
  const legacyTreeEntries: StorageEntry[] = useMemo(() => {
    return entries.map((e) => ({
      key: e.keyDecoded.displayValue,
      value: e.valDecoded.nativeValue,
      diff: e.diff as DiffKind,
    }));
  }, [entries]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top Banner */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-5 h-5 text-cyan-400" />
              <h1 className="text-xl font-bold tracking-tight">
                Contract Storage Browser
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 uppercase">
                ABI Decoded
              </span>
            </div>
            <p className="text-sm text-gray-400">
              Inspect on-chain contract storage, decode complex struct keys and enum values with ABI metadata, monitor TTL status countdown, and bump persistent entries.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-xs font-mono">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-gray-400">Ledger:</span>
              <span className="text-emerald-400 font-bold">
                #{currentLedger.toLocaleString()}
              </span>
            </div>

            {/* View Mode Toggle */}
            <div className="flex rounded-lg bg-gray-950 border border-gray-800 p-0.5 text-xs">
              <button
                onClick={() => setViewMode("abi")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  viewMode === "abi"
                    ? "bg-cyan-600 text-white font-medium"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                ABI Table
              </button>
              <button
                onClick={() => setViewMode("tree")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  viewMode === "tree"
                    ? "bg-cyan-600 text-white font-medium"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Tree View
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Expiring Alert Banner */}
        {stats.expiringPersistent > 0 && (
          <div className="flex items-center justify-between p-4 bg-amber-950/30 border border-amber-800/50 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  {stats.expiringPersistent} Persistent Storage Entries Expiring Soon
                </p>
                <p className="text-xs text-amber-200/80 mt-0.5">
                  Persistent entries nearing expiration can be extended with a one-click Bump TTL transaction to prevent state archival on Stellar.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setDurabilityFilter("persistent");
                setTtlFilter("expiring");
              }}
              className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-600/40 text-amber-300 text-xs font-semibold rounded-lg transition-colors shrink-0"
            >
              Filter Expiring Entries
            </button>
          </div>
        )}

        {/* Contract ID & Metadata Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-lg p-4">
            <label
              htmlFor="contractIdInput"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Contract Address (C… 56 characters)
            </label>
            <div className="flex gap-2">
              <input
                id="contractIdInput"
                type="text"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                placeholder="C… (56 chars)"
                className="flex-1 px-3 py-2 text-xs bg-gray-950 border border-gray-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none font-mono text-gray-100"
              />
              <button
                onClick={() => {
                  setEntries(getMockStorageEntries(currentLedger, contractId));
                }}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload
              </button>
            </div>
          </div>

          {/* ABI Spec Status Card */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                ABI Metadata Spec
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800/40">
                Active
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Contract spec loaded: Structs (AllowanceKey, AllowanceData), Enums (ContractState), Unions (DataKey).
            </p>
            <div className="flex items-center gap-2 text-[11px] text-cyan-400 font-mono mt-2">
              <span>Automatic XDR & UDT Deserialization</span>
            </div>
          </div>
        </div>

        {/* Statistics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-900/80 border border-gray-800 rounded-lg p-3">
            <span className="text-xs text-gray-400 block mb-1">Total Entries</span>
            <span className="text-xl font-bold font-mono text-gray-100">
              {stats.total}
            </span>
          </div>
          <div className="bg-gray-900/80 border border-gray-800 rounded-lg p-3">
            <span className="text-xs text-amber-400 block mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Expiring Soon
            </span>
            <span className="text-xl font-bold font-mono text-amber-400">
              {stats.expiringPersistent}
            </span>
          </div>
          <div className="bg-gray-900/80 border border-gray-800 rounded-lg p-3">
            <span className="text-xs text-emerald-400 block mb-1 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Healthy TTL
            </span>
            <span className="text-xl font-bold font-mono text-emerald-400">
              {stats.healthy}
            </span>
          </div>
          <div className="bg-gray-900/80 border border-gray-800 rounded-lg p-3">
            <span className="text-xs text-gray-400 block mb-1 flex items-center gap-1">
              <Archive className="w-3 h-3 text-rose-400" />
              Archived
            </span>
            <span className="text-xl font-bold font-mono text-rose-400">
              {stats.archived}
            </span>
          </div>
        </div>

        {/* Filters and Actions Bar */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search storage keys, structs, values..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-gray-950 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-cyan-500"
              />
            </div>

            {/* Durability Filter */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 text-xs">Durability:</span>
              <select
                value={durabilityFilter}
                onChange={(e) => setDurabilityFilter(e.target.value)}
                className="bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-200 outline-none"
              >
                <option value="all">All Durabilities</option>
                <option value="persistent">Persistent</option>
                <option value="instance">Instance</option>
                <option value="temporary">Temporary</option>
              </select>
            </div>

            {/* TTL Filter */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 text-xs">TTL Status:</span>
              <select
                value={ttlFilter}
                onChange={(e) => setTtlFilter(e.target.value)}
                className="bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-200 outline-none"
              >
                <option value="all">All TTLs</option>
                <option value="expiring">Expiring Soon (≤ 24h)</option>
                <option value="critical">Critical (≤ 4h)</option>
                <option value="healthy">Healthy</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Export Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors text-gray-200"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              JSON
            </button>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors text-gray-200"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              CSV
            </button>
          </div>
        </div>

        {/* View Mode: ABI Table */}
        {viewMode === "abi" ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-950/70 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Durability</th>
                    <th className="py-3 px-4">Key (ABI Decoded)</th>
                    <th className="py-3 px-4">Value (ABI Decoded)</th>
                    <th className="py-3 px-4">TTL Status & Countdown</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono text-xs">
                  {filteredAbiEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-500 font-sans">
                        No storage entries match the current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredAbiEntries.map((entry) => {
                      const isExpanded = !!expandedXdr[entry.id];
                      return (
                        <tr
                          key={entry.id}
                          className="hover:bg-gray-800/40 transition-colors"
                        >
                          {/* Durability */}
                          <td className="py-3 px-4 align-top">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${
                                entry.durability === "persistent"
                                  ? "bg-purple-950/60 text-purple-300 border-purple-800/40"
                                  : entry.durability === "instance"
                                  ? "bg-blue-950/60 text-blue-300 border-blue-800/40"
                                  : "bg-amber-950/60 text-amber-300 border-amber-800/40"
                              }`}
                            >
                              {entry.durability}
                            </span>
                          </td>

                          {/* Key */}
                          <td className="py-3 px-4 align-top max-w-sm">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-cyan-300 break-all">
                                  {entry.keyDecoded.displayValue}
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[10px] bg-cyan-950/80 text-cyan-400 border border-cyan-800/40 font-mono">
                                  {entry.keyDecoded.type}
                                </span>
                              </div>

                              {/* Toggle Raw XDR */}
                              <button
                                onClick={() => toggleXdrExpand(entry.id)}
                                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                                <span>{isExpanded ? "Hide Raw XDR" : "Raw XDR"}</span>
                              </button>

                              {isExpanded && (
                                <div className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded text-[10px] text-gray-400 break-all">
                                  {entry.keyRaw}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Value */}
                          <td className="py-3 px-4 align-top max-w-md">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-emerald-300 break-all">
                                  {entry.valDecoded.displayValue}
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-mono">
                                  {entry.valDecoded.type}
                                </span>
                              </div>

                              {isExpanded && (
                                <div className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded text-[10px] text-gray-400 break-all">
                                  {entry.valRaw}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* TTL Countdown */}
                          <td className="py-3 px-4 align-top">
                            <TtlBadge ttl={entry.ttl} />
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 align-top text-right space-x-2">
                            {entry.ttl?.canBump && (
                              <button
                                onClick={() => setBumpEntry(entry)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                                  entry.ttl?.isExpiring
                                    ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm shadow-cyan-900/40"
                                    : "bg-gray-800 hover:bg-gray-700 text-cyan-300 border border-gray-700"
                                }`}
                                title="One-click Bump TTL transaction invocation"
                              >
                                <Zap className="w-3 h-3 text-cyan-400" />
                                <span>Bump TTL</span>
                              </button>
                            )}

                            <button
                              onClick={() => setDetailEntry(entry)}
                              aria-label={`Inspect ${entry.id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Inspect</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* View Mode: Tree View */
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
            <StorageSearchBar value={searchState} onChange={setSearchState} />
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 max-h-[600px] overflow-y-auto">
              <StorageTree entries={legacyTreeEntries} />
            </div>
          </div>
        )}

        {/* Time-Travel Debugger & State Diff Component */}
        <div className="pt-4 border-t border-gray-800">
          <StorageStateDiffDebugger />
        </div>
      </div>

      {/* Bump TTL Modal */}
      <BumpTtlModal
        isOpen={!!bumpEntry}
        onClose={() => setBumpEntry(null)}
        entry={bumpEntry}
        currentLedger={currentLedger}
        onSuccess={handleBumpSuccess}
      />

      {/* Entry Detail Inspector Modal */}
      <StorageEntryDetailModal
        entry={detailEntry}
        onClose={() => setDetailEntry(null)}
        onBumpClick={(entry) => setBumpEntry(entry)}
      />
    </div>
  );
}
