"use client";

import React, { useState } from "react";
import {
  Flame,
  TrendingDown,
  DollarSign,
  BarChart3,
  Settings,
  Play,
  Pause,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BuybackConfig {
  tokenAddress: string;
  buybackBps: number;
  minBuybackAmount: number;
  maxBuybackAmount: number;
  frequencySeconds: number;
  paused: boolean;
}

export interface BuybackStats {
  totalPurchased: number;
  totalBurned: number;
  totalRevenueUsed: number;
  buybackCount: number;
  lastBuybackTimestamp: number;
}

export interface PurchaseRecord {
  id: number;
  amountSpent: number;
  tokensReceived: number;
  timestamp: number;
  executor: string;
}

export interface BurnRecord {
  id: number;
  tokensBurned: number;
  purchaseId: number;
  timestamp: number;
}

interface BuybackDashboardProps {
  contractId?: string;
  walletAddress?: string;
  config: BuybackConfig | null;
  stats: BuybackStats | null;
  treasuryBalance: number;
  purchaseHistory: PurchaseRecord[];
  burnHistory: BurnRecord[];
  isLoading: boolean;
  onExecuteBuyback: () => Promise<void>;
  onDepositRevenue: (amount: number) => Promise<void>;
  onUpdateConfig: (config: Partial<BuybackConfig>) => Promise<void>;
  onSetPaused: (paused: boolean) => Promise<void>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BuybackDashboard({
  contractId,
  walletAddress,
  config,
  stats,
  treasuryBalance,
  purchaseHistory,
  burnHistory,
  isLoading,
  onExecuteBuyback,
  onDepositRevenue,
  onUpdateConfig,
  onSetPaused,
}: BuybackDashboardProps) {
  const [tab, setTab] = useState<"overview" | "history" | "config">("overview");
  const [depositAmount, setDepositAmount] = useState("");
  const [showBurnHistory, setShowBurnHistory] = useState(false);

  // Config edit state
  const [editBps, setEditBps] = useState(String(config?.buybackBps ?? 500));
  const [editMin, setEditMin] = useState(String(config?.minBuybackAmount ?? 100));
  const [editMax, setEditMax] = useState(String(config?.maxBuybackAmount ?? 10000));
  const [editFreq, setEditFreq] = useState(String(config?.frequencySeconds ?? 3600));

  if (!contractId) {
    return (
      <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Flame size={16} className="text-orange-400" />
          Token Buyback Program
        </h3>
        <p className="text-xs text-gray-500 italic">
          Deploy the buyback contract to activate the deflationary program.
        </p>
      </div>
    );
  }

  const supplyReductionPct =
    stats && stats.totalPurchased > 0
      ? ((stats.totalBurned / stats.totalPurchased) * 100).toFixed(1)
      : "0.0";

  const nextBuybackIn =
    config && stats && stats.lastBuybackTimestamp > 0
      ? Math.max(
          0,
          stats.lastBuybackTimestamp + config.frequencySeconds - Math.floor(Date.now() / 1000)
        )
      : 0;

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) return;
    await onDepositRevenue(amt);
    setDepositAmount("");
  };

  const handleUpdateConfig = async () => {
    await onUpdateConfig({
      buybackBps: parseInt(editBps),
      minBuybackAmount: parseInt(editMin),
      maxBuybackAmount: parseInt(editMax),
      frequencySeconds: parseInt(editFreq),
    });
  };

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Flame size={16} className="text-orange-400" />
          Token Buyback Program
        </h3>
        <div className="flex items-center gap-2">
          {config && (
            <button
              onClick={() => onSetPaused(!config.paused)}
              disabled={isLoading}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                config.paused
                  ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/50 hover:bg-emerald-900/50"
                  : "bg-amber-900/30 text-amber-400 border-amber-800/50 hover:bg-amber-900/50"
              }`}
            >
              {config.paused ? <Play size={11} /> : <Pause size={11} />}
              {config.paused ? "Resume" : "Pause"}
            </button>
          )}
          {walletAddress && (
            <span className="text-xs text-gray-500 font-mono">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          )}
        </div>
      </div>

      {/* Paused banner */}
      {config?.paused && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded-lg">
          <Pause size={12} className="text-amber-400" />
          <span className="text-xs text-amber-300">Buyback program is paused</span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={<DollarSign size={14} className="text-emerald-400" />}
          label="Treasury"
          value={`${treasuryBalance.toLocaleString()} XLM`}
          sub="available for buybacks"
        />
        <StatCard
          icon={<Flame size={14} className="text-orange-400" />}
          label="Total Burned"
          value={(stats?.totalBurned ?? 0).toLocaleString()}
          sub="tokens removed from supply"
        />
        <StatCard
          icon={<TrendingDown size={14} className="text-violet-400" />}
          label="Supply Reduction"
          value={`${supplyReductionPct}%`}
          sub="burn verification rate"
        />
        <StatCard
          icon={<BarChart3 size={14} className="text-blue-400" />}
          label="Buyback Count"
          value={String(stats?.buybackCount ?? 0)}
          sub={`${((stats?.totalRevenueUsed ?? 0)).toLocaleString()} XLM used`}
        />
      </div>

      {/* Supply reduction bar */}
      {stats && stats.totalPurchased > 0 && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Supply reduction progress</span>
            <span>{supplyReductionPct}% burned</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-600 to-red-500 transition-all duration-500"
              style={{ width: `${Math.min(100, parseFloat(supplyReductionPct))}%` }}
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(["overview", "history", "config"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
              tab === t
                ? "bg-orange-600/20 text-orange-300 border border-orange-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* Execute buyback */}
          <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-300">Execute Buyback</p>
              {nextBuybackIn > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-gray-500">
                  <Clock size={10} />
                  Next in {formatDuration(nextBuybackIn)}
                </span>
              )}
            </div>
            {config && (
              <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                <span>Rate: {(config.buybackBps / 100).toFixed(1)}% of treasury</span>
                <span>
                  Range: {config.minBuybackAmount}–{config.maxBuybackAmount} XLM
                </span>
              </div>
            )}
            <button
              onClick={onExecuteBuyback}
              disabled={isLoading || config?.paused || nextBuybackIn > 0}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
            >
              {isLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Flame size={14} />
              )}
              {nextBuybackIn > 0 ? `Wait ${formatDuration(nextBuybackIn)}` : "Execute Buyback"}
            </button>
          </div>

          {/* Deposit revenue */}
          <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg space-y-2">
            <p className="text-xs font-medium text-gray-300">Deposit Revenue</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount in XLM"
                className={inputCls}
              />
              <button
                onClick={handleDeposit}
                disabled={isLoading || !depositAmount}
                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs rounded-md transition-colors disabled:opacity-40"
              >
                <Coins size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History tab */}
      {tab === "history" && (
        <div className="space-y-3">
          {/* Toggle between purchase and burn history */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowBurnHistory(false)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                !showBurnHistory
                  ? "bg-orange-600/20 text-orange-300 border border-orange-500/30"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              Purchases ({purchaseHistory.length})
            </button>
            <button
              onClick={() => setShowBurnHistory(true)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                showBurnHistory
                  ? "bg-red-600/20 text-red-300 border border-red-500/30"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              Burns ({burnHistory.length})
            </button>
          </div>

          {!showBurnHistory && (
            <div className="space-y-2">
              {purchaseHistory.length === 0 ? (
                <p className="text-xs text-gray-500 italic text-center py-4">
                  No purchases yet.
                </p>
              ) : (
                purchaseHistory.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs text-gray-300 font-mono">
                          #{p.id} — {p.amountSpent.toLocaleString()} XLM spent
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {p.tokensReceived.toLocaleString()} tokens received ·{" "}
                          {new Date(p.timestamp * 1000).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-800/50 rounded">
                        Purchased
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {showBurnHistory && (
            <div className="space-y-2">
              {burnHistory.length === 0 ? (
                <p className="text-xs text-gray-500 italic text-center py-4">
                  No burns yet.
                </p>
              ) : (
                burnHistory.map((b) => (
                  <div
                    key={b.id}
                    className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs text-gray-300 font-mono flex items-center gap-1">
                          <Flame size={11} className="text-orange-400" />
                          {b.tokensBurned.toLocaleString()} tokens burned
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          Purchase #{b.purchaseId} ·{" "}
                          {new Date(b.timestamp * 1000).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-900/30 text-red-400 border border-red-800/50 rounded">
                        Burned ✓
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Config tab */}
      {tab === "config" && (
        <div className="space-y-3">
          <Field label="Buyback Rate (basis points, e.g. 500 = 5%)">
            <input
              type="number"
              value={editBps}
              onChange={(e) => setEditBps(e.target.value)}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min Amount (XLM)">
              <input
                type="number"
                value={editMin}
                onChange={(e) => setEditMin(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Max Amount (XLM)">
              <input
                type="number"
                value={editMax}
                onChange={(e) => setEditMax(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Frequency (seconds between buybacks)">
            <input
              type="number"
              value={editFreq}
              onChange={(e) => setEditFreq(e.target.value)}
              className={inputCls}
            />
          </Field>
          <button
            onClick={handleUpdateConfig}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Settings size={14} />
            )}
            Update Configuration
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-md py-1.5 px-2 text-xs text-gray-200 focus:outline-none focus:border-orange-500 font-mono";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-semibold text-gray-200 font-mono">{value}</p>
      <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
