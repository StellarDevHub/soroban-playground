"use client";

import React, { useMemo, useState } from "react";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData,
} from "chart.js";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  TrendingDown,
  Flame,
  Info,
} from "lucide-react";

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
);

// ── Types & Math Utilities ───────────────────────────────────────────────────

export interface PositionData {
  id?: number | string;
  assetSymbol: string;
  collateral: number; // in USD
  minted: number; // minted synthetic units
  assetPrice: number; // USD price of 1 synthetic asset
  collateralPrice?: number; // USD price per unit of collateral (default 1)
  liquidationThreshold?: number; // default 120 (%)
  minCollateralRatio?: number; // default 150 (%)
  volatilityPct?: number; // default 25 (%)
}

export type HealthStatusType = "safe" | "warning" | "danger";

export interface HealthStatusConfig {
  status: HealthStatusType;
  label: string;
  hexColor: string;
  fillColor: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  description: string;
}

/**
 * Calculates Health Factor (HF).
 * In DeFi protocols: HF = (Collateral Value / (Debt Value * LiquidationThreshold))
 * normalized such that HF = 1.0 at the exact liquidation threshold.
 */
export function calculateHealthFactor(
  collateralUsd: number,
  debtUsd: number,
  liquidationThresholdPct: number = 120,
): number {
  if (debtUsd <= 0) return 999;
  if (collateralUsd <= 0) return 0;
  const ratio = (collateralUsd / debtUsd) * 100;
  return ratio / liquidationThresholdPct;
}

/**
 * Calculates the exact collateral value or price drop required to hit liquidation threshold.
 */
export function calculateLiquidationPrice(
  collateralUnits: number,
  mintedUnits: number,
  assetPrice: number,
  liquidationThresholdPct: number = 120,
): number {
  if (collateralUnits <= 0) return 0;
  const debtUsd = mintedUnits * assetPrice;
  return (debtUsd * (liquidationThresholdPct / 100)) / collateralUnits;
}

/**
 * Calculates percentage drop in collateral price before liquidation is triggered.
 */
export function calculateDropToLiquidation(
  currentRatio: number,
  liquidationThresholdPct: number = 120,
): number {
  if (currentRatio <= liquidationThresholdPct) return 0;
  return ((currentRatio - liquidationThresholdPct) / currentRatio) * 100;
}

/**
 * Maps Health Factor to color-coded badge & chart styling.
 * Transitions smoothly:
 * - Green (Safe): HF >= 1.5
 * - Amber (Warning): 1.0 <= HF < 1.5
 * - Red (Danger): HF < 1.0
 */
export function getHealthStatus(healthFactor: number): HealthStatusConfig {
  if (healthFactor >= 1.5) {
    return {
      status: "safe",
      label: "Safe",
      hexColor: "#10b981", // emerald-500
      fillColor: "rgba(16, 185, 129, 0.25)",
      badgeBg: "bg-emerald-500/10",
      badgeText: "text-emerald-400",
      badgeBorder: "border-emerald-500/30",
      description: "Collateral comfortably exceeds liquidation buffer.",
    };
  }

  if (healthFactor >= 1.0) {
    return {
      status: "warning",
      label: "Warning",
      hexColor: "#f59e0b", // amber-500
      fillColor: "rgba(245, 158, 11, 0.25)",
      badgeBg: "bg-amber-500/10",
      badgeText: "text-amber-400",
      badgeBorder: "border-amber-500/30",
      description: "Approaching liquidation margin. Top up collateral or burn debt.",
    };
  }

  return {
    status: "danger",
    label: "Danger",
    hexColor: "#f43f5e", // rose-500
    fillColor: "rgba(244, 63, 94, 0.35)",
    badgeBg: "bg-rose-500/10",
    badgeText: "text-rose-400",
    badgeBorder: "border-rose-500/30",
    description: "Position is below threshold and eligible for immediate liquidation!",
  };
}

const clamp = (val: number, min: number, max: number) =>
  Math.min(max, Math.max(min, val));

/**
 * Calculates 5 normalized risk axis scores (0–100 scale) for Radar Chart.
 */
