"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Filter,
  Layers,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");

const CURVE_TYPES = ["Linear", "Exponential"] as const;
type CurveType = (typeof CURVE_TYPES)[number];

const POOL_TYPES = ["Buy", "Sell", "Trade"] as const;
type PoolType = (typeof POOL_TYPES)[number];

const POOL_TYPE_COLORS: Record<PoolType, string> = {
  Buy: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  Sell: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  Trade: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
};

const CURVE_COLORS: Record<CurveType, string> = {
  Linear: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  Exponential: "text-purple-400 bg-purple-400/10 border-purple-400/30",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pool {
  id: number;
  owner: string;
  nftCollection: string;
  paymentToken: string;
  curve: CurveType;
  poolType: PoolType;
  spotPrice: number;
  delta: number;
  feeBps: number;
  nftCount: number;
  nftIds: number[];
  tokenBalance: number;
  totalVolume: number;
  tradeCount: number;
  active: boolean;
  createdAt: number;
}

interface Stats {
  totalPools: number;
  activePools: number;
  totalVolume: number;
  totalTrades: number;
  byType: Record<string, number>;
  byCurve: Record<string, number>;
  protocolFeeBps: number;
  protocolFeeBalance: number;
  paused: boolean;
}

interface CollectionAnalytics {
  collection: string;
  totalPools: number;
  activePools: number;
  totalNftsInPools: number;
  totalVolume: number;
  totalTrades: number;
  floorPrice: number | null;
  averageTradePrice: number;
  recentTrades: Array<{
    type: string;
    poolId: number;
    nftId: number;
    price: number;
    ts: number;
  }>;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

type Toast = { type: "success" | "error"; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(2);
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/nft-amm${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const json = (await res.json()) as { success?: boolean; data?: T; message?: string };
    if (!res.ok) {
      return { ok: false, error: (json as { message?: string }).message ?? "Request failed" };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToastBanner({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-lg border p-4 text-sm ${
        toast.type === "success"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/40 bg-red-500/10 text-red-300"
      }`}
    >
      {toast.type === "success" ? (
        <CheckCircle2 size={16} className="shrink-0" />
      ) : (
        <AlertCircle size={16} className="shrink-0" />
      )}
      {toast.message}
    </div>
  );
}

function Badge({
  label,
  colorClass,
  icon,
}: {
  label: string;
  colorClass: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {icon}
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
        <div className="text-gray-400">{icon}</div>
      </div>
    </div>
  );
}

// ── Pool Card ─────────────────────────────────────────────────────────────────

function PoolCard({
  pool,
  onBuy,
  onSell,
  userAddress,
}: {
  pool: Pool;
  onBuy: (poolId: number, maxPrice: number) => Promise<void>;
  onSell: (poolId: number, nftId: number, minPrice: number) => Promise<void>;
  userAddress: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);
  const [sellLoading, setSellLoading] = useState(false);
  const [nftIdInput, setNftIdInput] = useState("");

  const buyPrice = Math.floor(
    pool.spotPrice * (1 + pool.feeBps / 10_000) * (1 + 50 / 10_000)
  );
  const sellPrice = Math.floor(
    pool.spotPrice * (1 - 50 / 10_000)
  );

  const handleBuy = async () => {
    setBuyLoading(true);
    try {
      await onBuy(pool.id, buyPrice * 2);
    } finally {
      setBuyLoading(false);
    }
  };

  const handleSell = async () => {
    const nftId = parseInt(nftIdInput, 10);
    if (!Number.isInteger(nftId) || nftId < 0) return;
    setSellLoading(true);
    try {
      await onSell(pool.id, nftId, 1);
    } finally {
      setSellLoading(false);
    }
  };

  return (
    <div
      className={`rounded-xl border bg-gray-900/40 transition-colors hover:border-gray-700 ${
        pool.active ? "border-gray-800" : "border-gray-800/50 opacity-60"
      }`}
    >
      <button
        className="flex w-full items-center gap-3 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="w-8 shrink-0 text-center font-mono text-sm text-gray-500">
          #{pool.id}
        </span>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-gray-200">
            {shortAddr(pool.nftCollection)}
          </p>
          <p className="text-xs text-gray-500">
            {stroopsToXlm(pool.spotPrice)} XLM spot
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge
            label={pool.poolType}
            colorClass={POOL_TYPE_COLORS[pool.poolType]}
          />
          <Badge
            label={pool.curve}
            colorClass={CURVE_COLORS[pool.curve]}
          />
          {!pool.active && (
            <Badge label="Inactive" colorClass="text-gray-500 bg-gray-500/10 border-gray-500/30" />
          )}
        </div>
        {expanded ? (
          <ChevronUp size={16} className="shrink-0 text-gray-500" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-gray-500" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 text-sm space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Spot Price</p>
              <p className="mt-0.5 font-semibold text-gray-200">
                {stroopsToXlm(pool.spotPrice)} XLM
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Delta</p>
              <p className="mt-0.5 text-gray-300">
                {pool.curve === "Linear"
                  ? `${stroopsToXlm(pool.delta)} XLM`
                  : `${(pool.delta / 100).toFixed(2)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Pool Fee</p>
              <p className="mt-0.5 text-gray-300">
                {(pool.feeBps / 100).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">NFTs in Pool</p>
              <p className="mt-0.5 text-gray-300">{pool.nftCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Token Balance</p>
              <p className="mt-0.5 text-gray-300">
                {stroopsToXlm(pool.tokenBalance)} XLM
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Volume</p>
              <p className="mt-0.5 text-gray-300">
                {stroopsToXlm(pool.totalVolume)} XLM
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Trades</p>
              <p className="mt-0.5 text-gray-300">{pool.tradeCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Owner</p>
              <p className="mt-0.5 font-mono text-gray-300">
                {shortAddr(pool.owner)}
              </p>
            </div>
          </div>

          {/* Price preview */}
          {pool.active && (
            <div className="grid gap-3 sm:grid-cols-2">
              {pool.poolType !== "Buy" && (
                <div className="rounded-lg border border-emerald-800/40 bg-emerald-900/20 p-3">
                  <p className="text-xs text-gray-500">Buy Price (incl. fees)</p>
                  <p className="mt-1 text-lg font-bold text-emerald-400">
                    {stroopsToXlm(buyPrice)} XLM
                  </p>
                </div>
              )}
              {pool.poolType !== "Sell" && (
                <div className="rounded-lg border border-orange-800/40 bg-orange-900/20 p-3">
                  <p className="text-xs text-gray-500">Sell Price (after fees)</p>
                  <p className="mt-1 text-lg font-bold text-orange-400">
                    {stroopsToXlm(sellPrice)} XLM
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Trade actions */}
          {pool.active && userAddress && (
            <div className="flex flex-wrap gap-3">
              {pool.poolType !== "Buy" && pool.nftCount > 0 && (
                <button
                  onClick={handleBuy}
                  disabled={buyLoading}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600/20 border border-emerald-600/30 px-4 py-2 text-sm text-emerald-300 transition-colors hover:bg-emerald-600/30 disabled:opacity-50"
                  aria-label={`Buy NFT from pool ${pool.id}`}
                >
                  {buyLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ShoppingCart size={14} />
                  )}
                  Buy NFT
                </button>
              )}
              {pool.poolType !== "Sell" && pool.tokenBalance > 0 && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={nftIdInput}
                    onChange={(e) => setNftIdInput(e.target.value)}
                    placeholder="NFT ID"
                    aria-label="NFT ID to sell"
                    className="w-24 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-orange-500"
                  />
                  <button
                    onClick={handleSell}
                    disabled={sellLoading || !nftIdInput}
                    className="flex items-center gap-2 rounded-lg bg-orange-600/20 border border-orange-600/30 px-4 py-2 text-sm text-orange-300 transition-colors hover:bg-orange-600/30 disabled:opacity-50"
                    aria-label={`Sell NFT to pool ${pool.id}`}
                  >
                    {sellLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <TrendingDown size={14} />
                    )}
                    Sell NFT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create Pool Modal ─────────────────────────────────────────────────────────

function CreatePoolModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: {
    owner: string;
    nftCollection: string;
    paymentToken: string;
    curve: CurveType;
    poolType: PoolType;
    spotPrice: number;
    delta: number;
    feeBps: number;
  }) => Promise<void>;
}) {
  const [owner, setOwner] = useState("");
  const [nftCollection, setNftCollection] = useState("");
  const [paymentToken, setPaymentToken] = useState("");
  const [curve, setCurve] = useState<CurveType>("Linear");
  const [poolType, setPoolType] = useState<PoolType>("Trade");
  const [spotXlm, setSpotXlm] = useState("");
  const [deltaInput, setDeltaInput] = useState("");
  const [feeBps, setFeeBps] = useState("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const spotPrice = Math.round(parseFloat(spotXlm) * 10_000_000);
    const delta =
      curve === "Linear"
        ? Math.round(parseFloat(deltaInput) * 10_000_000)
        : parseInt(deltaInput, 10);
    const fee = poolType === "Trade" ? parseInt(feeBps, 10) : 0;

    if (!owner.trim()) { setError("Owner address required"); return; }
    if (!nftCollection.trim()) { setError("NFT collection address required"); return; }
    if (!paymentToken.trim()) { setError("Payment token address required"); return; }
    if (!Number.isFinite(spotPrice) || spotPrice <= 0) { setError("Enter a valid spot price"); return; }
    if (!Number.isFinite(delta) || delta < 0) { setError("Enter a valid delta"); return; }

    setLoading(true);
    try {
      await onCreate({
        owner: owner.trim(),
        nftCollection: nftCollection.trim(),
        paymentToken: paymentToken.trim(),
        curve,
        poolType,
        spotPrice,
        delta,
        feeBps: fee,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pool-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl my-8">
        <h2
          id="create-pool-title"
          className="mb-5 flex items-center gap-2 text-lg font-semibold"
        >
          <Layers size={18} className="text-cyan-400" />
          Create NFT Pool
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {[
            { id: "owner", label: "Owner Address", value: owner, set: setOwner, placeholder: "G…" },
            { id: "nftCol", label: "NFT Collection Address", value: nftCollection, set: setNftCollection, placeholder: "C…" },
            { id: "payTok", label: "Payment Token Address", value: paymentToken, set: setPaymentToken, placeholder: "C…" },
          ].map(({ id, label, value, set, placeholder }) => (
            <div key={id}>
              <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-400">
                {label} <span aria-hidden="true" className="text-red-400">*</span>
              </label>
              <input
                id={id}
                type="text"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
                aria-required="true"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-cyan-500"
              />
            </div>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="curve" className="mb-1 block text-xs font-medium text-gray-400">
                Curve Type
              </label>
              <select
                id="curve"
                value={curve}
                onChange={(e) => setCurve(e.target.value as CurveType)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
              >
                {CURVE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="poolType" className="mb-1 block text-xs font-medium text-gray-400">
                Pool Type
              </label>
              <select
                id="poolType"
                value={poolType}
                onChange={(e) => setPoolType(e.target.value as PoolType)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
              >
                {POOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="spotPrice" className="mb-1 block text-xs font-medium text-gray-400">
                Spot Price (XLM) <span aria-hidden="true" className="text-red-400">*</span>
              </label>
              <input
                id="spotPrice"
                type="number"
                min="0.0000001"
                step="0.0000001"
                value={spotXlm}
                onChange={(e) => setSpotXlm(e.target.value)}
                placeholder="10"
                aria-required="true"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label htmlFor="delta" className="mb-1 block text-xs font-medium text-gray-400">
                Delta ({curve === "Linear" ? "XLM" : "bps e.g. 500=5%"})
              </label>
              <input
                id="delta"
                type="number"
                min="0"
                value={deltaInput}
                onChange={(e) => setDeltaInput(e.target.value)}
                placeholder={curve === "Linear" ? "1" : "500"}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {poolType === "Trade" && (
            <div>
              <label htmlFor="feeBps" className="mb-1 block text-xs font-medium text-gray-400">
                Pool Fee (bps, e.g. 100 = 1%)
              </label>
              <input
                id="feeBps"
                type="number"
                min="0"
                max="5000"
                value={feeBps}
                onChange={(e) => setFeeBps(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
              />
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {loading ? "Creating…" : "Create Pool"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NftAmmPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 1 });
  const [analytics, setAnalytics] = useState<CollectionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState("");
  const [filterCurve, setFilterCurve] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");

  // Demo user address
  const [userAddress, setUserAddress] = useState(
    "GUSER111111111111111111111111111111111111111111111111111111"
  );

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await apiFetch<Stats>("/stats");
    if (res.ok && res.data) setStats(res.data);
  }, []);

  const fetchPools = useCallback(async (page = 1) => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (filterType) params.set("poolType", filterType);
    if (filterCurve) params.set("curve", filterCurve);
    if (filterActive) params.set("active", filterActive);
    if (collectionSearch) params.set("collection", collectionSearch);

    try {
      const raw = await fetch(`${API_BASE}/api/nft-amm/pools?${params.toString()}`);
      const json = (await raw.json()) as { data?: Pool[]; pagination?: Pagination };
      if (json.data) setPools(json.data);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      // ignore
    }
  }, [filterType, filterCurve, filterActive, collectionSearch]);

  const fetchAnalytics = useCallback(async (collection: string) => {
    if (!collection) { setAnalytics(null); return; }
    const res = await apiFetch<CollectionAnalytics>(`/collections/${collection}/analytics`);
    if (res.ok && res.data) setAnalytics(res.data);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchPools(pagination.page)]);
    setLoading(false);
  }, [fetchStats, fetchPools, pagination.page]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    fetchPools(1);
  }, [filterType, filterCurve, filterActive, collectionSearch, fetchPools]);

  useEffect(() => {
    if (collectionSearch.length === 56) fetchAnalytics(collectionSearch);
    else setAnalytics(null);
  }, [collectionSearch, fetchAnalytics]);

  const handleCreatePool = async (data: Parameters<typeof apiFetch>[1] extends undefined ? never : {
    owner: string; nftCollection: string; paymentToken: string;
    curve: CurveType; poolType: PoolType; spotPrice: number; delta: number; feeBps: number;
  }) => {
    const res = await apiFetch<Pool>("/pools", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(res.error ?? "Creation failed");
    showToast("success", `Pool #${res.data?.id} created`);
    await refresh();
  };

  const handleBuy = async (poolId: number, maxPrice: number) => {
    const res = await apiFetch(`/pools/${poolId}/buy`, {
      method: "POST",
      body: JSON.stringify({ buyer: userAddress, maxPrice }),
    });
    if (!res.ok) showToast("error", res.error ?? "Buy failed");
    else {
      showToast("success", `NFT purchased from pool #${poolId}`);
      await refresh();
    }
  };

  const handleSell = async (poolId: number, nftId: number, minPrice: number) => {
    const res = await apiFetch(`/pools/${poolId}/sell`, {
      method: "POST",
      body: JSON.stringify({ seller: userAddress, nftId, minPrice }),
    });
    if (!res.ok) showToast("error", res.error ?? "Sell failed");
    else {
      showToast("success", `NFT #${nftId} sold to pool #${poolId}`);
      await refresh();
    }
  };

  const handleTogglePause = async () => {
    const res = await apiFetch("/admin/pause", {
      method: "POST",
      body: JSON.stringify({
        adminAddress: "GADMIN1111111111111111111111111111111111111111111111111111",
        paused: !stats?.paused,
      }),
    });
    if (!res.ok) showToast("error", res.error ?? "Failed");
    else {
      showToast("success", stats?.paused ? "AMM unpaused" : "AMM paused");
      await refresh();
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-gray-100">
            <BarChart3 size={32} className="text-cyan-400" />
            NFT AMM
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Automated Market Maker for NFTs with dynamic bonding curve pricing and collection analytics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleTogglePause}
            aria-label={stats?.paused ? "Unpause AMM" : "Pause AMM"}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors ${
              stats?.paused
                ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20"
                : "border-orange-600/40 bg-orange-600/10 text-orange-400 hover:bg-orange-600/20"
            }`}
          >
            {stats?.paused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
            {stats?.paused ? "Unpause" : "Pause"}
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            disabled={stats?.paused}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Create Pool
          </button>

          <button
            onClick={refresh}
            aria-label="Refresh"
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {stats?.paused && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4 text-sm text-orange-300">
          <PauseCircle size={18} className="shrink-0" />
          The NFT AMM is currently paused. Pool creation and trading are disabled.
        </div>
      )}

      <ToastBanner toast={toast} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Pools" value={stats?.totalPools ?? "—"} icon={<Layers size={22} />} />
        <StatCard
          label="Active Pools"
          value={stats?.activePools ?? "—"}
          icon={<Activity size={22} />}
          sub={`of ${stats?.totalPools ?? 0} total`}
        />
        <StatCard
          label="Total Volume"
          value={stats ? `${stroopsToXlm(stats.totalVolume)} XLM` : "—"}
          icon={<TrendingUp size={22} />}
        />
        <StatCard
          label="Total Trades"
          value={stats?.totalTrades ?? "—"}
          icon={<ShoppingCart size={22} />}
        />
      </div>

      {/* Pool type breakdown */}
      {stats?.byType && Object.keys(stats.byType).length > 0 && (
        <section aria-labelledby="breakdown-heading">
          <h2 id="breakdown-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Pool Distribution
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {POOL_TYPES.map((t) => (
              <div key={t} className={`rounded-xl border p-4 ${POOL_TYPE_COLORS[t]}`}>
                <p className="text-sm font-medium">{t}</p>
                <p className="mt-1 text-2xl font-bold">{stats.byType[t] ?? 0}</p>
                <p className="mt-0.5 text-xs opacity-70">pools</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Demo address */}
      <section aria-labelledby="demo-addr-heading" className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        <h2 id="demo-addr-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-400">
          <Wallet size={16} /> Your Address (for trading)
        </h2>
        <input
          type="text"
          value={userAddress}
          onChange={(e) => setUserAddress(e.target.value)}
          aria-label="Your Stellar address"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-xs text-gray-300 outline-none focus:border-cyan-500"
        />
      </section>

      {/* Filters */}
      <section aria-labelledby="filters-heading">
        <h2 id="filters-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
          <Filter size={14} /> Filters
        </h2>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Filter by pool type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 outline-none focus:border-cyan-500"
          >
            <option value="">All Types</option>
            {POOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            aria-label="Filter by curve"
            value={filterCurve}
            onChange={(e) => setFilterCurve(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 outline-none focus:border-cyan-500"
          >
            <option value="">All Curves</option>
            {CURVE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            aria-label="Filter by active status"
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 outline-none focus:border-cyan-500"
          >
            <option value="">All Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          <input
            type="text"
            value={collectionSearch}
            onChange={(e) => setCollectionSearch(e.target.value)}
            placeholder="Filter by collection address…"
            aria-label="Filter by collection address"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-cyan-500"
          />

          {(filterType || filterCurve || filterActive || collectionSearch) && (
            <button
              onClick={() => { setFilterType(""); setFilterCurve(""); setFilterActive(""); setCollectionSearch(""); }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Collection analytics */}
      {analytics && (
        <section aria-labelledby="analytics-heading" className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
          <h2 id="analytics-heading" className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-300">
            <BarChart3 size={16} className="text-cyan-400" />
            Collection Analytics — {shortAddr(analytics.collection)}
          </h2>
          <div className="grid gap-3 sm:grid-cols-4 mb-4">
            <div className="rounded-lg bg-gray-800/60 p-3 text-center">
              <p className="text-xs text-gray-500">Floor Price</p>
              <p className="mt-1 font-bold text-emerald-400">
                {analytics.floorPrice ? `${stroopsToXlm(analytics.floorPrice)} XLM` : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-gray-800/60 p-3 text-center">
              <p className="text-xs text-gray-500">Avg Trade</p>
              <p className="mt-1 font-bold text-gray-200">
                {stroopsToXlm(analytics.averageTradePrice)} XLM
              </p>
            </div>
            <div className="rounded-lg bg-gray-800/60 p-3 text-center">
              <p className="text-xs text-gray-500">Volume</p>
              <p className="mt-1 font-bold text-gray-200">
                {stroopsToXlm(analytics.totalVolume)} XLM
              </p>
            </div>
            <div className="rounded-lg bg-gray-800/60 p-3 text-center">
              <p className="text-xs text-gray-500">NFTs in Pools</p>
              <p className="mt-1 font-bold text-gray-200">{analytics.totalNftsInPools}</p>
            </div>
          </div>
          {analytics.recentTrades.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Recent Trades</p>
              <div className="space-y-1">
                {analytics.recentTrades.map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-gray-800/40 px-3 py-2 text-xs">
                    <span className={t.type === "buy" ? "text-emerald-400" : "text-orange-400"}>
                      {t.type === "buy" ? "↑ Buy" : "↓ Sell"} NFT #{t.nftId}
                    </span>
                    <span className="text-gray-400">{stroopsToXlm(t.price)} XLM</span>
                    <span className="text-gray-600">{new Date(t.ts).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Pools list */}
      <section aria-labelledby="pools-heading">
        <h2 id="pools-heading" className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Pools ({pagination.total})
        </h2>

        {loading && pools.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : pools.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-800 py-16 text-gray-500">
            <Layers size={32} />
            <p className="text-sm">No pools found.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={stats?.paused}
              className="mt-2 flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              <Plus size={14} /> Create the first pool
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {pools.map((p) => (
              <PoolCard
                key={p.id}
                pool={p}
                onBuy={handleBuy}
                onSell={handleSell}
                userAddress={userAddress}
              />
            ))}
          </div>
        )}

        {pagination.pages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => fetchPools(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => fetchPools(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </section>

      {showCreateModal && (
        <CreatePoolModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreatePool}
        />
      )}
    </main>
  );
}
