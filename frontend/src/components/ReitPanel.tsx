"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Coins,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  TrendingUp,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Property {
  id: number;
  name: string;
  totalShares: number;
  sharesIssued: number;
  pricePerShare: number;
  totalDividends: number;
  isActive: boolean;
}

export interface Holding {
  shares: number;
  dividendsClaimedSnapshot: number;
}

// ── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000"
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

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
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
    <p className="text-xs text-red-400 mt-1 flex items-center gap-1" role="alert">
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

export interface ReitPanelProps {
  contractId: string;
  walletAddress?: string;
  network?: string;
}

type Tab = "properties" | "shares" | "dividends";

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ReitPanel({
  contractId,
  walletAddress = "",
  network = "testnet",
}: ReitPanelProps) {
  const [tab, setTab] = useState<Tab>("properties");
  const [paused, setPaused] = useState(false);
  const [propertyCount, setPropertyCount] = useState(0);
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
      const data = await apiGet("/api/reit/status", { contractId, network });
      setPaused(data.paused ?? false);
      setPropertyCount(data.propertyCount ?? 0);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [contractId, network, showToast]);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  async function togglePause() {
    if (!walletAddress) return showToast("Wallet address required", false);
    try {
      await apiPost(`/api/reit/${paused ? "unpause" : "pause"}`, {
        contractId, admin: walletAddress, network,
      });
      showToast(paused ? "Contract unpaused" : "Contract paused");
      await refreshStats();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "properties", label: "Properties" },
    { id: "shares", label: "Shares" },
    { id: "dividends", label: "Dividends" },
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Properties" value={propertyCount} icon={<Building2 size={18} />} />
        <StatCard label="Network" value={network} icon={<TrendingUp size={18} />} />
        <StatCard
          label="Status"
          value={paused ? "Paused" : "Active"}
          icon={paused ? <PauseCircle size={18} className="text-yellow-400" /> : <PlayCircle size={18} className="text-green-400" />}
        />
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
              paused ? "bg-green-700 hover:bg-green-600 text-white" : "bg-yellow-700 hover:bg-yellow-600 text-white"
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

      {tab === "properties" && (
        <PropertiesTab contractId={contractId} walletAddress={walletAddress} network={network} showToast={showToast} onRefresh={refreshStats} />
      )}
      {tab === "shares" && (
        <SharesTab contractId={contractId} walletAddress={walletAddress} network={network} showToast={showToast} />
      )}
      {tab === "dividends" && (
        <DividendsTab contractId={contractId} walletAddress={walletAddress} network={network} showToast={showToast} />
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

// ── PropertiesTab ─────────────────────────────────────────────────────────────

function PropertiesTab({ contractId, walletAddress, network, showToast, onRefresh }: TabProps) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [lookupId, setLookupId] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", totalShares: "1000", pricePerShare: "1000000" });
  const [formErr, setFormErr] = useState<Partial<typeof form>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchProperty = useCallback(async () => {
    const id = Number(lookupId);
    if (!id) return showToast("Enter a valid property ID", false);
    setLoading(true);
    try {
      const data = await apiGet(`/api/reit/properties/${id}`, { contractId, network });
      setProperties([{ id, ...data.property }]);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [lookupId, contractId, network, showToast]);

  function validate() {
    const errs: Partial<typeof form> = {};
    if (!form.name.trim()) errs.name = "Required";
    if (!Number(form.totalShares) || Number(form.totalShares) < 1) errs.totalShares = "Must be >= 1";
    if (!Number(form.pricePerShare) || Number(form.pricePerShare) <= 0) errs.pricePerShare = "Must be > 0";
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  }

  async function addProperty(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !walletAddress) {
      if (!walletAddress) showToast("Wallet address required", false);
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiPost("/api/reit/properties", {
        contractId, admin: walletAddress, name: form.name.trim(),
        totalShares: Number(form.totalShares), pricePerShare: Number(form.pricePerShare), network,
      });
      showToast(`Property added (ID: ${data.propertyId})`);
      setForm((f) => ({ ...f, name: "" }));
      onRefresh?.();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate(pid: number) {
    if (!walletAddress) return showToast("Wallet address required", false);
    try {
      await apiPatch(`/api/reit/properties/${pid}/deactivate`, { contractId, admin: walletAddress, network });
      showToast("Property deactivated");
      setProperties((prev) => prev.map((p) => p.id === pid ? { ...p, isActive: false } : p));
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Add Property" />
        <form onSubmit={addProperty} className="space-y-3" noValidate>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="prop-name">Property Name</label>
            <input id="prop-name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Manhattan Tower A"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            {formErr.name && <ErrorMsg msg={formErr.name} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="prop-shares">Total Shares</label>
              <input id="prop-shares" type="number" min={1} value={form.totalShares}
                onChange={(e) => setForm((f) => ({ ...f, totalShares: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
              {formErr.totalShares && <ErrorMsg msg={formErr.totalShares} />}
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="prop-price">Price/Share (stroops)</label>
              <input id="prop-price" type="number" min={1} value={form.pricePerShare}
                onChange={(e) => setForm((f) => ({ ...f, pricePerShare: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
              {formErr.pricePerShare && <ErrorMsg msg={formErr.pricePerShare} />}
            </div>
          </div>
          <button type="submit" disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors">
            <Plus size={14} /> {submitting ? "Adding…" : "Add Property"}
          </button>
        </form>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Look Up Property" />
        <div className="flex gap-2">
          <input value={lookupId} onChange={(e) => setLookupId(e.target.value)}
            placeholder="Property ID" type="number" min={1}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
          <button onClick={fetchProperty} disabled={loading}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : "Fetch"}
          </button>
        </div>
      </div>

      {properties.map((p) => (
        <div key={p.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">#{p.id} — {p.name}</p>
              <p className="text-xs text-gray-400">
                Shares: {p.sharesIssued?.toLocaleString()} / {p.totalShares?.toLocaleString()} issued
              </p>
              <p className="text-xs text-gray-400">Price: {p.pricePerShare?.toLocaleString()} stroops/share</p>
              <p className="text-xs text-indigo-300">Total dividends: {p.totalDividends?.toLocaleString()}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.isActive ? "bg-green-900/40 text-green-300 border border-green-700" : "bg-red-900/40 text-red-300 border border-red-700"}`}>
                {p.isActive ? "Active" : "Inactive"}
              </span>
              {p.isActive && walletAddress && (
                <button onClick={() => deactivate(p.id)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Deactivate
                </button>
              )}
            </div>
          </div>
          {p.totalShares > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Shares sold</span>
                <span>{Math.round((p.sharesIssued / p.totalShares) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (p.sharesIssued / p.totalShares) * 100)}%` }}
                  role="progressbar"
                  aria-valuenow={p.sharesIssued}
                  aria-valuemax={p.totalShares}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── SharesTab ─────────────────────────────────────────────────────────────────

function SharesTab({ contractId, walletAddress, network, showToast }: TabProps) {
  const [holding, setHolding] = useState<Holding | null>(null);
  const [form, setForm] = useState({ propertyId: "", shares: "", toAddress: "" });
  const [action, setAction] = useState<"mint" | "burn" | "transfer">("mint");
  const [submitting, setSubmitting] = useState(false);
  const [lookupPid, setLookupPid] = useState("");
  const [lookupInvestor, setLookupInvestor] = useState(walletAddress);
  const [loadingHolding, setLoadingHolding] = useState(false);

  async function fetchHolding() {
    const pid = Number(lookupPid);
    if (!pid || !lookupInvestor) return showToast("Property ID and investor address required", false);
    setLoadingHolding(true);
    try {
      const data = await apiGet("/api/reit/shares/holding", {
        contractId, investor: lookupInvestor, propertyId: String(pid), network,
      });
      setHolding(data.holding);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoadingHolding(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pid = Number(form.propertyId);
    const shares = Number(form.shares);
    if (!pid || !shares || !walletAddress) return showToast("Fill all fields", false);
    setSubmitting(true);
    try {
      if (action === "mint") {
        const data = await apiPost("/api/reit/shares/mint", {
          contractId, investor: walletAddress, propertyId: pid, shares, network,
        });
        showToast(`Minted ${shares} shares — cost: ${data.cost?.toLocaleString()} stroops`);
      } else if (action === "burn") {
        await apiPost("/api/reit/shares/burn", {
          contractId, investor: walletAddress, propertyId: pid, shares, network,
        });
        showToast(`Burned ${shares} shares`);
      } else {
        if (!form.toAddress) return showToast("Recipient address required", false);
        await apiPost("/api/reit/shares/transfer", {
          contractId, from: walletAddress, to: form.toAddress, propertyId: pid, shares, network,
        });
        showToast(`Transferred ${shares} shares`);
      }
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Share Operations" />
        <div className="flex gap-2 mb-3">
          {(["mint", "burn", "transfer"] as const).map((a) => (
            <button key={a} onClick={() => setAction(a)}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors capitalize ${action === a ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
              {a}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="sh-pid">Property ID</label>
              <input id="sh-pid" type="number" min={1} value={form.propertyId}
                onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="sh-amt">Shares</label>
              <input id="sh-amt" type="number" min={1} value={form.shares}
                onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          {action === "transfer" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="sh-to">Recipient Address</label>
              <input id="sh-to" value={form.toAddress}
                onChange={(e) => setForm((f) => ({ ...f, toAddress: e.target.value }))}
                placeholder="G…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
          )}
          <button type="submit" disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors capitalize">
            <Coins size={14} /> {submitting ? "Processing…" : action}
          </button>
        </form>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Look Up Holding" />
        <div className="space-y-2">
          <input value={lookupInvestor} onChange={(e) => setLookupInvestor(e.target.value)}
            placeholder="Investor address (G…)"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
          <div className="flex gap-2">
            <input value={lookupPid} onChange={(e) => setLookupPid(e.target.value)}
              placeholder="Property ID" type="number" min={1}
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            <button onClick={fetchHolding} disabled={loadingHolding}
              className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50">
              {loadingHolding ? <RefreshCw size={14} className="animate-spin" /> : "Fetch"}
            </button>
          </div>
        </div>
        {holding && (
          <div className="mt-3 bg-gray-700/50 rounded p-3 space-y-1">
            <p className="text-sm font-medium text-white">{holding.shares?.toLocaleString()} shares held</p>
            <p className="text-xs text-gray-400">Dividend snapshot: {holding.dividendsClaimedSnapshot?.toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DividendsTab ──────────────────────────────────────────────────────────────

function DividendsTab({ contractId, walletAddress, network, showToast }: TabProps) {
  const [pending, setPending] = useState<number | null>(null);
  const [depositForm, setDepositForm] = useState({ propertyId: "", amount: "" });
  const [claimForm, setClaimForm] = useState({ propertyId: "", investor: walletAddress });
  const [pendingForm, setPendingForm] = useState({ propertyId: "", investor: walletAddress });
  const [depositing, setDepositing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [checkingPending, setCheckingPending] = useState(false);

  async function depositDividends(e: React.FormEvent) {
    e.preventDefault();
    const pid = Number(depositForm.propertyId);
    const amt = Number(depositForm.amount);
    if (!pid || !amt || !walletAddress) return showToast("Fill all fields", false);
    setDepositing(true);
    try {
      await apiPost("/api/reit/dividends/deposit", {
        contractId, admin: walletAddress, propertyId: pid, amount: amt, network,
      });
      showToast(`Deposited ${amt.toLocaleString()} stroops in dividends`);
      setDepositForm((f) => ({ ...f, amount: "" }));
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setDepositing(false);
    }
  }

  async function claimDividends(e: React.FormEvent) {
    e.preventDefault();
    const pid = Number(claimForm.propertyId);
    if (!pid || !claimForm.investor) return showToast("Fill all fields", false);
    setClaiming(true);
    try {
      const data = await apiPost("/api/reit/dividends/claim", {
        contractId, investor: claimForm.investor, propertyId: pid, network,
      });
      showToast(`Claimed ${data.claimed?.toLocaleString()} stroops`);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setClaiming(false);
    }
  }

  async function checkPending(e: React.FormEvent) {
    e.preventDefault();
    const pid = Number(pendingForm.propertyId);
    if (!pid || !pendingForm.investor) return showToast("Fill all fields", false);
    setCheckingPending(true);
    try {
      const data = await apiGet("/api/reit/dividends/pending", {
        contractId, investor: pendingForm.investor, propertyId: String(pid), network,
      });
      setPending(data.pending ?? 0);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setCheckingPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Deposit */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Deposit Dividends (Admin)" />
        <form onSubmit={depositDividends} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="div-dep-pid">Property ID</label>
              <input id="div-dep-pid" type="number" min={1} value={depositForm.propertyId}
                onChange={(e) => setDepositForm((f) => ({ ...f, propertyId: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="div-dep-amt">Amount (stroops)</label>
              <input id="div-dep-amt" type="number" min={1} value={depositForm.amount}
                onChange={(e) => setDepositForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <button type="submit" disabled={depositing}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors">
            <TrendingUp size={14} /> {depositing ? "Depositing…" : "Deposit Dividends"}
          </button>
        </form>
      </div>

      {/* Check pending */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Check Pending Dividends" />
        <form onSubmit={checkPending} className="space-y-3" noValidate>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="div-chk-inv">Investor Address</label>
            <input id="div-chk-inv" value={pendingForm.investor}
              onChange={(e) => setPendingForm((f) => ({ ...f, investor: e.target.value }))}
              placeholder="G…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
          </div>
          <div className="flex gap-2">
            <input type="number" min={1} value={pendingForm.propertyId}
              onChange={(e) => setPendingForm((f) => ({ ...f, propertyId: e.target.value }))}
              placeholder="Property ID"
              aria-label="Property ID for pending check"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            <button type="submit" disabled={checkingPending}
              className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50">
              {checkingPending ? <RefreshCw size={14} className="animate-spin" /> : "Check"}
            </button>
          </div>
        </form>
        {pending !== null && (
          <div className="mt-3 bg-gray-700/50 rounded p-3">
            <p className="text-xs text-gray-400">Pending dividends</p>
            <p className="text-lg font-bold text-green-300">{pending.toLocaleString()} stroops</p>
          </div>
        )}
      </div>

      {/* Claim */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Claim Dividends" />
        <form onSubmit={claimDividends} className="space-y-3" noValidate>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="div-clm-inv">Investor Address</label>
            <input id="div-clm-inv" value={claimForm.investor}
              onChange={(e) => setClaimForm((f) => ({ ...f, investor: e.target.value }))}
              placeholder="G…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
          </div>
          <div className="flex gap-2">
            <input type="number" min={1} value={claimForm.propertyId}
              onChange={(e) => setClaimForm((f) => ({ ...f, propertyId: e.target.value }))}
              placeholder="Property ID"
              aria-label="Property ID for claim"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
            <button type="submit" disabled={claiming}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors">
              <Coins size={14} /> {claiming ? "Claiming…" : "Claim"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