export function calculateRadarAxes(
  collateralUsd: number,
  debtUsd: number,
  liquidationThresholdPct: number = 120,
  minRatioPct: number = 150,
  volatilityPct: number = 25,
) {
  const currentRatio = debtUsd > 0 ? (collateralUsd / debtUsd) * 100 : 300;
  const hf = calculateHealthFactor(collateralUsd, debtUsd, liquidationThresholdPct);
  const dropToLiq = calculateDropToLiquidation(currentRatio, liquidationThresholdPct);

  // 1. Collateral Buffer Score (0 at liquidation 120%, 100 at 300%+)
  const collateralBufferScore = clamp(
    ((currentRatio - liquidationThresholdPct) / (300 - liquidationThresholdPct)) * 100,
    0,
    100,
  );

  // 2. Health Factor Score (0 at HF <= 1.0, 100 at HF >= 2.5)
  const healthFactorScore = clamp(((hf - 1.0) / 1.5) * 100, 0, 100);

  // 3. Liquidation Cushion (0 if at/under liquidation, 100 if >= 50% drop needed)
  const liquidationCushionScore = clamp((dropToLiq / 50) * 100, 0, 100);

  // 4. Debt Safety (Capacity head room relative to min ratio 150%)
  const maxSafeDebt = collateralUsd / (minRatioPct / 100);
  const debtSafetyScore = clamp(
    debtUsd > 0 ? (1 - debtUsd / maxSafeDebt) * 100 : 100,
    0,
    100,
  );

  // 5. Volatility Resilience (Capacity to withstand 30d asset price swings)
  const volatilityResilienceScore = clamp(
    (dropToLiq / Math.max(10, volatilityPct * 1.5)) * 100,
    0,
    100,
  );

  return [
    collateralBufferScore,
    healthFactorScore,
    liquidationCushionScore,
    debtSafetyScore,
    volatilityResilienceScore,
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

export interface SyntheticPositionRadarProps {
  position?: PositionData;
  positions?: PositionData[];
  onSelectPosition?: (pos: PositionData) => void;
  className?: string;
}

export default function SyntheticPositionRadar({
  position,
  positions,
  onSelectPosition,
  className = "",
}: SyntheticPositionRadarProps) {
  // If a list of positions was provided, allow choosing active position
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activePosition: PositionData = useMemo(() => {
    if (positions && positions.length > 0) {
      return positions[selectedIndex] || positions[0];
    }
    return (
      position || {
        id: 1,
        assetSymbol: "sUSD",
        collateral: 360,
        minted: 2,
        assetPrice: 100,
        liquidationThreshold: 120,
        minCollateralRatio: 150,
        volatilityPct: 25,
      }
    );
  }, [position, positions, selectedIndex]);

  // Price shock slider state (0% to -60% drop in collateral price)
  const [priceShockPct, setPriceShockPct] = useState(0);

  const liquidationThreshold = activePosition.liquidationThreshold || 120;
  const minRatio = activePosition.minCollateralRatio || 150;
  const volatility = activePosition.volatilityPct || 25;

  const baseCollateralUsd = activePosition.collateral;
  const debtUsd = activePosition.minted * activePosition.assetPrice;

  // Under simulated shock
  const shockMultiplier = 1 + priceShockPct / 100;
  const shockedCollateralUsd = Math.max(0, baseCollateralUsd * shockMultiplier);

  // Baseline metrics
  const baseRatio = debtUsd > 0 ? (baseCollateralUsd / debtUsd) * 100 : 0;
  const baseHf = calculateHealthFactor(baseCollateralUsd, debtUsd, liquidationThreshold);
  const baseStatus = useMemo(() => getHealthStatus(baseHf), [baseHf]);
  const dropToLiq = calculateDropToLiquidation(baseRatio, liquidationThreshold);

  // Shocked metrics
  const shockedRatio = debtUsd > 0 ? (shockedCollateralUsd / debtUsd) * 100 : 0;
  const shockedHf = calculateHealthFactor(shockedCollateralUsd, debtUsd, liquidationThreshold);
  const shockedStatus = useMemo(() => getHealthStatus(shockedHf), [shockedHf]);
  const isLiquidatedUnderShock = shockedHf < 1.0;

  // Radar Axes
  const baseAxes = useMemo(
    () =>
      calculateRadarAxes(
        baseCollateralUsd,
        debtUsd,
        liquidationThreshold,
        minRatio,
        volatility,
      ),
    [baseCollateralUsd, debtUsd, liquidationThreshold, minRatio, volatility],
  );

  const shockedAxes = useMemo(
    () =>
      calculateRadarAxes(
        shockedCollateralUsd,
        debtUsd,
        liquidationThreshold,
        minRatio,
        volatility,
      ),
    [shockedCollateralUsd, debtUsd, liquidationThreshold, minRatio, volatility],
  );

  // Radar Chart Data
  const radarData: ChartData<"radar"> = useMemo(() => {
    const isShockActive = priceShockPct < 0;

    const datasets: ChartData<"radar">["datasets"] = [
      {
        label: isShockActive ? "Shocked Position Profile" : "Position Risk Profile",
        data: isShockActive ? shockedAxes : baseAxes,
        borderColor: isShockActive ? shockedStatus.hexColor : baseStatus.hexColor,
        backgroundColor: isShockActive ? shockedStatus.fillColor : baseStatus.fillColor,
        borderWidth: 2.5,
        pointBackgroundColor: isShockActive ? shockedStatus.hexColor : baseStatus.hexColor,
        pointBorderColor: "#fff",
        pointHoverBackgroundColor: "#fff",
        pointHoverBorderColor: isShockActive ? shockedStatus.hexColor : baseStatus.hexColor,
        pointRadius: 4,
      },
    ];

    if (isShockActive) {
      datasets.push({
        label: "Baseline (Pre-Shock)",
        data: baseAxes,
        borderColor: "rgba(148, 163, 184, 0.5)",
        backgroundColor: "transparent",
        borderDash: [4, 4],
        borderWidth: 1.5,
        pointRadius: 2,
      });
    }

    return {
      labels: [
        "Collateral Buffer",
        "Health Factor",
        "Liq. Cushion",
        "Debt Safety",
        "Volatility Tolerance",
      ],
      datasets,
    };
  }, [shockedAxes, baseAxes, shockedStatus, baseStatus, priceShockPct]);

  const radarOptions: ChartOptions<"radar"> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 25,
            display: false,
          },
          grid: {
            color: "rgba(51, 65, 85, 0.4)",
          },
          angleLines: {
            color: "rgba(51, 65, 85, 0.5)",
          },
          pointLabels: {
            color: "#94a3b8",
            font: {
              size: 11,
              family: "ui-sans-serif, system-ui",
            },
          },
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#94a3b8",
            boxWidth: 12,
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#94a3b8",
          borderColor: "#334155",
          borderWidth: 1,
          callbacks: {
            label(item) {
              return ` ${item.dataset.label}: ${Math.round(Number(item.raw))}/100`;
            },
          },
        },
      },
    };
  }, []);

  return (
    <div
      className={`rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl ${className}`}
      data-testid="synthetic-position-radar"
    >
      {/* Header and Position Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-white">
              Position Health Factor Radar
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                priceShockPct < 0 ? shockedStatus.badgeBg : baseStatus.badgeBg
              } ${priceShockPct < 0 ? shockedStatus.badgeText : baseStatus.badgeText} ${
                priceShockPct < 0 ? shockedStatus.badgeBorder : baseStatus.badgeBorder
              }`}
              data-testid="health-factor-badge"
            >
              {priceShockPct < 0 ? (
                shockedStatus.status === "safe" ? (
                  <ShieldCheck size={13} />
                ) : shockedStatus.status === "warning" ? (
                  <AlertTriangle size={13} />
                ) : (
                  <ShieldAlert size={13} />
                )
              ) : baseStatus.status === "safe" ? (
                <ShieldCheck size={13} />
              ) : baseStatus.status === "warning" ? (
                <AlertTriangle size={13} />
              ) : (
                <ShieldAlert size={13} />
              )}
              {priceShockPct < 0 ? shockedStatus.label : baseStatus.label}
              {" · "}
              {(priceShockPct < 0 ? shockedHf : baseHf).toFixed(2)} HF
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Multi-axis risk radar mapping collateralization, liquidation margin, and debt stress.
          </p>
        </div>

        {positions && positions.length > 1 ? (
          <div className="flex items-center gap-1.5">
            {positions.map((pos, idx) => (
              <button
                key={pos.id || idx}
                type="button"
                onClick={() => {
                  setSelectedIndex(idx);
                  onSelectPosition?.(pos);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-mono transition-colors ${
                  selectedIndex === idx
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                #{pos.id || idx + 1} {pos.assetSymbol}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Main Grid: Radar Chart + Risk Sliders & Metrics */}
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Radar Chart Display */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
          <div className="relative h-[280px] w-full max-w-[340px]">
            <Radar data={radarData} options={radarOptions} />
          </div>
          <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    priceShockPct < 0 ? shockedStatus.hexColor : baseStatus.hexColor,
                }}
              />
              {priceShockPct < 0 ? "Shocked State" : "Current Health"}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 border-t border-dashed border-slate-500" />
              Liq. Margin (120%)
            </span>
          </div>
        </div>

        {/* Risk Sliders & Stress Testing */}
        <div className="space-y-4">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] font-medium text-slate-400">Collateral Ratio</p>
              <p
                className={`mt-1 text-lg font-bold ${
                  priceShockPct < 0
                    ? shockedRatio < liquidationThreshold
                      ? "text-rose-400"
                      : shockedRatio < minRatio
                        ? "text-amber-400"
                        : "text-emerald-400"
                    : baseRatio < liquidationThreshold
                      ? "text-rose-400"
                      : baseRatio < minRatio
                        ? "text-amber-400"
                        : "text-emerald-400"
                }`}
              >
                {(priceShockPct < 0 ? shockedRatio : baseRatio).toFixed(1)}%
              </p>
              <p className="text-[10px] text-slate-500">
                Min {minRatio}% · Liq {liquidationThreshold}%
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] font-medium text-slate-400">Distance to Liq</p>
              <p
                className={`mt-1 text-lg font-bold ${
                  dropToLiq > 25
                    ? "text-emerald-400"
                    : dropToLiq > 10
                      ? "text-amber-400"
                      : "text-rose-400"
                }`}
              >
                {dropToLiq.toFixed(1)}%
              </p>
              <p className="text-[10px] text-slate-500">Max collateral drop</p>
            </div>
          </div>

          {/* Simulated Price Shock Slider */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <TrendingDown size={14} className="text-cyan-400" />
                Simulated Collateral Price Shock
              </span>
              <span className="font-mono text-xs font-bold text-amber-300">
                {priceShockPct}%
              </span>
            </div>

            <input
              type="range"
              min={-60}
              max={0}
              step={1}
              value={priceShockPct}
              onChange={(e) => setPriceShockPct(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-cyan-400"
              aria-label="Simulated Collateral Price Shock"
            />

            <div className="mt-2 flex justify-between text-[10px] font-mono text-slate-500">
              <span>0% (Current)</span>
              <span>−30% Drop</span>
              <span>−60% Crash</span>
            </div>

            {/* Quick Shock Buttons */}
            <div className="mt-2.5 flex gap-1.5">
              {[0, -10, -20, -35, -50].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPriceShockPct(s)}
                  className={`flex-1 rounded py-0.5 text-[10px] font-mono transition-colors ${
                    priceShockPct === s
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {s === 0 ? "Reset" : `${s}%`}
                </button>
              ))}
            </div>
          </div>

          {/* Instant Liquidation Warning Alert */}
          {isLiquidatedUnderShock ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
            >
              <Flame size={16} className="mt-0.5 shrink-0 text-rose-400" />
              <div>
                <strong className="block font-semibold text-rose-300">
                  Instant Liquidation Threshold Breached!
                </strong>
                Under a {priceShockPct}% price drop, position collateral falls to $
                {shockedCollateralUsd.toFixed(0)}, dropping ratio to{" "}
                {shockedRatio.toFixed(1)}% (below {liquidationThreshold}% threshold).
              </div>
            </div>
          ) : priceShockPct < 0 && shockedHf < 1.3 ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <strong className="block font-semibold text-amber-300">
                  Liquidation Warning Zone
                </strong>
                Position health drops to {shockedHf.toFixed(2)}. Only{" "}
                {calculateDropToLiquidation(shockedRatio, liquidationThreshold).toFixed(1)}%
                additional margin remains before liquidation.
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/30 p-2.5 text-[11px] text-slate-400">
              <Info size={14} className="mt-0.5 shrink-0 text-cyan-400" />
              <div>
                Drag the price shock slider to stress-test your position against adverse
                collateral fluctuations before minting or withdrawing.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
