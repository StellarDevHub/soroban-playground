"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  Coins,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReitTrust {
  id: number;
  name: string;
  totalShares: number;
  sharesSold: number;
  pricePerShare: number;
  totalDividendsDeposited: number;
  annualYieldBps: number;
  isActive: boolean;
}

export interface Holding {
  shares: number;
  dividendsClaimed: number;
}

// ── API client ────────────────────────────────────────────────────────────────

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

async function apiGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: number): string {
  return (stroops / 1_000_000).toFixed(2);
}

function yieldLabel(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

function pctSold(trust: ReitTrust): number {
  if (trust.totalShares === 0) return 0;
  return Math.round((trust.sharesSold / trust.totalShares) * 100);
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
        active
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      }`}
    >
      {active ? <CheckCircle2 className="w-3 h-3" /> : <PauseCircle className="w-3 h-3" />}
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── TrustCard ─────────────────────────────────────────────────────────────────

function TrustCard({
  trust,
  onSelect,
  selected,
}: {
  trust: ReitTrust;
  onSelect: (t: ReitTrust) => void;
  selected: boolean;
}) {
  const sold = pctSold(trust);
  return (
    <button
      onClick={() => onSelect(trust)}
      aria-pressed={selected}
      className={`w-full text-left p-4 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        selected
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 bg-white dark:bg-slate-800/50"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="font-semibold text-slate-900 dark:text-white truncate pr-2">
          {trust.name}
        </span>
        <StatusBadge active={trust.isActive} />
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
        Trust #{trust.id} · {yieldLabel(trust.annualYieldBps)} annual yield
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mb-1">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${sold}%` }}
          role="progressbar"
          aria-valuenow={sold}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{trust.sharesSold.toLocaleString()} / {trust.totalShares.toLocaleString()} shares sold</span>
        <span>{sold}%</span>
      </div>
    </button>
  );
}

// ── ErrorBanner ───────────────────────────────────────────────────────────────

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm"
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">✕</button>
    </div>
  );
}

// ── SuccessBanner ─────────────────────────────────────────────────────────────

function SuccessBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm"
    >
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-green-400 hover:text-green-600">✕</button>
    </div>
  );
}

// ── CreateTrustForm ───────────────────────────────────────────────────────────

