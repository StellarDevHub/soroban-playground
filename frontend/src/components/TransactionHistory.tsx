"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  History,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Layers,
  ArrowRight,
  Filter,
  Search,
  Database,
  RefreshCw,
  Clock,
} from "lucide-react";
import {
  parseTransactionMeta,
  TransactionLedgerDiff,
  LedgerKeyDiff,
  LedgerChangeType,
} from "@/lib/stellar/transactionMetaParser";

export interface TransactionItem {
  id: string;
  hash: string;
  status: "success" | "error" | "pending";
  timestamp: number;
  ledger?: number;
  label?: string;
  metaXdr?: string | unknown;
  parsedDiff?: TransactionLedgerDiff;
}

export interface TransactionHistoryProps {
  transactions: TransactionItem[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  className?: string;
  explorerBaseUrl?: string;
}

export default function TransactionHistory({
  transactions,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  className = "",
  explorerBaseUrl = "https://stellar.expert/explorer/testnet/tx",
}: TransactionHistoryProps) {
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | LedgerChangeType>("all");
  const [searchKey, setSearchKey] = useState("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const loadMoreObserverRef = useRef<HTMLDivElement>(null);

  // Parse transaction diffs memoized
  const parsedTransactions = useMemo(() => {
    return transactions.map((tx) => {
      if (tx.parsedDiff) return tx;
      const parsed = parseTransactionMeta(tx.metaXdr || {}, tx.hash, tx.timestamp);
      return {
        ...tx,
        parsedDiff: parsed,
      };
    });
  }, [transactions]);

  // Infinite scroll intersection observer
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const el = loadMoreObserverRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
    };
  }, [onLoadMore, hasMore, isLoadingMore]);

  const copyToClipboard = (text: string, hash: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  const getFilteredChanges = useCallback(
    (changes: LedgerKeyDiff[]) => {
      return changes.filter((c) => {
        if (filterType !== "all" && c.changeType !== filterType) return false;
        if (searchKey.trim()) {
          const q = searchKey.toLowerCase();
          return (
            c.key.toLowerCase().includes(q) ||
            (c.contractId && c.contractId.toLowerCase().includes(q))
          );
        }
        return true;
      });
    },
    [filterType, searchKey]
  );

  return (
    <div
      data-testid="transaction-history-container"
      className={`rounded-2xl border border-white/10 bg-slate-900/40 p-6 flex flex-col gap-6 backdrop-blur-xl ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
            <History size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Transaction History & Ledger Inspector
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Inspect on-chain transactions with exact Before & After storage state differentials.
            </p>
          </div>
        </div>

        {/* Filter / Search Controls */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="text"
              data-testid="state-diff-search-input"
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              placeholder="Search storage keys..."
              className="bg-slate-950/80 rounded-xl border border-white/10 pl-9 pr-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-violet-500 transition"
            />
          </div>

          <div className="flex items-center rounded-xl bg-slate-950/60 p-1 border border-white/10 text-xs font-semibold">
            {(["all", "created", "modified", "deleted"] as const).map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`filter-btn-${t}`}
                onClick={() => setFilterType(t)}
                className={`px-2.5 py-1 rounded-lg capitalize transition ${
                  filterType === t
                    ? "bg-violet-600 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transaction Feed */}
      {parsedTransactions.length === 0 ? (
        <div
          data-testid="empty-tx-history"
          className="text-center py-16 text-slate-500 space-y-2"
        >
          <Database size={32} className="mx-auto opacity-40" />
          <p className="text-sm font-medium">No recorded transactions found</p>
          <p className="text-xs">
            Deploy or invoke a contract to record state-changing transactions.
          </p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="transaction-list">
          {parsedTransactions.map((tx) => {
            const isExpanded = expandedTxId === tx.id;
            const diff = tx.parsedDiff;
            const changes = diff?.changes || [];
            const filteredChanges = getFilteredChanges(changes);

            const createdCount = changes.filter((c) => c.changeType === "created").length;
            const modifiedCount = changes.filter((c) => c.changeType === "modified").length;
            const deletedCount = changes.filter((c) => c.changeType === "deleted").length;

            return (
              <div
                key={tx.id}
                data-testid={`tx-card-${tx.id}`}
                className={`rounded-2xl border transition-all duration-200 ${
                  isExpanded
                    ? "bg-slate-900/80 border-violet-500/30 shadow-lg shadow-violet-950/10"
                    : "bg-slate-950/40 border-white/5 hover:border-white/10"
                }`}
              >
                {/* Transaction Summary Card */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setExpandedTxId(isExpanded ? null : tx.id);
                    }
                  }}
                  onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                  className="p-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-xl border ${
                        tx.status === "success"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                      }`}
                    >
                      {tx.status === "success" ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <AlertCircle size={18} />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">
                          {tx.label || "Contract Invocation"}
                        </span>
                        {tx.ledger && (
                          <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-white/5">
                            Ledger #{tx.ledger}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                        <span>{tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}</span>
                        <button
                          type="button"
                          aria-label="Copy transaction hash"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(tx.hash, tx.hash);
                          }}
                          className="hover:text-white transition"
                        >
                          {copiedHash === tx.hash ? (
                            <Check size={12} className="text-emerald-400" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                        <a
                          href={`${explorerBaseUrl}/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-white transition text-slate-500"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Right side stats & expand toggle */}
                  <div className="flex items-center gap-4">
                    {/* State Mutations Badge */}
                    <div
                      data-testid="mutation-summary-badge"
                      className="flex items-center gap-2 text-xs font-semibold"
                    >
                      {changes.length === 0 ? (
                        <span className="text-slate-500 text-[11px]">
                          No state mutations
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {createdCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                              +{createdCount} created
                            </span>
                          )}
                          {modifiedCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px]">
                              ~{modifiedCount} modified
                            </span>
                          )}
                          {deletedCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
                              -{deletedCount} deleted
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-slate-500 text-xs">
                      <Clock size={12} />
                      <span>{new Date(tx.timestamp).toLocaleTimeString()}</span>
                    </div>

                    {isExpanded ? (
                      <ChevronUp size={18} className="text-slate-400" />
                    ) : (
                      <ChevronDown size={18} className="text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Side-by-Side State Diff View */}
                {isExpanded && (
                  <div
                    data-testid="state-diff-viewer"
                    className="border-t border-white/5 p-5 space-y-4 animate-in fade-in duration-200"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
                      <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px] text-slate-500">
                        <Layers size={12} className="text-violet-400" />
                        Ledger Key State Mutations ({filteredChanges.length})
                      </span>
                    </div>

                    {filteredChanges.length === 0 ? (
                      <p className="text-xs text-slate-500 italic py-4 text-center">
                        No storage changes match current filter.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {filteredChanges.map((change, idx) => (
                          <div
                            key={idx}
                            data-testid={`diff-entry-${change.changeType}`}
                            className="rounded-xl border border-white/5 bg-slate-950/70 p-4 space-y-3"
                          >
                            {/* Key Header */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                    change.changeType === "created"
                                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                      : change.changeType === "modified"
                                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                                      : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                                  }`}
                                >
                                  {change.changeType}
                                </span>
                                <code className="text-xs font-mono text-slate-200 break-all">
                                  {change.key}
                                </code>
                              </div>

                              {change.durability && (
                                <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-white/5">
                                  {change.durability}
                                </span>
                              )}
                            </div>

                            {/* Side-by-Side Before / After Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Before Panel */}
                              <div className="space-y-1">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                                  <span>Before Execution</span>
                                  {change.before === null && (
                                    <span className="text-emerald-400 font-normal">
                                      (Non-existent)
                                    </span>
                                  )}
                                </div>
                                <div
                                  data-testid="diff-before-panel"
                                  className={`rounded-lg p-3 text-xs font-mono max-h-48 overflow-y-auto border ${
                                    change.before === null
                                      ? "bg-slate-950 text-slate-500 border-dashed border-white/10 italic"
                                      : "bg-slate-950 text-rose-300 border-rose-500/20"
                                  }`}
                                >
                                  {change.before === null ? (
                                    <span>[None - Newly Created Entry]</span>
                                  ) : (
                                    <pre className="whitespace-pre-wrap">
                                      {JSON.stringify(change.before, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              </div>

                              {/* After Panel */}
                              <div className="space-y-1">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                                  <span>After Execution</span>
                                  {change.after === null && (
                                    <span className="text-rose-400 font-normal">
                                      (Deleted)
                                    </span>
                                  )}
                                </div>
                                <div
                                  data-testid="diff-after-panel"
                                  className={`rounded-lg p-3 text-xs font-mono max-h-48 overflow-y-auto border ${
                                    change.after === null
                                      ? "bg-slate-950 text-slate-500 border-dashed border-white/10 italic"
                                      : "bg-slate-950 text-emerald-300 border-emerald-500/20"
                                  }`}
                                >
                                  {change.after === null ? (
                                    <span>[None - Deleted Entry]</span>
                                  ) : (
                                    <pre className="whitespace-pre-wrap">
                                      {JSON.stringify(change.after, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Virtualized Infinite Scroll Sentinel */}
          <div ref={loadMoreObserverRef} className="py-2 flex justify-center">
            {isLoadingMore && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <RefreshCw size={14} className="animate-spin text-violet-400" />
                <span>Loading more ledger transactions...</span>
              </div>
            )}
            {!hasMore && transactions.length > 0 && (
              <span className="text-[11px] text-slate-600">
                End of transaction ledger feed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
