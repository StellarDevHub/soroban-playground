"use client";

import React from "react";
import { Coins, TrendingDown, TrendingUp, MinusCircle, Wallet } from "lucide-react";
import type { TreasuryImpactCalculation } from "@/lib/gov/types";

export interface TreasuryImpactVisualizerProps {
  impact: TreasuryImpactCalculation;
  className?: string;
}

export function TreasuryImpactVisualizer({
  impact,
  className = "",
}: TreasuryImpactVisualizerProps) {
  const isNegative = impact.netDiff < 0 || (impact.netDiff === 0 && impact.percentageChange < 0);
  const isPositive = impact.netDiff > 0 || (impact.netDiff === 0 && impact.percentageChange > 0);

  return (
    <div
      data-testid="treasury-impact-visualizer"
      className={`rounded-xl border border-slate-800 bg-slate-900/60 p-4 font-mono shadow-md ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Coins className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white tracking-wide">
              Simulated Treasury Impact
            </h4>
            <span className="text-[10px] text-slate-400">
              Protocol Reserve Vault Simulation
            </span>
          </div>
        </div>

        {/* Impact Type Badge */}
        <span
          data-testid="treasury-impact-badge"
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
            impact.impactType === "disbursal"
              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
              : impact.impactType === "fee_adjustment"
              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
              : "bg-slate-800 text-slate-300 border-slate-700"
          }`}
        >
          {impact.impactType}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
        {/* Baseline Balance */}
        <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/60">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Wallet className="h-3 w-3 text-slate-400" />
            Current Vault
          </span>
          <div className="mt-1 text-xs font-bold text-slate-200">
            {impact.currentTreasuryBalance.toLocaleString()}
            <span className="text-[10px] text-slate-500 font-normal"> XLM</span>
          </div>
        </div>

        {/* Net Delta */}
        <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/60">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            {isNegative ? (
              <TrendingDown className="h-3 w-3 text-rose-400" />
            ) : isPositive ? (
              <TrendingUp className="h-3 w-3 text-emerald-400" />
            ) : (
              <MinusCircle className="h-3 w-3 text-slate-400" />
            )}
            Net Execution Diff
          </span>
          <div
            data-testid="treasury-net-diff"
            className={`mt-1 text-xs font-bold ${
              isNegative
                ? "text-rose-400"
                : isPositive
                ? "text-emerald-400"
                : "text-slate-300"
            }`}
          >
            {impact.netDiff !== 0
              ? `${impact.netDiff > 0 ? "+" : ""}${impact.netDiff.toLocaleString()} XLM`
              : impact.percentageChange !== 0
              ? `${impact.percentageChange > 0 ? "+" : ""}${impact.percentageChange}%`
              : "0 XLM (Neutral)"}
          </div>
        </div>

        {/* Projected Post-Execution Balance */}
        <div className="rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/60">
          <span className="text-[10px] text-slate-400">Post-Execution</span>
          <div
            data-testid="treasury-projected-balance"
            className="mt-1 text-xs font-bold text-white"
          >
            {impact.projectedTreasuryBalance.toLocaleString()}
            <span className="text-[10px] text-slate-500 font-normal"> XLM</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="mt-3 rounded-lg bg-slate-950/40 p-2 border border-slate-800/40 text-[11px] text-slate-300 flex items-start gap-1.5">
        <span className="text-slate-500 mt-0.5">•</span>
        <span data-testid="treasury-impact-desc">{impact.description}</span>
      </div>
    </div>
  );
}

export default TreasuryImpactVisualizer;