function CreateTrustForm({
  contractId,
  adminAddress,
  onCreated,
}: {
  contractId: string;
  adminAddress: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [totalShares, setTotalShares] = useState("1000");
  const [pricePerShare, setPricePerShare] = useState("1000000");
  const [annualYieldBps, setAnnualYieldBps] = useState("500");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!name.trim()) return setError("Name is required");
    const shares = parseInt(totalShares, 10);
    const price = parseInt(pricePerShare, 10);
    const yieldBps = parseInt(annualYieldBps, 10);
    if (isNaN(shares) || shares <= 0) return setError("Total shares must be a positive integer");
    if (isNaN(price) || price <= 0) return setError("Price per share must be positive");
    if (isNaN(yieldBps) || yieldBps < 0 || yieldBps > 10000) return setError("Annual yield must be 0–10000 bps");

    setLoading(true);
    try {
      const data = await apiPost("/api/reit/trusts", {
        contractId,
        admin: adminAddress,
        name: name.trim(),
        totalShares: shares,
        pricePerShare: price,
        annualYieldBps: yieldBps,
      });
      setSuccess(`Trust created! ID: ${data.trustId}`);
      setName("");
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create trust");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="Create REIT Trust">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess("")} />}
      <div>
        <label htmlFor="trust-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          Trust Name
        </label>
        <input
          id="trust-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Downtown Office REIT"
          required
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="total-shares" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Total Shares
          </label>
          <input
            id="total-shares"
            type="number"
            min="1"
            value={totalShares}
            onChange={(e) => setTotalShares(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="price-per-share" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Price (stroops)
          </label>
          <input
            id="price-per-share"
            type="number"
            min="1"
            value={pricePerShare}
            onChange={(e) => setPricePerShare(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="yield-bps" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Yield (bps)
          </label>
          <input
            id="yield-bps"
            type="number"
            min="0"
            max="10000"
            value={annualYieldBps}
            onChange={(e) => setAnnualYieldBps(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        {loading ? "Creating…" : "Create Trust"}
      </button>
    </form>
  );
}

// ── InvestorPanel ─────────────────────────────────────────────────────────────

function InvestorPanel({
  trust,
  contractId,
  investorAddress,
  onRefresh,
}: {
  trust: ReitTrust;
  contractId: string;
  investorAddress: string;
  onRefresh: () => void;
}) {
  const [shares, setShares] = useState("10");
  const [claimable, setClaimable] = useState<number | null>(null);
  const [holding, setHolding] = useState<Holding | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadHolding = useCallback(async () => {
    if (!investorAddress || !contractId) return;
    try {
      const [hData, cData] = await Promise.all([
        apiGet(`/api/reit/trusts/${trust.id}/holding/${investorAddress}`, { contractId }),
        apiGet(`/api/reit/trusts/${trust.id}/claimable/${investorAddress}`, { contractId }),
      ]);
      setHolding(hData.holding);
      setClaimable(cData.claimable);
    } catch {
      // investor may have no holding yet
      setHolding(null);
      setClaimable(0);
    }
  }, [trust.id, contractId, investorAddress]);

  useEffect(() => { loadHolding(); }, [loadHolding]);

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    const n = parseInt(shares, 10);
    if (isNaN(n) || n <= 0) return setError("Shares must be a positive integer");
    setLoading(true);
    try {
      const data = await apiPost(`/api/reit/trusts/${trust.id}/buy`, {
        contractId, investor: investorAddress, shares: n,
      });
      setSuccess(`Purchased ${n} shares. Cost: ${stroopsToXlm(data.cost)} XLM`);
      onRefresh();
      loadHolding();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    setError(""); setSuccess("");
    setLoading(true);
    try {
      const data = await apiPost(`/api/reit/trusts/${trust.id}/claim`, {
        contractId, investor: investorAddress,
      });
      setSuccess(`Claimed ${stroopsToXlm(data.amount)} XLM in dividends`);
      loadHolding();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess("")} />}

      {/* Holding summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Your Shares</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white">
            {holding ? holding.shares.toLocaleString() : "—"}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Claimable Dividends</div>
          <div className="text-xl font-bold text-green-600 dark:text-green-400">
            {claimable !== null ? `${stroopsToXlm(claimable)} XLM` : "—"}
          </div>
        </div>
      </div>

      {/* Buy shares */}
      <form onSubmit={handleBuy} className="flex gap-2" aria-label="Buy shares">
        <input
          type="number"
          min="1"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          aria-label="Number of shares to buy"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !trust.isActive}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
          Buy
        </button>
      </form>

      {/* Claim dividends */}
      <button
        onClick={handleClaim}
        disabled={loading || !claimable}
        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        aria-label="Claim dividends"
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BadgeDollarSign className="w-4 h-4" />}
        Claim Dividends
      </button>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export interface TokenizedReitDashboardProps {
  contractId?: string;
  adminAddress?: string;
  investorAddress?: string;
}

export default function TokenizedReitDashboard({
  contractId = "",
  adminAddress = "",
  investorAddress = "",
}: TokenizedReitDashboardProps) {
  const [trusts, setTrusts] = useState<ReitTrust[]>([]);
  const [selectedTrust, setSelectedTrust] = useState<ReitTrust | null>(null);
  const [activeTab, setActiveTab] = useState<"invest" | "admin">("invest");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Dividend deposit form state
  const [dividendAmount, setDividendAmount] = useState("1000000");

  const loadTrusts = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const countData = await apiGet("/api/reit/trusts", { contractId });
      const count: number = countData.trustCount ?? 0;
      const results = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          apiGet(`/api/reit/trusts/${i + 1}`, { contractId }).then((d) => ({
            id: i + 1,
            name: d.trust?.name ?? `Trust #${i + 1}`,
            totalShares: d.trust?.total_shares ?? 0,
            sharesSold: d.trust?.shares_sold ?? 0,
            pricePerShare: d.trust?.price_per_share ?? 0,
            totalDividendsDeposited: d.trust?.total_dividends_deposited ?? 0,
            annualYieldBps: d.trust?.annual_yield_bps ?? 0,
            isActive: d.trust?.is_active ?? false,
          }))
        )
      );
      setTrusts(results);
      if (selectedTrust) {
        const updated = results.find((t) => t.id === selectedTrust.id);
        if (updated) setSelectedTrust(updated);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load trusts");
    } finally {
      setLoading(false);
    }
  }, [contractId, selectedTrust]);

  useEffect(() => { loadTrusts(); }, [loadTrusts]);

  async function handlePauseToggle() {
    setError(""); setSuccess("");
    try {
      const endpoint = paused ? "/api/reit/unpause" : "/api/reit/pause";
      await apiPost(endpoint, { contractId, admin: adminAddress });
      setPaused(!paused);
      setSuccess(paused ? "Contract unpaused" : "Contract paused");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Pause toggle failed");
    }
  }

  async function handleDepositDividends(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTrust) return;
    setError(""); setSuccess("");
    const amount = parseInt(dividendAmount, 10);
    if (isNaN(amount) || amount <= 0) return setError("Amount must be positive");
    try {
      await apiPost(`/api/reit/trusts/${selectedTrust.id}/dividends`, {
        contractId, admin: adminAddress, amount,
      });
      setSuccess(`Deposited ${stroopsToXlm(amount)} XLM in dividends`);
      loadTrusts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    }
  }

  async function handleDeactivate() {
    if (!selectedTrust) return;
    setError(""); setSuccess("");
    try {
      await apiPost(`/api/reit/trusts/${selectedTrust.id}/deactivate`, {
        contractId, admin: adminAddress,
      });
      setSuccess("Trust deactivated");
      loadTrusts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deactivation failed");
    }
  }

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Tokenized REIT</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Fractional real estate investment with dividend distribution
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {paused && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              PAUSED
            </span>
          )}
          <button
            onClick={loadTrusts}
            disabled={loading}
            aria-label="Refresh trusts"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {success && <SuccessBanner message={success} onDismiss={() => setSuccess("")} />}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
        {(["invest", "admin"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {tab === "invest" ? "Invest" : "Admin"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trust list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              REIT Trusts
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {trusts.length} trust{trusts.length !== 1 ? "s" : ""}
            </span>
          </div>
          {trusts.length === 0 ? (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
              {contractId ? "No trusts found" : "Enter a contract ID to load trusts"}
            </div>
          ) : (
            trusts.map((t) => (
              <TrustCard
                key={t.id}
                trust={t}
                onSelect={setSelectedTrust}
                selected={selectedTrust?.id === t.id}
              />
            ))
          )}
        </div>

        {/* Right panel */}
        <div className="lg:col-span-2">
          {!selectedTrust ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-slate-400 dark:text-slate-500 text-sm gap-2">
              <Building2 className="w-10 h-10 opacity-30" />
              <span>Select a trust to interact</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Trust details */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{selectedTrust.name}</h3>
                  <StatusBadge active={selectedTrust.isActive} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Price/Share</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {stroopsToXlm(selectedTrust.pricePerShare)} XLM
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Annual Yield</div>
                    <div className="font-semibold text-green-600 dark:text-green-400">
                      {yieldLabel(selectedTrust.annualYieldBps)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Total Dividends</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {stroopsToXlm(selectedTrust.totalDividendsDeposited)} XLM
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Shares Sold</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {pctSold(selectedTrust)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Invest tab */}
              {activeTab === "invest" && (
                <InvestorPanel
                  trust={selectedTrust}
                  contractId={contractId}
                  investorAddress={investorAddress}
                  onRefresh={loadTrusts}
                />
              )}

              {/* Admin tab */}
              {activeTab === "admin" && (
                <div className="space-y-4">
                  {/* Deposit dividends */}
                  <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                    <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-green-500" />
                      Deposit Dividends
                    </h4>
                    <form onSubmit={handleDepositDividends} className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        value={dividendAmount}
                        onChange={(e) => setDividendAmount(e.target.value)}
                        aria-label="Dividend amount in stroops"
                        placeholder="Amount (stroops)"
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        <BadgeDollarSign className="w-4 h-4" />
                        Deposit
                      </button>
                    </form>
                  </div>

                  {/* Create trust */}
                  <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                    <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                      <Plus className="w-4 h-4 text-blue-500" />
                      Create New Trust
                    </h4>
                    <CreateTrustForm
                      contractId={contractId}
                      adminAddress={adminAddress}
                      onCreated={loadTrusts}
                    />
                  </div>

                  {/* Danger zone */}
                  <div className="p-4 rounded-lg border border-red-200 dark:border-red-800">
                    <h4 className="font-medium text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Danger Zone
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleDeactivate}
                        disabled={!selectedTrust.isActive}
                        className="flex items-center gap-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        <PauseCircle className="w-4 h-4" />
                        Deactivate Trust
                      </button>
                      <button
                        onClick={handlePauseToggle}
                        className={`flex items-center gap-1 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          paused
                            ? "bg-green-600 hover:bg-green-700"
                            : "bg-red-600 hover:bg-red-700"
                        }`}
                      >
                        {paused ? (
                          <><PlayCircle className="w-4 h-4" /> Unpause Contract</>
                        ) : (
                          <><PauseCircle className="w-4 h-4" /> Pause Contract</>
                        )}
                      </button>
                    </div>
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
