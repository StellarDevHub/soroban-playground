"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  BarChart2,
  CheckCircle2,
  GitBranch,
  Layers,
  RefreshCw,
  Zap,
} from "lucide-react";

export interface PoolData {
  id: number;
  name: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  feeBps: number;
  isActive: boolean;
  totalVolume: number;
  swapCount: number;
}

export interface QuoteData {
  poolId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  feeBps: number;
  priceImpactBps: number;
}

export interface RouteHopData {
  poolId: number;
  tokenIn: string;
  tokenOut: string;
}

export interface SwapResultData {
  amountIn: number;
  amountOut: number;
  hops: RouteHopData[];
  totalFeeBps: number;
  priceImpactBps: number;
}

interface DexAggregatorPanelProps {
  contractId?: string;
  pools: PoolData[];
  isLoading: boolean;
  onAddPool: (params: {
    name: string;
    tokenA: string;
    tokenB: string;
    reserveA: number;
    reserveB: number;
    feeBps: number;
  }) => Promise<void>;
  onGetQuotes: (tokenIn: string, tokenOut: string, amountIn: number) => Promise<QuoteData[]>;
  onSwapBestRoute: (params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    minAmountOut: number;
  }) => Promise<SwapResultData | null>;
}

const TOKENS = ["USDC", "XLM", "ETH", "BTC", "USDT"];

function bpsToPercent(bps: number) {
  return (bps / 100).toFixed(2) + "%";
}

