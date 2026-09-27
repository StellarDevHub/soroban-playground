"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Layers,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Strategy {
  id: number;
  name: string;
  apyBps: number;
  totalDeposited: number;
  isActive: boolean;
  lastCompoundTs: number;
}

export interface Position {
  deposited: number;
  compoundedBalance: number;
  lastUpdateTs: number;
}

export interface BacktestResult {
  strategyId: number;
  initialAmount: number;
  finalAmount: number;
  gain: number;
  effectiveApyBps: number;
  durationSecs: number;
}

export interface AllocationEntry {
  strategyId: number;
  weightBps: number;
}

// ── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://soroban-playground.onrender.com")
).replace(/\/$/, "");

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

async function apiPatch(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

async function apiGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function bpsToPercent(bps: number) {
  return (bps / 100).toFixed(2) + "%";
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
      <div className="text-indigo-400">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-lg font-bold text-white">{value}</p>
      </div>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p
      className="text-xs text-red-400 mt-1 flex items-center gap-1"
      role="alert"
    >
      <AlertTriangle size={12} /> {msg}
    </p>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-semibold text-gray-200 border-b border-gray-700 pb-1 mb-3">
      {title}
    </h3>
  );
}

// ── Panel props ───────────────────────────────────────────────────────────────

export interface YieldOptimizerPanelProps {
  contractId: string;
  walletAddress?: string;
  network?: string;
}

type Tab = "strategies" | "position" | "allocate" | "backtest";

// ── Main panel ────────────────────────────────────────────────────────────────

