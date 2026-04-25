"use client";

import React, { useState, useMemo } from "react";
import { ArrowDownUp, Droplets, TrendingUp, Plus, Minus } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PoolData {
  reserveA: number;
  reserveB: number;
  totalLp: number;
  tokenALabel: string;
  tokenBLabel: string;
  feeBps: number;
  priceACum: number;
  priceBCum: number;
}

interface Props {
  contractId?: string;
  walletAddress?: string;
  pool: PoolData | null;
  lpBalance: number;
  isLoading: boolean;
  onSwap: (tokenIn: "A" | "B", amountIn: number, minOut: number) => Promise<void>;
  onAddLiquidity: (amountA: number, amountB: number, minLp: number) => Promise<void>;
  onRemoveLiquidity: (lpAmount: number, minA: number, minB: number) => Promise<void>;
}

const SLIPPAGE_OPTIONS = [0.5, 1, 3];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAmountOut(amountIn: number, ra: number, rb: number, feeBps: number): number {
  if (ra === 0 || rb === 0 || amountIn <= 0) return 0;
  const ff = 10_000 - feeBps;
  return Math.floor((amountIn * ff * rb) / (ra * 10_000 + amountIn * ff));
}

function priceImpact(amountIn: number, ra: number): number {
  if (ra === 0) return 0;
  return Math.min(99.9, (amountIn / (ra + amountIn)) * 100);
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AmmPoolPanel({
  contractId,
  walletAddress,
  pool,
  lpBalance,
  isLoading,
  onSwap,
  onAddLiquidity,
  onRemoveLiquidity,
}: Props) {
  const [tab, setTab] = useState<"swap" | "liquidity">("swap");

  // Swap state
  const [tokenIn, setTokenIn] = useState<"A" | "B">("A");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState(1);

  // Liquidity state
  const [liqTab, setLiqTab] = useState<"add" | "remove">("add");
  const [addA, setAddA] = useState("");
  const [addB, setAddB] = useState("");
  const [removeLp, setRemoveLp] = useState("");

  // Derived swap preview
  const swapPreview = useMemo(() => {
    if (!pool || !amountIn) return null;
    const ain = parseFloat(amountIn) || 0;
    const [ra, rb] = tokenIn === "A"
      ? [pool.reserveA, pool.reserveB]
      : [pool.reserveB, pool.reserveA];
    const out = getAmountOut(ain, ra, rb, pool.feeBps);
    const impact = priceImpact(ain, ra);
    const minOut = Math.floor(out * (1 - slippage / 100));
    return { out, impact, minOut };
  }, [pool, amountIn, tokenIn, slippage]);

  // Derived remove preview
  const removePreview = useMemo(() => {
    if (!pool || !removeLp || pool.totalLp === 0) return null;
    const lp = parseFloat(removeLp) || 0;
    const outA = Math.floor((lp * pool.reserveA) / pool.totalLp);
    const outB = Math.floor((lp * pool.reserveB) / pool.totalLp);
    return { outA, outB };
  }, [pool, removeLp]);

  const poolPrice = pool && pool.reserveA > 0
    ? (pool.reserveB / pool.reserveA).toFixed(6)
    : "—";

  const userShare = pool && pool.totalLp > 0
    ? ((lpBalance / pool.totalLp) * 100).toFixed(2)
    : "0.00";

  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowDownUp size={16} className="text-emerald-400" />
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            AMM Pool
          </p>
        </div>
        {pool && (
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{pool.tokenALabel}/{pool.tokenBLabel}</span>
            <span className="text-slate-400">1 {pool.tokenALabel} = {poolPrice} {pool.tokenBLabel}</span>
          </div>
        )}
      </div>

      {/* Pool stats */}
      {pool && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
          {[
            { label: `${pool.tokenALabel} Reserve`, value: fmt(pool.reserveA), color: "text-cyan-300" },
            { label: `${pool.tokenBLabel} Reserve`, value: fmt(pool.reserveB), color: "text-emerald-300" },
            { label: "Your Share", value: `${userShare}%`, color: "text-orange-300" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-white/8 bg-slate-950/50 p-2">
              <p className="text-slate-500">{label}</p>
              <p className={`mt-0.5 font-semibold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {(["swap", "liquidity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition capitalize ${
              tab === t
                ? "bg-emerald-400/20 text-emerald-200 border border-emerald-400/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Swap tab ── */}
      {tab === "swap" && (
        <div className="space-y-3">
          {/* Token direction toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Sell</span>
            <button
              onClick={() => setTokenIn((t) => (t === "A" ? "B" : "A"))}
              className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-emerald-400/30"
            >
              {pool ? (tokenIn === "A" ? pool.tokenALabel : pool.tokenBLabel) : "Token A"}
              <ArrowDownUp size={10} />
            </button>
          </div>

          <input
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="Amount in"
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
          />

          {/* Slippage */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Slippage:</span>
            {SLIPPAGE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                  slippage === s
                    ? "bg-emerald-400/20 text-emerald-200 border border-emerald-400/30"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {s}%
              </button>
            ))}
          </div>

          {/* Preview */}
          {swapPreview && (
            <div className="rounded-xl border border-white/8 bg-slate-950/50 p-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">You receive (est.)</span>
                <span className="text-emerald-300 font-semibold">{fmt(swapPreview.out)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Min received</span>
                <span className="text-slate-300">{fmt(swapPreview.minOut)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Price impact</span>
                <span className={swapPreview.impact > 5 ? "text-rose-400 font-semibold" : "text-slate-300"}>
                  {swapPreview.impact.toFixed(2)}%
                  {swapPreview.impact > 5 && " ⚠️"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Fee ({pool?.feeBps ?? 30} bps)</span>
                <span className="text-slate-400">
                  {fmt(((parseFloat(amountIn) || 0) * (pool?.feeBps ?? 30)) / 10_000)}
                </span>
              </div>
            </div>
          )}

          <button
            disabled={isLoading || !contractId || !swapPreview || swapPreview.out === 0}
            onClick={() => {
              if (!swapPreview) return;
              onSwap(tokenIn, parseFloat(amountIn) || 0, swapPreview.minOut);
              setAmountIn("");
            }}
            className="w-full rounded-full border border-emerald-400/30 bg-emerald-400/10 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-40"
          >
            Swap
          </button>
        </div>
      )}

      {/* ── Liquidity tab ── */}
      {tab === "liquidity" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["add", "remove"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setLiqTab(t)}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition capitalize ${
                  liqTab === t
                    ? "bg-cyan-400/20 text-cyan-200 border border-cyan-400/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t === "add" ? <Plus size={10} /> : <Minus size={10} />}
                {t}
              </button>
            ))}
          </div>

          {liqTab === "add" && (
            <>
              <div className="flex gap-2">
                <input
                  value={addA}
                  onChange={(e) => setAddA(e.target.value)}
                  placeholder={`${pool?.tokenALabel ?? "Token A"} amount`}
                  className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
                />
                <input
                  value={addB}
                  onChange={(e) => setAddB(e.target.value)}
                  placeholder={`${pool?.tokenBLabel ?? "Token B"} amount`}
                  className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
                />
              </div>
              <button
                disabled={isLoading || !contractId || !addA || !addB}
                onClick={() => {
                  onAddLiquidity(parseFloat(addA) || 0, parseFloat(addB) || 0, 1);
                  setAddA(""); setAddB("");
                }}
                className="w-full rounded-full border border-cyan-400/30 bg-cyan-400/10 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-40"
              >
                <Droplets size={12} className="inline mr-1" />
                Add Liquidity
              </button>
            </>
          )}

          {liqTab === "remove" && (
            <>
              <div className="text-xs text-slate-500 mb-1">
                Your LP balance: <span className="text-slate-300">{fmt(lpBalance)}</span>
              </div>
              <input
                value={removeLp}
                onChange={(e) => setRemoveLp(e.target.value)}
                placeholder="LP tokens to burn"
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
              />
              {removePreview && (
                <div className="rounded-xl border border-white/8 bg-slate-950/50 p-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">You receive {pool?.tokenALabel}</span>
                    <span className="text-cyan-300">{fmt(removePreview.outA)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">You receive {pool?.tokenBLabel}</span>
                    <span className="text-emerald-300">{fmt(removePreview.outB)}</span>
                  </div>
                </div>
              )}
              <button
                disabled={isLoading || !contractId || !removeLp || !removePreview}
                onClick={() => {
                  if (!removePreview) return;
                  onRemoveLiquidity(
                    parseFloat(removeLp) || 0,
                    Math.floor(removePreview.outA * 0.99),
                    Math.floor(removePreview.outB * 0.99),
                  );
                  setRemoveLp("");
                }}
                className="w-full rounded-full border border-rose-400/30 bg-rose-400/10 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-40"
              >
                <TrendingUp size={12} className="inline mr-1" />
                Remove Liquidity
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