export default function DexAggregatorPanel({
  contractId,
  pools,
  isLoading,
  onAddPool,
  onGetQuotes,
  onSwapBestRoute,
}: DexAggregatorPanelProps) {
  // Add pool form
  const [poolName, setPoolName] = useState("");
  const [tokenA, setTokenA] = useState("USDC");
  const [tokenB, setTokenB] = useState("XLM");
  const [reserveA, setReserveA] = useState("");
  const [reserveB, setReserveB] = useState("");
  const [feeBps, setFeeBps] = useState("30");

  // Swap form
  const [swapIn, setSwapIn] = useState("USDC");
  const [swapOut, setSwapOut] = useState("XLM");
  const [swapAmount, setSwapAmount] = useState("");
  const [slippage, setSlippage] = useState("1");

  // State
  const [quotes, setQuotes] = useState<QuoteData[]>([]);
  const [lastSwap, setLastSwap] = useState<SwapResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(false);

  const handleAddPool = async () => {
    setError(null);
    if (!poolName) return setError("Pool name is required.");
    if (tokenA === tokenB) return setError("Token A and B must differ.");
    const rA = parseFloat(reserveA);
    const rB = parseFloat(reserveB);
    if (!rA || rA <= 0 || !rB || rB <= 0) return setError("Reserves must be > 0.");
    const fee = parseInt(feeBps);
    if (isNaN(fee) || fee > 1000) return setError("Fee must be 0–1000 bps.");
    if (!contractId) return setError("Deploy a contract first.");
    try {
      await onAddPool({
        name: poolName,
        tokenA,
        tokenB,
        reserveA: Math.floor(rA * 1e7),
        reserveB: Math.floor(rB * 1e7),
        feeBps: fee,
      });
      setPoolName("");
      setReserveA("");
      setReserveB("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add pool failed.");
    }
  };

  const handleGetQuotes = async () => {
    setError(null);
    const amt = parseFloat(swapAmount);
    if (!amt || amt <= 0) return setError("Amount must be > 0.");
    if (!contractId) return setError("Deploy a contract first.");
    setQuotesLoading(true);
    try {
      const q = await onGetQuotes(swapIn, swapOut, Math.floor(amt * 1e7));
      setQuotes(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Get quotes failed.");
    } finally {
      setQuotesLoading(false);
    }
  };

  const handleSwap = async () => {
    setError(null);
    const amt = parseFloat(swapAmount);
    if (!amt || amt <= 0) return setError("Amount must be > 0.");
    if (!contractId) return setError("Deploy a contract first.");
    const slip = parseFloat(slippage) / 100;
    const bestQuote = quotes.sort((a, b) => b.amountOut - a.amountOut)[0];
    const minOut = bestQuote
      ? Math.floor(bestQuote.amountOut * (1 - slip))
      : 1;
    try {
      const result = await onSwapBestRoute({
        tokenIn: swapIn,
        tokenOut: swapOut,
        amountIn: Math.floor(amt * 1e7),
        minAmountOut: minOut,
      });
      setLastSwap(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Pool stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Pools", value: pools.length },
          { label: "Active Pools", value: pools.filter((p) => p.isActive).length },
          {
            label: "Total Swaps",
            value: pools.reduce((s, p) => s + p.swapCount, 0),
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className="mt-1 font-mono text-sm text-violet-300">{value}</p>
          </div>
        ))}
      </div>

      {/* Add pool */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-300">
          <Layers size={14} className="text-violet-400" />
          Register Pool (Admin)
        </h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Pool Name
            </label>
            <input
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              placeholder="USDC/XLM AMM"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Token A
            </label>
            <select
              value={tokenA}
              onChange={(e) => setTokenA(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-violet-500 focus:outline-none"
            >
              {TOKENS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Token B
            </label>
            <select
              value={tokenB}
              onChange={(e) => setTokenB(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-violet-500 focus:outline-none"
            >
              {TOKENS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Fee (bps)
            </label>
            <input
              type="number"
              min="0"
              max="1000"
              value={feeBps}
              onChange={(e) => setFeeBps(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Reserve A
            </label>
            <input
              type="number"
              min="0"
              value={reserveA}
              onChange={(e) => setReserveA(e.target.value)}
              placeholder="1000000"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Reserve B
            </label>
            <input
              type="number"
              min="0"
              value={reserveB}
              onChange={(e) => setReserveB(e.target.value)}
              placeholder="5000000"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleAddPool}
          disabled={isLoading || !contractId}
          className="mt-3 flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-600/20 px-4 py-2 text-sm font-medium text-violet-300 transition hover:bg-violet-600/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Layers size={14} />
          Add Pool
        </button>
      </div>

      {/* Swap */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-300">
          <Zap size={14} className="text-yellow-400" />
          Swap
        </h4>
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              From
            </label>
            <select
              value={swapIn}
              onChange={(e) => setSwapIn(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-yellow-500 focus:outline-none"
            >
              {TOKENS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              To
            </label>
            <select
              value={swapOut}
              onChange={(e) => setSwapOut(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-yellow-500 focus:outline-none"
            >
              {TOKENS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Amount
            </label>
            <input
              type="number"
              min="0"
              value={swapAmount}
              onChange={(e) => setSwapAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Slippage %
            </label>
            <input
              type="number"
              min="0"
              max="50"
              step="0.1"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-yellow-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleGetQuotes}
            disabled={quotesLoading || !contractId}
            className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600/20 px-4 py-2 text-sm font-medium text-blue-300 transition hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {quotesLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-blue-400" />
            ) : (
              <BarChart2 size={14} />
            )}
            Get Quotes
          </button>
          <button
            onClick={handleSwap}
            disabled={isLoading || !contractId}
            className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-600/20 px-4 py-2 text-sm font-medium text-yellow-300 transition hover:bg-yellow-600/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Zap size={14} />
            Swap Best Route
          </button>
        </div>

        {/* Quotes */}
        {quotes.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Quotes ({quotes.length})
            </p>
            {quotes
              .slice()
              .sort((a, b) => b.amountOut - a.amountOut)
              .map((q, i) => (
                <div
                  key={q.poolId}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    i === 0
                      ? "border-yellow-700/40 bg-yellow-900/20 text-yellow-200"
                      : "border-gray-800 bg-gray-950 text-gray-400"
                  }`}
                >
                  <span>Pool #{q.poolId}</span>
                  <span className="font-mono">
                    {q.amountOut.toLocaleString()} {q.tokenOut}
                  </span>
                  <span>Fee: {bpsToPercent(q.feeBps)}</span>
                  <span>Impact: {bpsToPercent(q.priceImpactBps)}</span>
                  {i === 0 && (
                    <span className="rounded-full bg-yellow-600/30 px-1.5 py-0.5 text-[10px] text-yellow-300">
                      Best
                    </span>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* Last swap result */}
        {lastSwap && (
          <div className="mt-3 rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 size={14} />
              Swap executed
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-gray-400">
              <span>In: {lastSwap.amountIn.toLocaleString()}</span>
              <span>Out: {lastSwap.amountOut.toLocaleString()}</span>
              <span>Fee: {bpsToPercent(lastSwap.totalFeeBps)}</span>
              <span>Impact: {bpsToPercent(lastSwap.priceImpactBps)}</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-500">
              <GitBranch size={11} />
              Route:
              {lastSwap.hops.map((h, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 && <ArrowDown size={10} />}
                  Pool #{h.poolId} ({h.tokenIn}→{h.tokenOut})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Pool list */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-300">
          Registered Pools ({pools.length})
        </h4>
        {pools.length === 0 ? (
          <p className="text-xs text-gray-600">No pools registered yet.</p>
        ) : (
          <div className="space-y-2">
            {pools.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-gray-800 bg-gray-950 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-200">{p.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      p.isActive
                        ? "border-emerald-700/40 bg-emerald-900/30 text-emerald-300"
                        : "border-gray-700/40 bg-gray-800 text-gray-500"
                    }`}
                  >
                    {p.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-x-4 text-[10px] text-gray-500">
                  <span>
                    {p.tokenA}/{p.tokenB}
                  </span>
                  <span>Fee: {bpsToPercent(p.feeBps)}</span>
                  <span>Swaps: {p.swapCount}</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 font-mono text-[10px] text-gray-600">
                  <span>R_A: {p.reserveA.toLocaleString()}</span>
                  <span>R_B: {p.reserveB.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