export default function YieldOptimizerPanel({
  contractId,
  walletAddress = "",
  network = "testnet",
}: YieldOptimizerPanelProps) {
  const [tab, setTab] = useState<Tab>("strategies");
  const [paused, setPaused] = useState(false);
  const [strategyCount, setStrategyCount] = useState(0);
  const [bestId, setBestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshStats = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const params = { contractId, network };
      const [status, best] = await Promise.all([
        apiGet("/api/yield-optimizer/status", params),
        apiGet("/api/yield-optimizer/best-strategy", params).catch(() => ({
          strategyId: null,
        })),
      ]);
      setPaused(status.paused ?? false);
      setStrategyCount(status.strategyCount ?? 0);
      setBestId(best.strategyId ?? null);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [contractId, network, showToast]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  async function togglePause() {
    if (!walletAddress) return showToast("Wallet address required", false);
    try {
      await apiPost(`/api/yield-optimizer/${paused ? "unpause" : "pause"}`, {
        contractId,
        admin: walletAddress,
        network,
      });
      showToast(paused ? "Unpaused" : "Paused");
      await refreshStats();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "strategies", label: "Strategies" },
    { id: "position", label: "Position" },
    { id: "allocate", label: "Allocate" },
    { id: "backtest", label: "Backtest" },
  ];

  return (
    <div className="space-y-4">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
            toast.ok
              ? "bg-green-900/60 text-green-300 border border-green-700"
              : "bg-red-900/60 text-red-300 border border-red-700"
          }`}
        >
          {toast.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {toast.msg}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Strategies"
          value={strategyCount}
          icon={<Layers size={18} />}
        />
        <StatCard
          label="Best Strategy"
          value={bestId ? `#${bestId}` : "—"}
          icon={<TrendingUp size={18} />}
        />
        <StatCard
          label="Status"
          value={paused ? "Paused" : "Active"}
          icon={
            paused ? (
              <PauseCircle size={18} className="text-yellow-400" />
            ) : (
              <PlayCircle size={18} className="text-green-400" />
            )
          }
        />
        <StatCard label="Network" value={network} icon={<Zap size={18} />} />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={refreshStats}
          disabled={loading}
          aria-label="Refresh"
          className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        {walletAddress && (
          <button
            onClick={togglePause}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              paused
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-yellow-700 hover:bg-yellow-600 text-white"
            }`}
          >
            {paused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
            {paused ? "Unpause" : "Pause"}
          </button>
        )}
      </div>

      <div className="flex border-b border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-indigo-500 text-indigo-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "strategies" && (
        <StrategiesTab
          contractId={contractId}
          walletAddress={walletAddress}
          network={network}
          showToast={showToast}
          onRefresh={refreshStats}
        />
      )}
      {tab === "position" && (
        <PositionTab
          contractId={contractId}
          walletAddress={walletAddress}
          network={network}
          showToast={showToast}
        />
      )}
      {tab === "allocate" && (
        <AllocateTab
          contractId={contractId}
          walletAddress={walletAddress}
          network={network}
          showToast={showToast}
        />
      )}
      {tab === "backtest" && (
        <BacktestTab
          contractId={contractId}
          network={network}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── Shared tab props ──────────────────────────────────────────────────────────

interface TabProps {
  contractId: string;
  walletAddress: string;
  network: string;
  showToast: (msg: string, ok?: boolean) => void;
  onRefresh?: () => void;
}

// ── StrategiesTab ─────────────────────────────────────────────────────────────

function StrategiesTab({
  contractId,
  walletAddress,
  network,
  showToast,
  onRefresh,
}: TabProps) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [form, setForm] = useState({ name: "", apyBps: "1000" });
  const [formErr, setFormErr] = useState<Partial<typeof form>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchStrategy = useCallback(async () => {
    const id = Number(lookupId);
    if (!id) return showToast("Enter a valid strategy ID", false);
    setLoading(true);
    try {
      const data = await apiGet(`/api/yield-optimizer/strategies/${id}`, {
        contractId,
        network,
      });
      setStrategies([{ id, ...data.strategy }]);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [lookupId, contractId, network, showToast]);

  function validate() {
    const errs: Partial<typeof form> = {};
    if (!form.name.trim()) errs.name = "Required";
    const a = Number(form.apyBps);
    if (isNaN(a) || a < 0 || a > 50000) errs.apyBps = "Must be 0–50000";
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  }

  async function addStrategy(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !walletAddress) {
      if (!walletAddress) showToast("Wallet address required", false);
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiPost("/api/yield-optimizer/strategies", {
        contractId,
        admin: walletAddress,
        name: form.name.trim(),
        apyBps: Number(form.apyBps),
        network,
      });
      showToast(`Strategy added (ID: ${data.strategyId})`);
      setForm((f) => ({ ...f, name: "" }));
      onRefresh?.();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(s: Strategy) {
    if (!walletAddress) return showToast("Wallet address required", false);
    try {
      await apiPatch(`/api/yield-optimizer/strategies/${s.id}/active`, {
        contractId,
        admin: walletAddress,
        active: !s.isActive,
        network,
      });
      showToast(s.isActive ? "Strategy paused" : "Strategy activated");
      setStrategies((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, isActive: !x.isActive } : x)),
      );
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Add Strategy" />
        <form onSubmit={addStrategy} className="space-y-3" noValidate>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1"
              htmlFor="strat-name"
            >
              Strategy Name
            </label>
            <input
              id="strat-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. USDC Lending Pool"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {formErr.name && <ErrorMsg msg={formErr.name} />}
          </div>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1"
              htmlFor="strat-apy"
            >
              APY (basis points, e.g. 1000 = 10%)
            </label>
            <input
              id="strat-apy"
              type="number"
              min={0}
              max={50000}
              value={form.apyBps}
              onChange={(e) =>
                setForm((f) => ({ ...f, apyBps: e.target.value }))
              }
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            {formErr.apyBps && <ErrorMsg msg={formErr.apyBps} />}
            {form.apyBps && !formErr.apyBps && (
              <p className="text-xs text-gray-500 mt-0.5">
                = {bpsToPercent(Number(form.apyBps))} APY
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <Plus size={14} /> {submitting ? "Adding…" : "Add Strategy"}
          </button>
        </form>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Look Up Strategy" />
        <div className="flex gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Strategy ID"
            type="number"
            min={1}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={fetchStrategy}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              "Fetch"
            )}
          </button>
        </div>
      </div>

      {strategies.length > 0 && (
        <div className="space-y-2">
          {strategies.map((s) => (
            <div
              key={s.id}
              className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-start justify-between gap-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-white">
                  #{s.id} — {s.name}
                </p>
                <p className="text-xs text-indigo-300 font-medium">
                  APY: {bpsToPercent(s.apyBps)}
                </p>
                <p className="text-xs text-gray-400">
                  TVL: {s.totalDeposited?.toLocaleString()} stroops
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.isActive ? "bg-green-900/40 text-green-300 border border-green-700" : "bg-red-900/40 text-red-300 border border-red-700"}`}
                >
                  {s.isActive ? "Active" : "Paused"}
                </span>
                {walletAddress && (
                  <button
                    onClick={() => toggleActive(s)}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    {s.isActive ? "Pause" : "Activate"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PositionTab ───────────────────────────────────────────────────────────────

function PositionTab({
  contractId,
  walletAddress,
  network,
  showToast,
}: TabProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [strategyId, setStrategyId] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<
    "deposit" | "withdraw" | "compound" | null
  >(null);

  async function fetchPosition() {
    const sid = Number(strategyId);
    if (!sid || !walletAddress)
      return showToast("Strategy ID and wallet required", false);
    setLoading(true);
    try {
      const data = await apiGet("/api/yield-optimizer/position", {
        contractId,
        user: walletAddress,
        strategyId: String(sid),
        network,
      });
      setPosition(data.position);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }

  async function deposit() {
    const sid = Number(strategyId);
    const amt = Number(amount);
    if (!sid || !amt || !walletAddress)
      return showToast("Fill all fields", false);
    setSubmitting("deposit");
    try {
      await apiPost("/api/yield-optimizer/deposit", {
        contractId,
        user: walletAddress,
        strategyId: sid,
        amount: amt,
        network,
      });
      showToast("Deposited successfully");
      await fetchPosition();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(null);
    }
  }

  async function withdraw() {
    const sid = Number(strategyId);
    const amt = Number(amount);
    if (!sid || !amt || !walletAddress)
      return showToast("Fill all fields", false);
    setSubmitting("withdraw");
    try {
      await apiPost("/api/yield-optimizer/withdraw", {
        contractId,
        user: walletAddress,
        strategyId: sid,
        amount: amt,
        network,
      });
      showToast("Withdrawn successfully");
      await fetchPosition();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(null);
    }
  }

  async function compound() {
    const sid = Number(strategyId);
    if (!sid || !walletAddress)
      return showToast("Strategy ID and wallet required", false);
    setSubmitting("compound");
    try {
      const data = await apiPost("/api/yield-optimizer/compound", {
        contractId,
        user: walletAddress,
        strategyId: sid,
        network,
      });
      showToast(
        `Compounded — new balance: ${data.newBalance?.toLocaleString()}`,
      );
      await fetchPosition();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
        <SectionHeader title="My Position" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className="block text-xs text-gray-400 mb-1"
              htmlFor="pos-sid"
            >
              Strategy ID
            </label>
            <input
              id="pos-sid"
              type="number"
              min={1}
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1"
              htmlFor="pos-amt"
            >
              Amount (stroops)
            </label>
            <input
              id="pos-amt"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={fetchPosition}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw size={12} className="animate-spin inline" />
            ) : (
              "Fetch Position"
            )}
          </button>
          <button
            onClick={deposit}
            disabled={submitting === "deposit"}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            {submitting === "deposit" ? "Depositing…" : "Deposit"}
          </button>
          <button
            onClick={withdraw}
            disabled={submitting === "withdraw"}
            className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            {submitting === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
          <button
            onClick={compound}
            disabled={submitting === "compound"}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            <Zap size={12} />{" "}
            {submitting === "compound" ? "Compounding…" : "Compound"}
          </button>
        </div>
      </div>

      {position && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
          <SectionHeader title="Position Details" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-700/50 rounded p-2">
              <p className="text-xs text-gray-400">Deposited</p>
              <p className="text-sm font-bold text-white">
                {position.deposited?.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-700/50 rounded p-2">
              <p className="text-xs text-gray-400">Compounded Balance</p>
              <p className="text-sm font-bold text-green-300">
                {position.compoundedBalance?.toLocaleString()}
              </p>
            </div>
          </div>
          {position.compoundedBalance > position.deposited && (
            <p className="text-xs text-green-400">
              +
              {(
                position.compoundedBalance - position.deposited
              ).toLocaleString()}{" "}
              rewards accrued
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── AllocateTab ───────────────────────────────────────────────────────────────

function AllocateTab({ contractId, network, showToast }: TabProps) {
  const [totalAmount, setTotalAmount] = useState("");
  const [rows, setRows] = useState<AllocationEntry[]>([
    { strategyId: 1, weightBps: 5000 },
    { strategyId: 2, weightBps: 5000 },
  ]);
  const [result, setResult] = useState<number[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const weightSum = rows.reduce((s, r) => s + r.weightBps, 0);

  function updateRow(i: number, field: keyof AllocationEntry, val: number) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, { strategyId: prev.length + 1, weightBps: 0 }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function allocate(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(totalAmount);
    if (!amt || amt <= 0) return showToast("Total amount must be > 0", false);
    if (weightSum !== 10000)
      return showToast("Weights must sum to 10 000 bps (100%)", false);
    setSubmitting(true);
    try {
      const data = await apiPost("/api/yield-optimizer/allocate", {
        contractId,
        allocations: rows.map((r) => ({
          strategyId: r.strategyId,
          weightBps: r.weightBps,
        })),
        totalAmount: amt,
        network,
      });
      setResult(data.amounts);
      showToast("Allocation calculated");
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Portfolio Allocation" />
        <form onSubmit={allocate} className="space-y-3" noValidate>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1"
              htmlFor="alloc-total"
            >
              Total Amount (stroops)
            </label>
            <input
              id="alloc-total"
              type="number"
              min={1}
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">Allocations</p>
              <span
                className={`text-xs font-medium ${weightSum === 10000 ? "text-green-400" : "text-yellow-400"}`}
              >
                {weightSum} / 10 000 bps
              </span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="number"
                  min={1}
                  value={r.strategyId}
                  onChange={(e) =>
                    updateRow(i, "strategyId", Number(e.target.value))
                  }
                  placeholder="Strategy ID"
                  aria-label={`Strategy ID for row ${i + 1}`}
                  className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={r.weightBps}
                  onChange={(e) =>
                    updateRow(i, "weightBps", Number(e.target.value))
                  }
                  placeholder="Weight bps"
                  aria-label={`Weight bps for row ${i + 1}`}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-xs text-gray-400 w-12 text-right">
                  {bpsToPercent(r.weightBps)}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-red-400 hover:text-red-300 text-xs"
                  aria-label="Remove row"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <Plus size={12} /> Add strategy
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting || weightSum !== 10000}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <BarChart2 size={14} />{" "}
            {submitting ? "Calculating…" : "Calculate Allocation"}
          </button>
        </form>
      </div>

      {result && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <SectionHeader title="Allocation Result" />
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex justify-between items-center text-sm"
              >
                <span className="text-gray-300">
                  Strategy #{r.strategyId} ({bpsToPercent(r.weightBps)})
                </span>
                <span className="font-medium text-white">
                  {result[i]?.toLocaleString()} stroops
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BacktestTab ───────────────────────────────────────────────────────────────

function BacktestTab({
  contractId,
  network,
  showToast,
}: Omit<TabProps, "walletAddress">) {
  const [form, setForm] = useState({
    strategyId: "1",
    initialAmount: "1000000",
    durationDays: "365",
  });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runBacktest(e: React.FormEvent) {
    e.preventDefault();
    const sid = Number(form.strategyId);
    const amt = Number(form.initialAmount);
    const dur = Number(form.durationDays) * 86400;
    if (!sid || !amt || !dur) return showToast("Fill all fields", false);
    setLoading(true);
    try {
      const data = await apiGet("/api/yield-optimizer/backtest", {
        contractId,
        strategyId: String(sid),
        initialAmount: String(amt),
        durationSecs: String(dur),
        network,
      });
      setResult(data.result);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Strategy Backtest Simulation" />
        <form onSubmit={runBacktest} className="space-y-3" noValidate>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                className="block text-xs text-gray-400 mb-1"
                htmlFor="bt-sid"
              >
                Strategy ID
              </label>
              <input
                id="bt-sid"
                type="number"
                min={1}
                value={form.strategyId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, strategyId: e.target.value }))
                }
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label
                className="block text-xs text-gray-400 mb-1"
                htmlFor="bt-amt"
              >
                Initial Amount
              </label>
              <input
                id="bt-amt"
                type="number"
                min={1}
                value={form.initialAmount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, initialAmount: e.target.value }))
                }
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label
                className="block text-xs text-gray-400 mb-1"
                htmlFor="bt-dur"
              >
                Duration (days)
              </label>
              <input
                id="bt-dur"
                type="number"
                min={1}
                value={form.durationDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, durationDays: e.target.value }))
                }
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <TrendingUp size={14} /> {loading ? "Running…" : "Run Backtest"}
          </button>
        </form>
      </div>

      {result && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-4">
          <SectionHeader title="Backtest Results & APY Trajectory" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-700/50 rounded p-2">
              <p className="text-xs text-gray-400">Initial Amount</p>
              <p className="text-sm font-bold text-white">
                {result.initialAmount?.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-700/50 rounded p-2">
              <p className="text-xs text-gray-400">Final Amount</p>
              <p className="text-sm font-bold text-green-300">
                {result.finalAmount?.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-700/50 rounded p-2">
              <p className="text-xs text-gray-400">Net Gain</p>
              <p className="text-sm font-bold text-green-400">
                +{result.gain?.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-700/50 rounded p-2">
              <p className="text-xs text-gray-400">Effective APY</p>
              <p className="text-sm font-bold text-indigo-300">
                {bpsToPercent(result.effectiveApyBps)}
              </p>
            </div>
          </div>

          {/* Growth Curve Visualizer */}
          <div className="p-3 bg-slate-900 rounded border border-slate-700 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-200">Compound Yield Trajectory</span>
              <span className="text-indigo-400 font-mono text-[11px]">Daily Auto-Compound</span>
            </div>
            <div className="h-24 flex items-end gap-1.5 pt-4 pb-1 border-b border-slate-700 px-2">
              {[20, 28, 38, 50, 65, 82, 100].map((h, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
                  <div
                    className="w-full bg-gradient-to-t from-indigo-600 to-cyan-400 rounded-t transition-all group-hover:brightness-125"
                    style={{ height: `${h}%` }}
                  />
                  <span className="text-[9px] text-slate-400 font-mono">M{idx + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Duration: {Math.round(result.durationSecs / 86400)} days
          </p>
        </div>
      )}
    </div>
  );
}
