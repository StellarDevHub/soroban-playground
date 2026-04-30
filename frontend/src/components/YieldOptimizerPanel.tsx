"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Coins,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  TrendingUp,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Protocol {
  id: number;
  name: string;
  baseApyBps: number;
  isActive: boolean;
}

export interface Vault {
  id: number;
  name: string;
  protocolId: number;
  currentApyBps: number;
  totalDeposited: number;
  pendingRewards: number;
  totalCompounded: number;
  lastCompoundTs: number;
  isActive: boolean;
}

export interface UserPosition {
  deposited: number;
  compoundedBalance: number;
  lastUpdateTs: number;
}

export interface BacktestEntry {
  vaultId: number;
  apyBps: number;
  tvl: number;
  timestamp: number;
}

// ── API ───────────────────────────────────────────────────────────────────────

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function bpsToPercent(bps: number) { return (bps / 100).toFixed(2) + "%"; }
function stroopsToXlm(s: number) { return (s / 1_000_000).toFixed(4); }

// ── Shared UI ─────────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{msg}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-red-400 hover:text-red-600">✕</button>
    </div>
  );
}

function SuccessBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div role="status" className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm">
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{msg}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-green-400 hover:text-green-600">✕</button>
    </div>
  );
}

// ── VaultCard ─────────────────────────────────────────────────────────────────

