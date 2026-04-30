'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, CheckCircle2, XCircle, Loader2, Search } from 'lucide-react';

interface NotaryRecord {
  fileHash: string;
  owner: string;
  timestamp: number;
  metadata: string;
  verified: boolean;
  recordId: number;
}

interface HistoryResponse {
  records: NotaryRecord[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

function truncate(str: string, len = 16): string {
  return str.length > len ? `${str.slice(0, len)}…` : str;
}

export default function NotaryDashboard() {
  const [records, setRecords] = useState<NotaryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const loaderRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (pageNum: number, reset = false) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/notary/history?page=${pageNum}&limit=${PAGE_SIZE}`
        );
        const json: { success: boolean; data: HistoryResponse } = await res.json();
        if (!res.ok) return;
        const { records: newRecords, total: newTotal } = json.data;
        setRecords((prev) => (reset ? newRecords : [...prev, ...newRecords]));
        setTotal(newTotal);
        setHasMore(pageNum * PAGE_SIZE < newTotal);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Initial load
  useEffect(() => {
    fetchPage(1, true);
  }, [fetchPage]);

  // Infinite scroll observer
  useEffect(() => {
    if (!loaderRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const next = page + 1;
          setPage(next);
          fetchPage(next);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, page, fetchPage]);

  // Client-side filter
  const filtered = records.filter((r) => {
    if (search && !r.fileHash.includes(search) && !r.owner.includes(search)) {
      return false;
    }
    if (dateFrom && r.timestamp < new Date(dateFrom).getTime() / 1000) return false;
    if (dateTo && r.timestamp > new Date(dateTo).getTime() / 1000) return false;
    return true;
  });

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
          <Shield className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Notary Dashboard</h2>
          <p className="text-sm text-slate-500">{total} total records</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by hash or owner…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Search by file hash or owner"
          />
        </div>
        <div>
          <label htmlFor="date-from" className="sr-only">From date</label>
          <input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Filter from date"
          />
        </div>
        <div>
          <label htmlFor="date-to" className="sr-only">To date</label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Filter to date"
          />
        </div>
      </div>

      {/* Records grid */}
      {filtered.length === 0 && !loading ? (
        <p className="text-center text-slate-500 py-8">No records found.</p>
      ) : (
        <div className="grid gap-3" role="list" aria-label="Notarization records">
          {filtered.map((r) => (
            <div
              key={r.fileHash}
              role="listitem"
              className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700"
            >
              <div className="min-w-0">
                <p className="font-mono text-sm text-slate-900 dark:text-white truncate" title={r.fileHash}>
                  {truncate(r.fileHash, 24)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(r.timestamp * 1000).toLocaleString()} · {truncate(r.owner, 12)}
                </p>
                {r.metadata && (
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{r.metadata}</p>
                )}
              </div>
              <div className="ml-4 shrink-0">
                {r.verified ? (
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-semibold">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    Verified
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500 text-xs font-semibold">
                    <XCircle className="w-4 h-4" aria-hidden="true" />
                    Revoked
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={loaderRef} className="mt-4 flex justify-center" aria-live="polite">
        {loading && (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-label="Loading more records" />
        )}
        {!hasMore && records.length > 0 && (
          <p className="text-xs text-slate-400">All records loaded.</p>
        )}
      </div>
    </div>
  );
}
