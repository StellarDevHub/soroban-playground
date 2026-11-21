"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, ShieldAlert, TrendingDown } from "lucide-react";

export interface SyntheticPositionRadarProps {
  positionId: number;
  assetSymbol: string;
  collateral: number; // in USD (or base collateral asset value)
  minted: number; // amount of synthetic asset minted
  assetPrice: number; // synthetic asset price in USD
  liquidationThreshold?: number; // default: 120 (%)
  minCollateralRatio?: number; // default: 150 (%)
  className?: string;
  onShockChange?: (shockPct: number) => void;
}

export type HealthStatus = "safe" | "warning" | "danger";

export function calculatePositionMetrics({
  collateral,
  minted,
  assetPrice,
  shockPct = 0,
  liquidationThreshold = 120,
  minCollateralRatio = 150,
}: {
  collateral: number;
  minted: number;
  assetPrice: number;
  shockPct?: number;
  liquidationThreshold?: number;
  minCollateralRatio?: number;
}) {
  const debtValue = minted * assetPrice;
  if (debtValue <= 0 || collateral <= 0) {
    return {
      collateralRatio: 0,
      healthFactor: 0,
      status: "danger" as HealthStatus,
      liquidationDropThresholdPct: 0,
      isLiquidatable: true,
      shockedCollateralRatio: 0,
      shockedHealthFactor: 0,
      radarValues: [0, 0, 0, 0, 0],
    };
  }

  // Baseline Collateral Ratio (%)
  const baseCr = (collateral / debtValue) * 100;
  // Price-shocked Collateral Ratio (%)
  const shockedCollateral = collateral * (1 + shockPct / 100);
  const shockedCr = (shockedCollateral / debtValue) * 100;

  // Health Factor: HF = CR / Liquidation Threshold
  const healthFactor = shockedCr / liquidationThreshold;

  // Maximum price drop collateral can withstand before hitting liquidation threshold:
  // (collateral * (1 + drop)) / debtValue * 100 = liquidationThreshold
  // 1 + drop = (liquidationThreshold * debtValue) / (collateral * 100)
  const maxDropRatio = (liquidationThreshold * debtValue) / (collateral * 100) - 1;
  const liquidationDropThresholdPct = maxDropRatio * 100; // e.g. -35%

  let status: HealthStatus = "safe";
  if (healthFactor <= 1.0) {
    status = "danger";
  } else if (healthFactor < minCollateralRatio / liquidationThreshold) {
    // Between 1.0 and 1.25 (e.g. 150 / 120)
    status = "warning";
  } else {
    status = "safe";
  }

  // Multi-axis normalized radar metrics [0.0 - 1.0]:
  // 1. Collateralization Score: 100% at 200% CR
  const axisCr = Math.min(1, Math.max(0, shockedCr / 250));
  // 2. Health Factor Score: 100% at HF = 2.0
  const axisHf = Math.min(1, Math.max(0, healthFactor / 2.0));
  // 3. Liquidation Proximity Margin Score: higher is safer (0 if already liquidatable)
  const axisMargin = Math.min(1, Math.max(0, (shockedCr - liquidationThreshold) / 100));
  // 4. Volatility Resilience: tolerance to a -30% shock
  const axisResilience = Math.min(1, Math.max(0, (liquidationDropThresholdPct < -30 ? 1 : Math.max(0, (liquidationDropThresholdPct + 50) / 20))));
  // 5. Debt Safety Ratio: (Collateral - Debt) / Collateral
  const axisDebtSafety = Math.min(1, Math.max(0, (shockedCollateral - debtValue) / shockedCollateral));

  return {
    collateralRatio: baseCr,
    shockedCollateralRatio: shockedCr,
    healthFactor,
    status,
    liquidationDropThresholdPct,
    isLiquidatable: healthFactor <= 1.0,
    radarValues: [axisCr, axisHf, axisMargin, axisResilience, axisDebtSafety],
  };
}

