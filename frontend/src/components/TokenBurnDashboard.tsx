'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Flame, TrendingDown, BarChart2, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupplyStats {
  contractId: string;
  totalSupply: number;
  totalBurned: number;
  burnRate: number;
  burnedPercent: string;
  lastUpdated: string | null;
}

interface BurnEvent {
  type: string;
  from?: string;
  amount?: number;
  totalSupply?: number;
  totalBurned?: number;
  burnRate?: number;
  timestamp: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString();
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function Alert({ type, msg }: { type: 'error' | 'success'; msg: string }) {
  const isErr = type === 'error';
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
        isErr
          ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
          : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
      }`}
    >
      {isErr ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle className="w-4 h-4 shrink-0" />}
      {msg}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TokenBurnDashboard() {
  const [contractId, setContractId] = useState('');
  const [stats, setStats] = useState<SupplyStats | null>(null);
  const [history, setHistory] = useState<BurnEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  // Burn form
  const [burnFrom, setBurnFrom] = useState('');
  const [burnAmount, setBurnAmount] = useState('');

  // Init form
  const [initSupply, setInitSupply] = useState('');
  const [initRate, setInitRate] = useState('200');

  // Rate form
  const [newRate, setNewRate] = useState('');

  const notify = (type: 'error' | 'success', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const fetchStats = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/token-burn/supply/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Failed to fetch supply');
      setStats(json.data);
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Failed to fetch supply');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/token-burn/history/${id}?limit=10`);
      const json = await res.json();
      if (res.ok) setHistory(json.data?.events ?? []);
    } catch {
      // non-critical
    }
  }, []);

  const refresh = useCallback(() => {
    if (contractId) {
      fetchStats(contractId);
      fetchHistory(contractId);
    }
  }, [contractId, fetchStats, fetchHistory]);

  // Auto-refresh every 15 s when a contract is loaded
  useEffect(() => {
    if (!contractId) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [contractId, refresh]);

  async function handleInit(e: React.FormEvent) {
    e.preventDefault();
    const supply = parseInt(initSupply, 10);
    const rate = parseInt(initRate, 10);
    if (!contractId || isNaN(supply) || isNaN(rate)) {
      return notify('error', 'Fill in all init fields');
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/token-burn/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, initialSupply: supply, burnRate: rate }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Init failed');
      setStats(json.data);
      setHistory([]);
      notify('success', 'Contract initialised');
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Init failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleBurn(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseInt(burnAmount, 10);
    if (!contractId || !burnFrom || isNaN(amount) || amount <= 0) {
      return notify('error', 'Fill in all burn fields');
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/token-burn/burn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, from: burnFrom, amount }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Burn failed');
      setStats((prev) =>
        prev
          ? {
              ...prev,
              totalSupply: json.data.totalSupply,
              totalBurned: json.data.totalBurned,
              lastUpdated: json.data.burnedAt,
            }
          : prev
      );
      setBurnAmount('');
      notify('success', `Burned ${fmt(amount)} tokens`);
      fetchHistory(contractId);
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Burn failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetRate(e: React.FormEvent) {
    e.preventDefault();
    const rate = parseInt(newRate, 10);
    if (!contractId || isNaN(rate) || rate < 0 || rate > 10000) {
      return notify('error', 'Burn rate must be 0–10000 basis points');
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/token-burn/burn-rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, burnRate: rate }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Rate update failed');
      setStats((prev) => (prev ? { ...prev, burnRate: rate } : prev));
      setNewRate('');
      notify('success', `Burn rate updated to ${rate} bps (${(rate / 100).toFixed(2)}%)`);
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'Rate update failed');
    } finally {
      setLoading(false);
    }
  }

  const burnedPct = stats ? parseFloat(stats.burnedPercent) : 0;

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
            <Flame className="w-6 h-6 text-orange-500" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Token Burn</h2>
        </div>
        <button
          onClick={refresh}
          disabled={!contractId || loading}
          aria-label="Refresh supply data"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Contract ID input */}
      <div>
        <label htmlFor="contractId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Contract ID
        </label>
        <div className="flex gap-2">
          <input
            id="contractId"
            type="text"
            value={contractId}
            onChange={(e) => setContractId(e.target.value.trim())}
            placeholder="C…"
            aria-label="Stellar contract ID"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            onClick={refresh}
            disabled={!contractId || loading}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Load
          </button>
        </div>
      </div>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}

      {/* Supply stats */}
      {stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Circulating Supply"
              value={fmt(stats.totalSupply)}
              icon={<BarChart2 className="w-4 h-4" />}
              color="text-blue-500"
            />
            <StatCard
              label="Total Burned"
              value={fmt(stats.totalBurned)}
              icon={<Flame className="w-4 h-4" />}
              color="text-orange-500"
            />
            <StatCard
              label="Burn Rate"
              value={`${(stats.burnRate / 100).toFixed(2)}%`}
              sub={`${stats.burnRate} bps`}
              icon={<TrendingDown className="w-4 h-4" />}
              color="text-red-500"
            />
            <StatCard
              label="% Burned"
              value={`${burnedPct.toFixed(2)}%`}
              icon={<Flame className="w-4 h-4" />}
              color="text-purple-500"
            />
          </div>

          {/* Burn progress bar */}
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Burned</span>
              <span>{burnedPct.toFixed(2)}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={burnedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Percentage of supply burned"
              className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-red-500 transition-all duration-500"
                style={{ width: `${Math.min(burnedPct, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Action forms */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Init */}
        <form
          onSubmit={handleInit}
          aria-label="Initialise contract"
          className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3"
        >
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Initialise</h3>
          <div>
            <label htmlFor="initSupply" className="block text-xs text-slate-500 mb-1">
              Initial Supply
            </label>
            <input
              id="initSupply"
              type="number"
              min="1"
              value={initSupply}
              onChange={(e) => setInitSupply(e.target.value)}
              placeholder="1000000"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="initRate" className="block text-xs text-slate-500 mb-1">
              Burn Rate (bps)
            </label>
            <input
              id="initRate"
              type="number"
              min="0"
              max="10000"
              value={initRate}
              onChange={(e) => setInitRate(e.target.value)}
              placeholder="200"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Init Contract
          </button>
        </form>

        {/* Burn */}
        <form
          onSubmit={handleBurn}
          aria-label="Burn tokens"
          className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3"
        >
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Burn Tokens</h3>
          <div>
            <label htmlFor="burnFrom" className="block text-xs text-slate-500 mb-1">
              From Address
            </label>
            <input
              id="burnFrom"
              type="text"
              value={burnFrom}
              onChange={(e) => setBurnFrom(e.target.value.trim())}
              placeholder="G…"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="burnAmount" className="block text-xs text-slate-500 mb-1">
              Amount
            </label>
            <input
              id="burnAmount"
              type="number"
              min="1"
              value={burnAmount}
              onChange={(e) => setBurnAmount(e.target.value)}
              placeholder="1000"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !stats}
            className="w-full py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Flame className="w-4 h-4" aria-hidden="true" /> Burn
          </button>
        </form>

        {/* Set rate */}
        <form
          onSubmit={handleSetRate}
          aria-label="Update burn rate"
          className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3"
        >
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Update Burn Rate</h3>
          <div>
            <label htmlFor="newRate" className="block text-xs text-slate-500 mb-1">
              New Rate (bps, 0–10000)
            </label>
            <input
              id="newRate"
              type="number"
              min="0"
              max="10000"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder="200"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            {newRate && !isNaN(parseInt(newRate)) && (
              <p className="text-xs text-slate-400 mt-1">
                = {(parseInt(newRate) / 100).toFixed(2)}% per transfer
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !stats}
            className="w-full py-2 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <TrendingDown className="w-4 h-4" aria-hidden="true" /> Set Rate
          </button>
        </form>
      </div>

      {/* Burn history */}
      {history.length > 0 && (
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Recent Events</h3>
          <div className="overflow-hidden rounded-lg border border-slate-100 dark:border-slate-700">
            <table className="w-full text-left text-sm" aria-label="Burn event history">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th scope="col" className="p-3 font-medium text-slate-600 dark:text-slate-400">Type</th>
                  <th scope="col" className="p-3 font-medium text-slate-600 dark:text-slate-400">From</th>
                  <th scope="col" className="p-3 font-medium text-slate-600 dark:text-slate-400 text-right">Amount</th>
                  <th scope="col" className="p-3 font-medium text-slate-600 dark:text-slate-400 text-right">Supply After</th>
                  <th scope="col" className="p-3 font-medium text-slate-600 dark:text-slate-400 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {history.map((ev, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          ev.type === 'burn'
                            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                            : ev.type === 'init'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {ev.type === 'burn' && <Flame className="w-3 h-3" aria-hidden="true" />}
                        {ev.type}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                      {ev.from ? shortAddr(ev.from) : '—'}
                    </td>
                    <td className="p-3 text-right font-mono text-orange-600 dark:text-orange-400">
                      {ev.amount != null ? fmt(ev.amount) : '—'}
                    </td>
                    <td className="p-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {ev.totalSupply != null ? fmt(ev.totalSupply) : '—'}
                    </td>
                    <td className="p-3 text-right text-xs text-slate-400">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