function VaultCard({ vault, selected, onSelect }: { vault: Vault; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-left p-4 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        selected
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
          : "border-slate-200 dark:border-slate-700 hover:border-indigo-300 bg-white dark:bg-slate-800/50"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-slate-900 dark:text-white truncate">{vault.name}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${vault.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-slate-100 text-slate-500"}`}>
          {vault.isActive ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1">
        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{bpsToPercent(vault.currentApyBps)} APY</span>
        <span>TVL: {stroopsToXlm(vault.totalDeposited)} XLM</span>
      </div>
      {vault.totalCompounded > 0 && (
        <div className="text-xs text-indigo-500 dark:text-indigo-400 mt-1 flex items-center gap-1">
          <Zap className="w-3 h-3" />Compounded: {stroopsToXlm(vault.totalCompounded)} XLM
        </div>
      )}
    </button>
  );
}

// ── PositionPanel ─────────────────────────────────────────────────────────────

function PositionPanel({ vault, contractId, userAddress, onRefresh }: {
  vault: Vault; contractId: string; userAddress: string; onRefresh: () => void;
}) {
  const [amount, setAmount] = useState("1000000");
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [estimated, setEstimated] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const loadPosition = useCallback(async () => {
    if (!userAddress || !contractId) return;
    try {
      const [pd, ed] = await Promise.all([
        apiGet(`/api/yield-optimizer/vaults/${vault.id}/position/${userAddress}`, { contractId }),
        apiGet(`/api/yield-optimizer/vaults/${vault.id}/estimated/${userAddress}`, { contractId }),
      ]);
      setPosition(pd.position);
      setEstimated(ed.estimatedBalance);
    } catch { setPosition(null); setEstimated(null); }
  }, [vault.id, contractId, userAddress]);

  useEffect(() => { loadPosition(); }, [loadPosition]);

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setOk("");
    const n = parseInt(amount, 10);
    if (isNaN(n) || n <= 0) return setErr("Amount must be positive");
    setLoading(true);
    try {
      const d = await apiPost(`/api/yield-optimizer/vaults/${vault.id}/deposit`, { contractId, user: userAddress, amount: n });
      setOk(`Deposited. Balance: ${stroopsToXlm(d.compoundedBalance)} XLM`);
      onRefresh(); loadPosition();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Deposit failed"); }
    finally { setLoading(false); }
  }

  async function handleWithdraw() {
    setErr(""); setOk("");
    const n = parseInt(amount, 10);
    if (isNaN(n) || n <= 0) return setErr("Amount must be positive");
    setLoading(true);
    try {
      const d = await apiPost(`/api/yield-optimizer/vaults/${vault.id}/withdraw`, { contractId, user: userAddress, amount: n });
      setOk(`Withdrew ${stroopsToXlm(d.withdrawn)} XLM`);
      onRefresh(); loadPosition();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Withdraw failed"); }
    finally { setLoading(false); }
  }

  async function handleCompound() {
    setErr(""); setOk("");
    setLoading(true);
    try {
      const d = await apiPost(`/api/yield-optimizer/vaults/${vault.id}/compound`, { contractId });
      setOk(`Compounded ${stroopsToXlm(d.rewardsCompounded)} XLM in rewards`);
      onRefresh(); loadPosition();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Compound failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {err && <ErrorBanner msg={err} onDismiss={() => setErr("")} />}
      {ok && <SuccessBanner msg={ok} onDismiss={() => setOk("")} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Deposited</div>
          <div className="font-bold text-slate-900 dark:text-white">{position ? `${stroopsToXlm(position.deposited)} XLM` : "—"}</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Est. Balance</div>
          <div className="font-bold text-indigo-600 dark:text-indigo-400">{estimated !== null ? `${stroopsToXlm(estimated)} XLM` : "—"}</div>
        </div>
      </div>

      <form onSubmit={handleDeposit} className="flex gap-2" aria-label="Deposit or withdraw">
        <input
          type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount in stroops"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" disabled={loading || !vault.isActive}
          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />} Deposit
        </button>
        <button type="button" onClick={handleWithdraw} disabled={loading || !position}
          className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
          Withdraw
        </button>
      </form>

      <button onClick={handleCompound} disabled={loading || !vault.isActive}
        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        aria-label="Trigger auto-compound">
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        Auto-Compound
      </button>
    </div>
  );
}

// ── AdminPanel ────────────────────────────────────────────────────────────────

function AdminPanel({ contractId, adminAddress, vaults, onRefresh }: {
  contractId: string; adminAddress: string; vaults: Vault[]; onRefresh: () => void;
}) {
  const [protoName, setProtoName] = useState("");
  const [protoApy, setProtoApy] = useState("800");
  const [vaultName, setVaultName] = useState("");
  const [vaultProto, setVaultProto] = useState("1");
  const [rebalVault, setRebalVault] = useState("1");
  const [rebalProto, setRebalProto] = useState("1");
  const [btVault, setBtVault] = useState("1");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(fn: () => Promise<string>) {
    setErr(""); setOk(""); setLoading(true);
    try { setOk(await fn()); onRefresh(); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {err && <ErrorBanner msg={err} onDismiss={() => setErr("")} />}
      {ok && <SuccessBanner msg={ok} onDismiss={() => setOk("")} />}

      {/* Add protocol */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-500" /> Add Protocol
        </h4>
        <div className="flex gap-2">
          <input value={protoName} onChange={(e) => setProtoName(e.target.value)} placeholder="Protocol name"
            aria-label="Protocol name"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="number" value={protoApy} onChange={(e) => setProtoApy(e.target.value)} placeholder="APY bps"
            aria-label="APY in basis points" className="w-24 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button disabled={loading} onClick={() => run(async () => {
            const d = await apiPost("/api/yield-optimizer/protocols", { contractId, admin: adminAddress, name: protoName, baseApyBps: parseInt(protoApy, 10) });
            return `Protocol #${d.protocolId} created`;
          })} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            Add
          </button>
        </div>
      </div>

      {/* Create vault */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-500" /> Create Vault
        </h4>
        <div className="flex gap-2">
          <input value={vaultName} onChange={(e) => setVaultName(e.target.value)} placeholder="Vault name"
            aria-label="Vault name"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="number" value={vaultProto} onChange={(e) => setVaultProto(e.target.value)} placeholder="Protocol ID"
            aria-label="Protocol ID" className="w-28 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button disabled={loading} onClick={() => run(async () => {
            const d = await apiPost("/api/yield-optimizer/vaults", { contractId, admin: adminAddress, name: vaultName, protocolId: parseInt(vaultProto, 10) });
            return `Vault #${d.vaultId} created`;
          })} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            Create
          </button>
        </div>
      </div>

      {/* Rebalance vault */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-500" /> Rebalance Vault
        </h4>
        <div className="flex gap-2">
          <select value={rebalVault} onChange={(e) => setRebalVault(e.target.value)}
            aria-label="Select vault to rebalance"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {vaults.map((v) => <option key={v.id} value={v.id}>#{v.id} {v.name}</option>)}
          </select>
          <input type="number" value={rebalProto} onChange={(e) => setRebalProto(e.target.value)} placeholder="New Protocol ID"
            aria-label="New protocol ID" className="w-32 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button disabled={loading} onClick={() => run(async () => {
            await apiPost(`/api/yield-optimizer/vaults/${rebalVault}/rebalance`, { contractId, admin: adminAddress, newProtocolId: parseInt(rebalProto, 10) });
            return `Vault #${rebalVault} rebalanced to protocol #${rebalProto}`;
          })} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            Rebalance
          </button>
        </div>
      </div>

      {/* Record backtest */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-purple-500" /> Record Backtest Snapshot
        </h4>
        <div className="flex gap-2">
          <select value={btVault} onChange={(e) => setBtVault(e.target.value)}
            aria-label="Select vault for backtest"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {vaults.map((v) => <option key={v.id} value={v.id}>#{v.id} {v.name}</option>)}
          </select>
          <button disabled={loading} onClick={() => run(async () => {
            const d = await apiPost(`/api/yield-optimizer/vaults/${btVault}/backtest`, { contractId, admin: adminAddress });
            return `Backtest #${d.backtestId} recorded`;
          })} className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            Snapshot
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export interface YieldOptimizerPanelProps {
  contractId?: string;
  adminAddress?: string;
  userAddress?: string;
}

export default function YieldOptimizerPanel({
  contractId = "",
  adminAddress = "",
  userAddress = "",
}: YieldOptimizerPanelProps) {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [selected, setSelected] = useState<Vault | null>(null);
  const [tab, setTab] = useState<"invest" | "admin">("invest");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const loadVaults = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const { vaultCount } = await apiGet("/api/yield-optimizer/vaults", { contractId });
      const results: Vault[] = await Promise.all(
        Array.from({ length: vaultCount ?? 0 }, (_, i) =>
          apiGet(`/api/yield-optimizer/vaults/${i + 1}`, { contractId }).then((d) => ({
            id: i + 1,
            name: d.vault?.name ?? `Vault #${i + 1}`,
            protocolId: d.vault?.protocol_id ?? 0,
            currentApyBps: d.vault?.current_apy_bps ?? 0,
            totalDeposited: d.vault?.total_deposited ?? 0,
            pendingRewards: d.vault?.pending_rewards ?? 0,
            totalCompounded: d.vault?.total_compounded ?? 0,
            lastCompoundTs: d.vault?.last_compound_ts ?? 0,
            isActive: d.vault?.is_active ?? false,
          }))
        )
      );
      setVaults(results);
      if (selected) setSelected(results.find((v) => v.id === selected.id) ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load vaults");
    } finally { setLoading(false); }
  }, [contractId, selected]);

  useEffect(() => { loadVaults(); }, [loadVaults]);

  async function togglePause() {
    setErr(""); setOk("");
    try {
      const path = paused ? "/api/yield-optimizer/unpause" : "/api/yield-optimizer/pause";
      await apiPost(path, { contractId, admin: adminAddress });
      setPaused(!paused);
      setOk(paused ? "Contract unpaused" : "Contract paused");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  }

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <Zap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Yield Optimizer</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Cross-protocol auto-compounding with strategy backtesting</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {paused && <span className="text-xs font-semibold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">PAUSED</span>}
          <button onClick={loadVaults} disabled={loading} aria-label="Refresh" className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {err && <div className="mb-4"><ErrorBanner msg={err} onDismiss={() => setErr("")} /></div>}
      {ok && <div className="mb-4"><SuccessBanner msg={ok} onDismiss={() => setOk("")} /></div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
        {(["invest", "admin"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
            {t === "invest" ? "Invest" : "Admin"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vault list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" /> Vaults
            </h3>
            <span className="text-xs text-slate-500">{vaults.length} vault{vaults.length !== 1 ? "s" : ""}</span>
          </div>
          {vaults.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              {contractId ? "No vaults found" : "Enter a contract ID to load vaults"}
            </div>
          ) : (
            vaults.map((v) => (
              <VaultCard key={v.id} vault={v} selected={selected?.id === v.id} onSelect={() => setSelected(v)} />
            ))
          )}
        </div>

        {/* Right panel */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-slate-400 text-sm gap-2">
              <Zap className="w-10 h-10 opacity-30" />
              <span>Select a vault to interact</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Vault stats */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{selected.name}</h3>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${selected.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {selected.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-xs text-slate-500 mb-1">APY</div><div className="font-semibold text-green-600 dark:text-green-400">{bpsToPercent(selected.currentApyBps)}</div></div>
                  <div><div className="text-xs text-slate-500 mb-1">TVL</div><div className="font-semibold text-slate-900 dark:text-white">{stroopsToXlm(selected.totalDeposited)} XLM</div></div>
                  <div><div className="text-xs text-slate-500 mb-1">Compounded</div><div className="font-semibold text-indigo-600 dark:text-indigo-400">{stroopsToXlm(selected.totalCompounded)} XLM</div></div>
                  <div><div className="text-xs text-slate-500 mb-1">Protocol</div><div className="font-semibold text-slate-900 dark:text-white">#{selected.protocolId}</div></div>
                </div>
              </div>

              {tab === "invest" && (
                <PositionPanel vault={selected} contractId={contractId} userAddress={userAddress} onRefresh={loadVaults} />
              )}

              {tab === "admin" && (
                <div className="space-y-4">
                  <AdminPanel contractId={contractId} adminAddress={adminAddress} vaults={vaults} onRefresh={loadVaults} />
                  {/* Pause/unpause */}
                  <div className="p-4 rounded-lg border border-red-200 dark:border-red-800">
                    <h4 className="font-medium text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Emergency Controls
                    </h4>
                    <button onClick={togglePause}
                      className={`flex items-center gap-2 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors ${paused ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
                      {paused ? <><PlayCircle className="w-4 h-4" /> Unpause Contract</> : <><PauseCircle className="w-4 h-4" /> Pause Contract</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
