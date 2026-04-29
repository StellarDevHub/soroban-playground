"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState, useEffect, useCallback } from "react";
import {
  Gift,
  Store,
  TrendingUp,
  ArrowRightLeft,
  ShieldOff,
  ShieldCheck,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  Users,
  Coins,
} from "lucide-react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── Types ─────────────────────────────────────────────────────────────────────

interface Merchant {
  id: number;
  owner: string;
  name: string;
  active: boolean;
  totalIssued: string;
  registeredAt: string;
}

interface Analytics {
  totalMerchants: number;
  activeMerchants: number;
  totalPointsIssued: string;
  totalPointsRedeemed: string;
  activeUsers: number;
  paused: boolean;
  recentTransactions: Array<{
    type: string;
    timestamp: string;
    [key: string]: unknown;
  }>;
}

interface UserStats {
  address: string;
  totalEarned: string;
  totalRedeemed: string;
  lastActivity: string | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

const API = "/api/loyalty";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.message ?? "Request failed");
  return json.data as T;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accent = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: "emerald" | "amber" | "sky" | "rose";
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30",
    amber: "text-amber-400 bg-amber-500/20 border-amber-500/30",
    sky: "text-sky-400 bg-sky-500/20 border-sky-500/30",
    rose: "text-rose-400 bg-rose-500/20 border-rose-500/30",
  };
  return (
    <div className={`rounded-2xl border p-5 backdrop-blur-xl bg-slate-900/50 ${colors[accent].split(" ").slice(2).join(" ")}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${colors[accent].split(" ").slice(0, 2).join(" ")}`}>
          {icon}
        </div>
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${colors[accent].split(" ")[0]}`}>{value}</p>
    </div>
  );
}

function Alert({ msg, type }: { msg: string; type: "error" | "success" }) {
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
        type === "error"
          ? "bg-rose-500/10 border border-rose-500/30 text-rose-300"
          : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
      }`}
    >
      {type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
      {msg}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LoyaltyDashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: "error" | "success" } | null>(null);

  // Form state
  const [merchantName, setMerchantName] = useState("");
  const [earnUser, setEarnUser] = useState("");
  const [earnMerchantId, setEarnMerchantId] = useState("");
  const [earnPoints, setEarnPoints] = useState("");
  const [redeemUser, setRedeemUser] = useState("");
  const [redeemMerchantId, setRedeemMerchantId] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [lookupAddress, setLookupAddress] = useState("");
  const [userStats, setUserStats] = useState<UserStats | null>(null);

  const ADMIN = "GADMIN000000000000000000000000000000000000000000000000000";

  const notify = (msg: string, type: "error" | "success") => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 4000);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, m] = await Promise.all([
        apiFetch<Analytics>("/analytics"),
        apiFetch<Merchant[]>("/merchants"),
      ]);
      setAnalytics(a);
      setMerchants(m);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleRegisterMerchant(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/merchants", {
        method: "POST",
        body: JSON.stringify({ caller: ADMIN, name: merchantName }),
      });
      setMerchantName("");
      notify("Merchant registered!", "success");
      refresh();
    } catch (e) { notify((e as Error).message, "error"); }
  }

  async function handleEarn(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/earn", {
        method: "POST",
        body: JSON.stringify({ caller: ADMIN, user: earnUser, merchantId: Number(earnMerchantId), points: earnPoints }),
      });
      notify(`Awarded ${earnPoints} points to ${earnUser.slice(0, 8)}…`, "success");
      refresh();
    } catch (e) { notify((e as Error).message, "error"); }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/redeem", {
        method: "POST",
        body: JSON.stringify({ user: redeemUser, merchantId: Number(redeemMerchantId), points: redeemPoints }),
      });
      notify(`Redeemed ${redeemPoints} points for ${redeemUser.slice(0, 8)}…`, "success");
      refresh();
    } catch (e) { notify((e as Error).message, "error"); }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    try {
      const stats = await apiFetch<UserStats>(`/stats/${lookupAddress}`);
      setUserStats(stats);
    } catch (e) { notify((e as Error).message, "error"); }
  }

  async function handlePause() {
    try {
      await apiFetch(analytics?.paused ? "/unpause" : "/pause", {
        method: "POST",
        body: JSON.stringify({ caller: ADMIN }),
      });
      notify(analytics?.paused ? "Contract unpaused" : "Contract paused", "success");
      refresh();
    } catch (e) { notify((e as Error).message, "error"); }
  }

  // ── Chart data ───────────────────────────────────────────────────────────────

  const chartData = {
    labels: merchants.map((m) => m.name),
    datasets: [
      {
        label: "Points Issued",
        data: merchants.map((m) => Number(m.totalIssued)),
        backgroundColor: "rgba(52,211,153,0.7)",
        borderRadius: 6,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { labels: { color: "#94a3b8" } } },
    scales: {
      x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.1)" } },
      y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.1)" } },
    },
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400">
            <Gift size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Loyalty Rewards</h1>
            <p className="text-sm text-slate-400">Decentralised cross-merchant points program</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {analytics?.paused && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">
              PAUSED
            </span>
          )}
          <button
            onClick={handlePause}
            aria-label={analytics?.paused ? "Unpause contract" : "Pause contract"}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              analytics?.paused
                ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                : "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/30"
            }`}
          >
            {analytics?.paused ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
            {analytics?.paused ? "Unpause" : "Pause"}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh data"
            className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors border border-slate-700"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {feedback && <Alert msg={feedback.msg} type={feedback.type} />}

      {/* Stats */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Store size={20} />} label="Active Merchants" value={analytics.activeMerchants} accent="emerald" />
          <StatCard icon={<Coins size={20} />} label="Points Issued" value={Number(analytics.totalPointsIssued).toLocaleString()} accent="amber" />
          <StatCard icon={<ArrowRightLeft size={20} />} label="Points Redeemed" value={Number(analytics.totalPointsRedeemed).toLocaleString()} accent="sky" />
          <StatCard icon={<Users size={20} />} label="Active Users" value={analytics.activeUsers} accent="rose" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Register Merchant */}
        <section
          aria-labelledby="register-merchant-heading"
          className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-xl"
        >
          <h2 id="register-merchant-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-4">
            <Store size={18} className="text-emerald-400" /> Register Merchant
          </h2>
          <form onSubmit={handleRegisterMerchant} className="flex gap-3">
            <input
              type="text"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              placeholder="Merchant name"
              required
              aria-label="Merchant name"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Add
            </button>
          </form>

          {/* Merchant list */}
          <div className="mt-4 space-y-2 max-h-48 overflow-y-auto" role="list" aria-label="Merchant list">
            {merchants.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No merchants yet</p>
            )}
            {merchants.map((m) => (
              <div
                key={m.id}
                role="listitem"
                className="flex items-center justify-between px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700/50"
              >
                <div>
                  <span className="text-sm font-medium text-slate-200">{m.name}</span>
                  <span className="ml-2 text-xs text-slate-500">#{m.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{Number(m.totalIssued).toLocaleString()} pts</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      m.active
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-slate-700 text-slate-500"
                    }`}
                  >
                    {m.active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Points chart */}
        <section
          aria-labelledby="chart-heading"
          className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-xl"
        >
          <h2 id="chart-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-4">
            <BarChart3 size={18} className="text-amber-400" /> Points by Merchant
          </h2>
          {merchants.length > 0 ? (
            <Bar data={chartData} options={chartOptions} aria-label="Bar chart of points issued per merchant" />
          ) : (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
              No data yet
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Earn Points */}
        <section
          aria-labelledby="earn-heading"
          className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-xl"
        >
          <h2 id="earn-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-4">
            <TrendingUp size={18} className="text-emerald-400" /> Earn Points
          </h2>
          <form onSubmit={handleEarn} className="space-y-3">
            <input
              type="text"
              value={earnUser}
              onChange={(e) => setEarnUser(e.target.value)}
              placeholder="User address (56 chars)"
              required
              aria-label="User address for earning points"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex gap-3">
              <input
                type="number"
                value={earnMerchantId}
                onChange={(e) => setEarnMerchantId(e.target.value)}
                placeholder="Merchant ID"
                required
                min={1}
                aria-label="Merchant ID for earning points"
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <input
                type="number"
                value={earnPoints}
                onChange={(e) => setEarnPoints(e.target.value)}
                placeholder="Points"
                required
                min={1}
                aria-label="Points to earn"
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Award Points
            </button>
          </form>
        </section>

        {/* Redeem Points */}
        <section
          aria-labelledby="redeem-heading"
          className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-xl"
        >
          <h2 id="redeem-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-4">
            <ArrowRightLeft size={18} className="text-sky-400" /> Redeem Points
            <span className="ml-auto text-xs text-slate-500 font-normal">Cross-merchant</span>
          </h2>
          <form onSubmit={handleRedeem} className="space-y-3">
            <input
              type="text"
              value={redeemUser}
              onChange={(e) => setRedeemUser(e.target.value)}
              placeholder="User address (56 chars)"
              required
              aria-label="User address for redeeming points"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
            <div className="flex gap-3">
              <input
                type="number"
                value={redeemMerchantId}
                onChange={(e) => setRedeemMerchantId(e.target.value)}
                placeholder="Merchant ID"
                required
                min={1}
                aria-label="Merchant ID for redeeming points"
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
              <input
                type="number"
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(e.target.value)}
                placeholder="Points"
                required
                min={1}
                aria-label="Points to redeem"
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Redeem Points
            </button>
          </form>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Lookup */}
        <section
          aria-labelledby="lookup-heading"
          className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-xl"
        >
          <h2 id="lookup-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-4">
            <Users size={18} className="text-rose-400" /> User Analytics
          </h2>
          <form onSubmit={handleLookup} className="flex gap-3 mb-4">
            <input
              type="text"
              value={lookupAddress}
              onChange={(e) => setLookupAddress(e.target.value)}
              placeholder="User address (56 chars)"
              required
              aria-label="User address to look up"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Lookup
            </button>
          </form>
          {userStats && (
            <dl className="space-y-2">
              {[
                { label: "Total Earned", value: Number(userStats.totalEarned).toLocaleString() + " pts" },
                { label: "Total Redeemed", value: Number(userStats.totalRedeemed).toLocaleString() + " pts" },
                { label: "Net Balance", value: (Number(userStats.totalEarned) - Number(userStats.totalRedeemed)).toLocaleString() + " pts" },
                { label: "Last Activity", value: userStats.lastActivity ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center px-4 py-2 bg-slate-800/60 rounded-xl">
                  <dt className="text-sm text-slate-400">{label}</dt>
                  <dd className="text-sm font-medium text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* Recent Transactions */}
        <section
          aria-labelledby="txns-heading"
          className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-xl"
        >
          <h2 id="txns-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-4">
            <BarChart3 size={18} className="text-amber-400" /> Recent Activity
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto" role="log" aria-label="Recent transactions">
            {analytics?.recentTransactions.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No activity yet</p>
            )}
            {analytics?.recentTransactions.map((tx, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700/50"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      tx.type === "points_earned"
                        ? "bg-emerald-400"
                        : tx.type === "points_redeemed"
                        ? "bg-sky-400"
                        : "bg-amber-400"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-300 capitalize">{tx.type.replace(/_/g, " ")}</span>
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(tx.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
