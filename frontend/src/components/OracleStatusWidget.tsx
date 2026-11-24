"use client";

import React, { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Radio,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  getOracleHealthStatus,
  calculatePriceDeviation,
  isDeviationAlert,
  OracleHealthStatus,
} from "@/hooks/useOracleStatus";

export interface OracleStatusWidgetProps {
  feedName?: string;
  assetPair?: string;
  oraclePrice?: number;
  spotPrice?: number;
  lastProofAt?: number | null;
  latencyMs?: number;
  toleranceThresholdPct?: number;
  className?: string;
}

export function OracleStatusWidget({
  feedName = "Stellar Core Testnet Oracle",
  assetPair = "XLM/USD",
  oraclePrice = 0.1184,
  spotPrice = 0.1180,
  lastProofAt = Date.now() - 25_000,
  latencyMs = 48,
  toleranceThresholdPct = 1.5,
  className = "",
}: OracleStatusWidgetProps) {
  const healthStatus: OracleHealthStatus = useMemo(
    () => getOracleHealthStatus(lastProofAt),
    [lastProofAt],
  );

  const deviationPct = useMemo(
    () => calculatePriceDeviation(oraclePrice, spotPrice),
    [oraclePrice, spotPrice],
  );

  const hasAlert = useMemo(
    () => isDeviationAlert(deviationPct, toleranceThresholdPct),
    [deviationPct, toleranceThresholdPct],
  );

  const healthBadgeConfig = useMemo(() => {
    switch (healthStatus) {
      case "active":
        return {
          label: "Active (< 60s)",
          badgeClass:
            "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
          dotClass: "bg-emerald-400 animate-pulse",
          icon: Wifi,
        };
      case "stale":
        return {
          label: "Stale (> 300s)",
          badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
          dotClass: "bg-amber-400",
          icon: Clock,
        };
      case "down":
      default:
        return {
          label: "Down (> 1800s)",
          badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/30",
          dotClass: "bg-rose-500",
          icon: WifiOff,
        };
    }
  }, [healthStatus]);

  const IconComponent = healthBadgeConfig.icon;

  return (
    <div
      data-testid="oracle-status-widget"
      className={`rounded-2xl border border-slate-800 bg-slate-900/90 p-5 font-mono shadow-xl backdrop-blur-md ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-wide">
              {feedName}
            </h3>
            <span className="text-[11px] text-slate-400">{assetPair} Feed</span>
          </div>
        </div>

        {/* Health Status Pill */}
        <div
          data-testid="oracle-health-pill"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${healthBadgeConfig.badgeClass}`}
        >
          <span className={`h-2 w-2 rounded-full ${healthBadgeConfig.dotClass}`} />
          <span>{healthBadgeConfig.label}</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4">
        {/* Latency */}
        <div className="rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Activity className="h-3 w-3 text-indigo-400" />
            Feed Latency
          </span>
          <div className="mt-1 text-sm font-bold text-white">
            {latencyMs}
            <span className="text-xs text-slate-400 font-normal"> ms</span>
          </div>
        </div>

        {/* Oracle Price */}
        <div className="rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
          <span className="text-[10px] text-slate-400">Oracle Price</span>
          <div className="mt-1 text-sm font-bold text-slate-100 font-mono">
            ${oraclePrice.toFixed(4)}
          </div>
        </div>

        {/* Spot Price */}
        <div className="rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
          <span className="text-[10px] text-slate-400">Spot Market</span>
          <div className="mt-1 text-sm font-bold text-slate-300 font-mono">
            ${spotPrice.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Price Deviation Bar */}
      <div className="mt-4 pt-3 border-t border-slate-800">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-slate-400 text-[11px]">Price Deviation</span>
          <span
            data-testid="price-deviation-badge"
            className={`font-bold flex items-center gap-1 ${
              hasAlert
                ? "text-rose-400"
                : deviationPct >= 0
                ? "text-emerald-400"
                : "text-blue-400"
            }`}
          >
            {deviationPct >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {deviationPct >= 0 ? `+${deviationPct}%` : `${deviationPct}%`}
          </span>
        </div>

        {/* Visual Deviation Gauge Bar */}
        <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
          <div
            className={`h-full transition-all duration-300 ${
              hasAlert ? "bg-rose-500" : "bg-indigo-500"
            }`}
            style={{
              width: `${Math.min(100, Math.max(10, Math.abs(deviationPct) * 30))}%`,
            }}
          />
        </div>
      </div>

      {/* Visual Alert Banner for Stale/High Deviation */}
      {hasAlert && (
        <div
          data-testid="deviation-alert-banner"
          className="mt-3.5 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>
            Warning: Price deviation exceeds safe threshold (±{toleranceThresholdPct}%).
            Verify contract execution slippage guard.
          </span>
        </div>
      )}
    </div>
  );
}
export default OracleStatusWidget;