export function SyntheticPositionRadar({
  positionId,
  assetSymbol,
  collateral,
  minted,
  assetPrice,
  liquidationThreshold = 120,
  minCollateralRatio = 150,
  className = "",
  onShockChange,
}: SyntheticPositionRadarProps) {
  const [shockPct, setShockPct] = useState<number>(0);

  const metrics = useMemo(() => {
    return calculatePositionMetrics({
      collateral,
      minted,
      assetPrice,
      shockPct,
      liquidationThreshold,
      minCollateralRatio,
    });
  }, [collateral, minted, assetPrice, shockPct, liquidationThreshold, minCollateralRatio]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setShockPct(val);
    onShockChange?.(val);
  };

  // Radar geometry configuration
  const size = 260;
  const center = size / 2;
  const radius = 95;
  const axes = useMemo(
    () => [
      { label: "Collateral", angle: -Math.PI / 2 },
      { label: "Health", angle: -Math.PI / 2 + (2 * Math.PI) / 5 },
      { label: "Margin", angle: -Math.PI / 2 + (4 * Math.PI) / 5 },
      { label: "Resilience", angle: -Math.PI / 2 + (6 * Math.PI) / 5 },
      { label: "Debt Safety", angle: -Math.PI / 2 + (8 * Math.PI) / 5 },
    ],
    [],
  );

  // Radar polygon points
  const polygonPoints = useMemo(() => {
    return metrics.radarValues
      .map((val, i) => {
        const r = radius * Math.max(0.08, val);
        const x = center + r * Math.cos(axes[i].angle);
        const y = center + r * Math.sin(axes[i].angle);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [metrics.radarValues, center, radius, axes]);

  // Color theme mapping based on Health Status
  const statusConfig = {
    safe: {
      color: "#10b981", // Emerald 500
      stroke: "#34d399",
      fill: "rgba(16, 185, 129, 0.25)",
      bgBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      label: "Safe Position",
      icon: ShieldCheck,
    },
    warning: {
      color: "#f59e0b", // Amber 500
      stroke: "#fbbf24",
      fill: "rgba(245, 158, 11, 0.28)",
      bgBadge: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      label: "Warning Threshold",
      icon: AlertTriangle,
    },
    danger: {
      color: "#f43f5e", // Rose 500
      stroke: "#fb7185",
      fill: "rgba(244, 63, 94, 0.35)",
      bgBadge: "bg-rose-500/10 text-rose-300 border-rose-500/30",
      label: "Danger / Liquidatable",
      icon: ShieldAlert,
    },
  }[metrics.status];

  const StatusIcon = statusConfig.icon;

  return (
    <div
      data-testid={`synthetic-position-radar-${positionId}`}
      className={`rounded-2xl border border-slate-800 bg-slate-900/60 p-4 md:p-5 text-slate-100 ${className}`}
    >
      {/* Header with Title and Health Factor Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-white">
              Position #{positionId} · {assetSymbol}
            </h4>
            <span
              data-testid="health-factor-badge"
              data-status={metrics.status}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold font-mono ${statusConfig.bgBadge}`}
            >
              <StatusIcon size={13} />
              {statusConfig.label} (HF: {metrics.healthFactor.toFixed(2)})
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Multi-axis liquidation risk & price shock stress test
          </p>
        </div>

        <div className="text-right">
          <span className="text-[11px] text-slate-400">Effective CR</span>
          <p
            data-testid="collateral-ratio-display"
            className="font-mono text-sm font-bold text-white"
          >
            {metrics.shockedCollateralRatio.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Main Grid: SVG Radar Chart + Metrics */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[260px_1fr] items-center">
        {/* SVG Multi-Axis Radar Chart */}
        <div className="flex justify-center">
          <svg
            data-testid="radar-chart-svg"
            width={size}
            height={size}
            className="overflow-visible"
            role="img"
            aria-label={`Radar chart showing health status for position ${positionId}`}
          >
            {/* Concentric Grid Rings */}
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((level) => {
              const ringPoints = axes
                .map((a) => {
                  const r = radius * level;
                  const x = center + r * Math.cos(a.angle);
                  const y = center + r * Math.sin(a.angle);
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ");
              return (
                <polygon
                  key={level}
                  points={ringPoints}
                  fill="none"
                  stroke="#334155"
                  strokeWidth="0.8"
                  strokeDasharray={level === 1.0 ? "none" : "2,2"}
                />
              );
            })}

            {/* Axis Spokes */}
            {axes.map((a, i) => {
              const x2 = center + radius * Math.cos(a.angle);
              const y2 = center + radius * Math.sin(a.angle);
              const labelX = center + (radius + 18) * Math.cos(a.angle);
              const labelY = center + (radius + 14) * Math.sin(a.angle);
              return (
                <g key={i}>
                  <line
                    x1={center}
                    y1={center}
                    x2={x2}
                    y2={y2}
                    stroke="#334155"
                    strokeWidth="1"
                  />
                  <text
                    x={labelX}
                    y={labelY + 4}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="500"
                    fontFamily="system-ui"
                  >
                    {a.label}
                  </text>
                </g>
              );
            })}

            {/* Dynamic Health Factor Polygon */}
            <polygon
              data-testid="radar-polygon"
              points={polygonPoints}
              fill={statusConfig.fill}
              stroke={statusConfig.stroke}
              strokeWidth="2.2"
              className="transition-all duration-300 ease-out"
            />

            {/* Center Anchor Point */}
            <circle cx={center} cy={center} r="3" fill="#64748b" />
          </svg>
        </div>

        {/* Risk Indicators and Stress Controls */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
              <span className="text-slate-400">Liquidation Line</span>
              <p className="mt-1 font-mono text-sm font-semibold text-rose-300">
                {liquidationThreshold}% CR
              </p>
              <p className="text-[10px] text-slate-500">Margin threshold</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
              <span className="text-slate-400">Max Price Drop</span>
              <p
                data-testid="liquidation-threshold-pct"
                className={`mt-1 font-mono text-sm font-semibold ${
                  metrics.liquidationDropThresholdPct > -15
                    ? "text-rose-400"
                    : metrics.liquidationDropThresholdPct > -30
                      ? "text-amber-400"
                      : "text-emerald-400"
                }`}
              >
                {metrics.liquidationDropThresholdPct >= 0
                  ? "At Risk Now"
                  : `${metrics.liquidationDropThresholdPct.toFixed(1)}%`}
              </p>
              <p className="text-[10px] text-slate-500">To liquidation trigger</p>
            </div>
          </div>

          {/* Interactive Simulated Price Shock Slider */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/40 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <label
                htmlFor={`shock-slider-${positionId}`}
                className="flex items-center gap-1 font-medium text-slate-300"
              >
                <TrendingDown size={14} className="text-cyan-400" /> Simulated Collateral Shock
              </label>
              <span
                data-testid="shock-value-display"
                className={`font-mono font-bold ${
                  shockPct < 0
                    ? "text-rose-300"
                    : shockPct > 0
                      ? "text-emerald-300"
                      : "text-slate-300"
                }`}
              >
                {shockPct > 0 ? `+${shockPct}%` : `${shockPct}%`}
              </span>
            </div>

            <input
              id={`shock-slider-${positionId}`}
              data-testid="price-shock-slider"
              type="range"
              min="-50"
              max="50"
              step="1"
              value={shockPct}
              onChange={handleSliderChange}
              className="w-full accent-cyan-400 cursor-pointer"
            />

            <div className="mt-1 flex justify-between text-[10px] font-mono text-slate-500">
              <span>-50% Crash</span>
              <button
                type="button"
                onClick={() => setShockPct(0)}
                className="hover:text-cyan-400 text-slate-400"
              >
                Reset (0%)
              </button>
              <span>+50% Pump</span>
            </div>
          </div>

          {/* Liquidation Alert Warning */}
          {metrics.isLiquidatable && (
            <div
              role="alert"
              data-testid="liquidation-warning-banner"
              className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-200"
            >
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-rose-400" />
              <span>
                <strong>Liquidation Imminent!</strong> Collateral ratio ({metrics.shockedCollateralRatio.toFixed(1)}%)
                is at or below the {liquidationThreshold}% threshold. Deposit collateral immediately to avoid penalty.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SyntheticPositionRadar;
