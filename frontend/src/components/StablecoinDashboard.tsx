"use client";

import React, { useState, useEffect } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import {
  DollarSign,
  Wallet,
  Activity,
  Shield,
  Play,
  Pause,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  History,
  Users,
  Database,
} from "lucide-react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StablecoinMetrics {
  totalSupply: string;
  totalReserve: string;
  collateralizationRatio: number;
  currentPrice: number;
  targetPrice: number;
  priceDeviation: number;
  lastRebase: string;
  rebaseCount: number;
  holders: number;
  volume24h: string;
  marketCap: string;
}

export interface PricePoint {
  price: number;
  target_price: number;
  timestamp: string;
}

export interface RebaseInfo {
  old_supply: string;
  new_supply: string;
  price: number;
  timestamp: string;
}

export interface ReserveAsset {
  asset: string;
  amount: string;
  value: string;
}

export interface ReserveInfo {
  totalReserve: string;
  targetReserve: string;
  reserveRatio: number;
  assets: ReserveAsset[];
  lastUpdated: string;
}

export interface ContractStatus {
  initialized: boolean;
  paused: boolean;
  contractId: string | null;
  targetPrice: string;
  rebaseCooldown: number;
  lastRebase: string;
  nextRebase: string;
}

interface Props {
  contractId?: string;
  walletAddress?: string;
  isAdmin?: boolean;
  isOracle?: boolean;
  metrics?: StablecoinMetrics;
  priceHistory?: PricePoint[];
  rebaseHistory?: RebaseInfo[];
  reserveInfo?: ReserveInfo;
  contractStatus?: ContractStatus;
  isLoading?: boolean;
  onRebase?: () => Promise<void>;
  onPause?: () => Promise<void>;
  onUnpause?: () => Promise<void>;
  onUpdatePrice?: (price: number) => Promise<void>;
  onAddReserve?: (amount: string) => Promise<void>;
  onWithdrawReserve?: (amount: string) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNumber(value: string | number, decimals = 2): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCurrency(value: string | number): string {
  return "$" + formatNumber(value, 2);
}

function shortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StablecoinDashboard({
  contractId,
  walletAddress,
  isAdmin = false,
  isOracle = false,
  metrics,
  priceHistory,
  rebaseHistory,
  reserveInfo,
  contractStatus,
  isLoading = false,
  onRebase,
  onPause,
  onUnpause,
  onUpdatePrice,
  onAddReserve,
  onWithdrawReserve,
}: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "reserve" | "history" | "admin">("overview");
  const [newPrice, setNewPrice] = useState("");
  const [reserveAmount, setReserveAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  // Default mock data if props not provided
  const defaultMetrics: StablecoinMetrics = {
    totalSupply: "1000000000000",
    totalReserve: "950000000000",
    collateralizationRatio: 0.95,
    currentPrice: 1.0,
    targetPrice: 1.0,
    priceDeviation: 0,
    lastRebase: new Date(Date.now() - 3600000).toISOString(),
    rebaseCount: 24,
    holders: 1543,
    volume24h: "50000000000",
    marketCap: "1000000000000",
  };

  const displayMetrics = metrics || defaultMetrics;

  // Price chart data
  const chartData = {
    labels: priceHistory?.map((p) => shortDate(p.timestamp)) || ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],
    datasets: [
      {
        label: "Price",
        data: priceHistory?.map((p) => p.price / 10000000) || [1.0, 1.01, 0.99, 1.0, 1.0],
        borderColor: "rgb(6, 182, 212)",
        backgroundColor: "rgba(6, 182, 212, 0.1)",
        tension: 0.4,
      },
      {
        label: "Target",
        data: priceHistory?.map(() => 1.0) || [1.0, 1.0, 1.0, 1.0, 1.0],
        borderColor: "rgb(16, 185, 129)",
        borderDash: [5, 5],
        tension: 0,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: "top" as const },
      title: { display: true, text: "Price History (30 days)" },
    },
    scales: {
      y: {
        beginAtZero: false,
        min: 0.95,
        max: 1.05,
      },
    },
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-cyan-500/20 rounded-lg">
            <DollarSign className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Stablecoin Dashboard</h1>
            <p className="text-sm text-slate-400">
              Algorithmic stability mechanism with reserve backing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contractStatus?.paused ? (
            <span className="px-3 py-1 bg-rose-500/20 text-rose-400 rounded-full text-sm font-medium">
              <Pause className="inline w-4 h-4 mr-1" />
              Paused
            </span>
          ) : (
            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-sm font-medium">
              <Play className="inline w-4 h-4 mr-1" />
              Active
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-800 p-1 rounded-lg">
        {[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "reserve", label: "Reserve", icon: Database },
          { id: "history", label: "History", icon: History },
          ...(isAdmin ? [{ id: "admin", label: "Admin", icon: Shield }] : []),
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === id
                ? "bg-cyan-500/20 text-cyan-400"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <Wallet className="w-4 h-4" />
                <span className="text-sm">Total Supply</span>
              </div>
              <p className="text-xl font-bold">{formatCurrency(displayMetrics.totalSupply)}</p>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <DollarSign className="w-4 h-4" />
                <span className="text-sm">Current Price</span>
              </div>
              <p className="text-xl font-bold">{formatCurrency(displayMetrics.currentPrice)}</p>
              {displayMetrics.priceDeviation !== 0 && (
                <span
                  className={`text-xs ${
                    displayMetrics.priceDeviation > 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {displayMetrics.priceDeviation > 0 ? "+" : ""}
                  {(displayMetrics.priceDeviation * 100).toFixed(2)}%
                </span>
              )}
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <Shield className="w-4 h-4" />
                <span className="text-sm">Collateral Ratio</span>
              </div>
              <p className="text-xl font-bold">{(displayMetrics.collateralizationRatio * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <Users className="w-4 h-4" />
                <span className="text-sm">Holders</span>
              </div>
              <p className="text-xl font-bold">{displayMetrics.holders.toLocaleString()}</p>
            </div>
          </div>

          {/* Price Chart */}
          <div className="bg-slate-800 p-4 rounded-lg">
            <div className="h-64">
              <Line data={chartData} options={chartOptions} />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-4">
            {isOracle && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.0001"
                  placeholder="New price"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => onUpdatePrice?.(parseFloat(newPrice))}
                  disabled={isLoading || !newPrice}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-600 rounded-md text-sm font-medium transition-colors"
                >
                  Update Price
                </button>
              </div>
            )}
            <button
              onClick={onRebase}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 rounded-md text-sm font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Trigger Rebase
            </button>
          </div>
        </div>
      )}

      {/* Reserve Tab */}
      {activeTab === "reserve" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800 p-4 rounded-lg">
              <p className="text-sm text-slate-400 mb-1">Total Reserve</p>
              <p className="text-2xl font-bold">{formatCurrency(reserveInfo?.totalReserve || "950000000000")}</p>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <p className="text-sm text-slate-400 mb-1">Target Reserve</p>
              <p className="text-2xl font-bold">{formatCurrency(reserveInfo?.targetReserve || "1000000000000")}</p>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <p className="text-sm text-slate-400 mb-1">Reserve Ratio</p>
              <p className="text-2xl font-bold">{((reserveInfo?.reserveRatio || 0.95) * 100).toFixed(1)}%</p>
            </div>
          </div>

          {/* Asset Breakdown */}
          <div className="bg-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-700 font-medium">Reserve Assets</div>
            <div className="divide-y divide-slate-700">
              {(reserveInfo?.assets || [
                { asset: "XLM", amount: "400000000000", value: "400000000000" },
                { asset: "USDC", amount: "300000000000", value: "300000000000" },
                { asset: "BTC", amount: "8333", value: "250000000000" },
              ]).map((asset) => (
                <div key={asset.asset} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center font-bold text-sm">
                      {asset.asset[0]}
                    </div>
                    <div>
                      <p className="font-medium">{asset.asset}</p>
                      <p className="text-sm text-slate-400">{formatNumber(asset.amount)} tokens</p>
                    </div>
                  </div>
                  <p className="font-medium">{formatCurrency(asset.value)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-700 font-medium">Recent Rebase Events</div>
            <div className="divide-y divide-slate-700">
              {(rebaseHistory?.slice(0, 5) || []).map((rebase, idx) => (
                <div key={idx} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        parseInt(rebase.new_supply) > parseInt(rebase.old_supply)
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-rose-500/20 text-rose-400"
                      }`}
                    >
                      {parseInt(rebase.new_supply) > parseInt(rebase.old_supply) ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">
                        {parseInt(rebase.new_supply) > parseInt(rebase.old_supply) ? "Expansion" : "Contraction"}
                      </p>
                      <p className="text-sm text-slate-400">{new Date(rebase.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatNumber(rebase.new_supply)}</p>
                    <p className="text-xs text-slate-400">
                      was {formatNumber(rebase.old_supply)}
                    </p>
                  </div>
                </div>
              ))}
              {(!rebaseHistory || rebaseHistory.length === 0) && (
                <div className="px-4 py-8 text-center text-slate-400">No rebase events found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Tab */}
      {activeTab === "admin" && isAdmin && (
        <div className="space-y-6">
          {/* Contract Controls */}
          <div className="bg-slate-800 p-4 rounded-lg">
            <h3 className="font-medium mb-4">Contract Controls</h3>
            <div className="flex gap-4">
              {contractStatus?.paused ? (
                <button
                  onClick={onUnpause}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 rounded-md text-sm font-medium transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Unpause Contract
                </button>
              ) : (
                <button
                  onClick={onPause}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-600 rounded-md text-sm font-medium transition-colors"
                >
                  <Pause className="w-4 h-4" />
                  Pause Contract
                </button>
              )}
            </div>
          </div>

          {/* Reserve Management */}
          <div className="bg-slate-800 p-4 rounded-lg">
            <h3 className="font-medium mb-4">Reserve Management</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Add Reserve</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={reserveAmount}
                    onChange={(e) => setReserveAmount(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={() => onAddReserve?.(reserveAmount)}
                    disabled={isLoading || !reserveAmount}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 rounded-md text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Withdraw Reserve</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={() => onWithdrawReserve?.(withdrawAmount)}
                    disabled={isLoading || !withdrawAmount}
                    className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-600 rounded-md text-sm font-medium transition-colors"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Contract Info */}
          <div className="bg-slate-800 p-4 rounded-lg">
            <h3 className="font-medium mb-4">Contract Information</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Contract ID</span>
                <span className="font-mono">{contractId || "Not deployed"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Target Price</span>
                <span>{contractStatus?.targetPrice || "$1.00"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Rebase Cooldown</span>
                <span>{contractStatus?.rebaseCooldown || 3600}s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last Rebase</span>
                <span>
                  {contractStatus?.lastRebase
                    ? new Date(contractStatus.lastRebase).toLocaleString()
                    : "Never"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
