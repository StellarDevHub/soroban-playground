"use client";

import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Radio,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  OracleFeedData,
  OracleHealthStatus,
  OraclePricePoint,
  getOracleHealthStatus,
  calculatePriceDeviation,
  ORACLE_THRESHOLDS,
} from "@/hooks/useOracleStatus";

function formatLatency(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function generateMockHistory(
  baseOracle: number,
  baseSpot: number,
  samples = 12,
): OraclePricePoint[] {
  const points: OraclePricePoint[] = [];
  const now = Date.now();
  const stepMs = 30_000;

  for (let i = samples - 1; i >= 0; i--) {
    const time = now - i * stepMs;
    // slight deterministic variation
    const wave = Math.sin(i * 0.8) * 0.004;
    const oPrice = Number((baseOracle * (1 + wave)).toFixed(4));
    const sPrice = Number((baseSpot * (1 - wave * 0.5)).toFixed(4));
    const { deviationPct } = calculatePriceDeviation(oPrice, sPrice);
    points.push({
      timestamp: time,
      oraclePrice: oPrice,
      spotPrice: sPrice,
      deviationPct,
    });
  }
  return points;
}

export const DEFAULT_ORACLE_FEEDS: OracleFeedData[] = [
  {
    id: "xlm-usd",
    name: "XLM / USD",
    asset: "XLM",
    oraclePrice: 0.1245,
    spotPrice: 0.1242,
    lastUpdatedAt: Date.now() - 25_000, // 25s ago (< 60s -> active)
  },
  {
    id: "btc-usd",
    name: "BTC / USD",
    asset: "BTC",
    oraclePrice: 64250.0,
    spotPrice: 64890.0,
    lastUpdatedAt: Date.now() - 450_000, // 7.5m ago (> 300s -> stale)
  },
  {
    id: "eth-usd",
    name: "ETH / USD",
    asset: "ETH",
    oraclePrice: 3420.5,
    spotPrice: 3510.0,
    lastUpdatedAt: Date.now() - 2400_000, // 40m ago (> 1800s -> down)
  },
];

export interface OracleStatusWidgetProps {
  feeds?: OracleFeedData[];
  onSelectFeed?: (feed: OracleFeedData) => void;
  className?: string;
  now?: number;
}

export function OracleHealthPill({
  status,
  latencySec,
  size = "md",
  className = "",
}: {
  status: OracleHealthStatus;
  latencySec?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const config = {
    active: {
      label: "Active",
      threshold: "< 60s",
      bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      dot: "bg-emerald-400",
    },
    delayed: {
      label: "Delayed",
      threshold: "60-300s",
      bg: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
      dot: "bg-yellow-400",
    },
    stale: {
      label: "Stale",
      threshold: "> 300s",
      bg: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      dot: "bg-amber-400",
    },
    down: {
      label: "Down",
      threshold: "> 1800s",
      bg: "bg-rose-500/15 text-rose-400 border-rose-500/30",
      dot: "bg-rose-400",
    },
  }[status];

  const sizeClasses =
    size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      data-testid="oracle-health-pill"
      data-status={status}
      aria-label={`Oracle Status: ${config.label} (${config.threshold})`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium ${config.bg} ${sizeClasses} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
      {latencySec !== undefined && (
        <span className="opacity-70">({formatLatency(latencySec)})</span>
      )}
    </span>
  );
}

export function OracleStatusWidget({
  feeds = DEFAULT_ORACLE_FEEDS,
  onSelectFeed,
  className = "",
  now: propNow,
}: OracleStatusWidgetProps) {
  const [selectedId, setSelectedId] = useState<string>(
    feeds[0]?.id ?? "xlm-usd",
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const now = propNow ?? Date.now();

  const activeFeeds = useMemo(() => {
    return feeds.map((f) => {
      const diffSec = Math.max(0, (now - f.lastUpdatedAt) / 1000);
      const computedStatus = f.status ?? getOracleHealthStatus(f.lastUpdatedAt, now);
      const history =
        f.history ?? generateMockHistory(f.oraclePrice, f.spotPrice);
      const deviation = calculatePriceDeviation(f.oraclePrice, f.spotPrice);
      return {
        ...f,
        diffSec,
        status: computedStatus,
        history,
        deviation,
      };
    });
  }, [feeds, now]);

  const selectedFeed =
    activeFeeds.find((f) => f.id === selectedId) ?? activeFeeds[0];

  const staleFeeds = useMemo(() => {
    return activeFeeds.filter(
      (f) =>
        f.status === "stale" ||
        f.status === "down" ||
        f.diffSec > ORACLE_THRESHOLDS.STALE_MIN_SEC,
    );
  }, [activeFeeds]);

  // SVG Geometry for Price and Deviation Charts
  const chartWidth = 560;
  const priceChartHeight = 110;
  const devChartHeight = 70;
  const paddingX = 45;
  const paddingY = 15;

  const history = selectedFeed?.history ?? [];
  const count = history.length;

  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (count === 0) return { minPrice: 0, maxPrice: 1, priceRange: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const pt of history) {
      if (pt.oraclePrice < min) min = pt.oraclePrice;
      if (pt.spotPrice < min) min = pt.spotPrice;
      if (pt.oraclePrice > max) max = pt.oraclePrice;
      if (pt.spotPrice > max) max = pt.spotPrice;
    }
    const pad = (max - min) * 0.1 || max * 0.01 || 1;
    return {
      minPrice: min - pad,
      maxPrice: max + pad,
      priceRange: max + pad - (min - pad),
    };
  }, [history, count]);

  const { minDev, maxDev, devRange } = useMemo(() => {
    if (count === 0) return { minDev: -1, maxDev: 1, devRange: 2 };
    let min = -1.0;
    let max = 1.0;
    for (const pt of history) {
      if (pt.deviationPct < min) min = pt.deviationPct;
      if (pt.deviationPct > max) max = pt.deviationPct;
    }
    const pad = Math.max(Math.abs(min), Math.abs(max)) * 0.2 || 0.2;
    const bound = Math.max(Math.abs(min), Math.abs(max)) + pad;
    return {
      minDev: -bound,
      maxDev: bound,
      devRange: bound * 2,
    };
  }, [history, count]);

  const getX = (index: number) => {
    if (count <= 1) return paddingX;
    return (
      paddingX +
      (index / (count - 1)) * (chartWidth - paddingX * 2)
    );
  };

  const getPriceY = (price: number) => {
    const ratio = (price - minPrice) / priceRange;
    return priceChartHeight - paddingY - ratio * (priceChartHeight - paddingY * 2);
  };

  const getDevY = (dev: number) => {
    const topY = priceChartHeight + 35;
    const ratio = (dev - minDev) / devRange;
    return topY + devChartHeight - paddingY - ratio * (devChartHeight - paddingY * 2);
  };

  const oraclePolylinePoints = useMemo(() => {
    return history.map((pt, i) => `${getX(i)},${getPriceY(pt.oraclePrice)}`).join(" ");
  }, [history, minPrice, priceRange]);

  const spotPolylinePoints = useMemo(() => {
    return history.map((pt, i) => `${getX(i)},${getPriceY(pt.spotPrice)}`).join(" ");
  }, [history, minPrice, priceRange]);

  const devPolylinePoints = useMemo(() => {
    return history.map((pt, i) => `${getX(i)},${getDevY(pt.deviationPct)}`).join(" ");
  }, [history, minDev, devRange]);

  const zeroDevY = getDevY(0);

  const hoveredPoint =
    hoverIndex !== null && history[hoverIndex] ? history[hoverIndex] : null;

  return (
    <div
      data-testid="oracle-status-widget"
      className={`rounded-xl border border-gray-800 bg-gray-900/60 p-5 font-mono text-gray-100 shadow-xl backdrop-blur-sm ${className}`}
    >
      {/* Widget Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white tracking-wide">
              Oracle Feed Latency & Price Deviation Monitor
            </h2>
            <p className="text-xs text-gray-400">
              Real-time staleness tracking and cross-market price deviation
            </p>
          </div>
        </div>

        {/* Feed Selector Tabs */}
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-950/60 p-1">
          {activeFeeds.map((feed) => {
            const isSelected = feed.id === selectedId;
            return (
              <button
                key={feed.id}
                data-testid={`feed-tab-${feed.id}`}
                onClick={() => {
                  setSelectedId(feed.id);
                  onSelectFeed?.(feed);
                }}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition ${
                  isSelected
                    ? "bg-gray-800 text-white shadow-sm"
                    : "text-gray-400 hover:bg-gray-800/40 hover:text-gray-200"
                }`}
              >
                <span>{feed.name}</span>
                <OracleHealthPill
                  status={feed.status}
                  size="sm"
                  className="hidden sm:inline-flex"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Visual Staleness Alert Banner */}
      {staleFeeds.length > 0 && (
        <div
          role="alert"
          data-testid="feed-staleness-alert"
          className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="flex-1 text-xs">
            <div className="font-semibold text-amber-100">
              Oracle Staleness Alert: {staleFeeds.length} data feed
              {staleFeeds.length > 1 ? "s have" : " has"} exceeded maximum staleness threshold (&gt; 300s)
            </div>
            <p className="mt-0.5 text-amber-300/80">
              Timestamps are delayed or feeds are unresponsive. Verify validator consensus or switch to fallback feeds before relying on contract pricing.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {staleFeeds.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1.5 rounded bg-amber-950/70 px-2 py-0.5 text-[11px] border border-amber-500/30 text-amber-200"
                >
                  <span className="font-semibold">{f.name}:</span>
                  <span>{formatLatency(f.diffSec)}</span>
                  <span className="uppercase text-[10px] text-amber-400">
                    [{f.status}]
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Key Metrics Row */}
      {selectedFeed && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Oracle Price */}
          <div className="rounded-lg border border-gray-800/80 bg-gray-950/40 p-3">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span>Oracle Feed Price</span>
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
            </div>
            <div className="mt-1 text-lg font-bold text-cyan-300">
              ${selectedFeed.oraclePrice.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-500">
              <span>Asset: {selectedFeed.asset}</span>
            </div>
          </div>

          {/* Spot Exchange Price */}
          <div className="rounded-lg border border-gray-800/80 bg-gray-950/40 p-3">
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span>Spot Exchange Price</span>
              <span className="h-2 w-2 rounded-full bg-purple-400" />
            </div>
            <div className="mt-1 text-lg font-bold text-purple-300">
              ${selectedFeed.spotPrice.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-500">
              <span>Benchmark Market</span>
            </div>
          </div>

          {/* Price Deviation */}
          <div
            data-testid="price-deviation-metric"
            className="rounded-lg border border-gray-800/80 bg-gray-950/40 p-3"
          >
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span>Price Deviation</span>
              {selectedFeed.deviation.deviationPct >= 0 ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-cyan-400" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />
              )}
            </div>
            <div
              className={`mt-1 text-lg font-bold ${
                Math.abs(selectedFeed.deviation.deviationPct) >= 1.0
                  ? "text-rose-400"
                  : Math.abs(selectedFeed.deviation.deviationPct) >= 0.5
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {selectedFeed.deviation.deviationPct > 0 ? "+" : ""}
              {selectedFeed.deviation.deviationPct.toFixed(2)}%
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
              {selectedFeed.deviation.deviationBps > 0 ? "+" : ""}
              {selectedFeed.deviation.deviationBps} bps spread
            </div>
          </div>

          {/* Health & Latency */}
          <div
            data-testid="feed-latency-metric"
            className="rounded-lg border border-gray-800/80 bg-gray-950/40 p-3"
          >
            <div className="flex items-center justify-between text-gray-400 text-[11px]">
              <span>Feed Latency</span>
              <Clock className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <div className="mt-1.5">
              <OracleHealthPill
                status={selectedFeed.status}
                latencySec={selectedFeed.diffSec}
                size="md"
              />
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
              Max staleness: {ORACLE_THRESHOLDS.STALE_MIN_SEC}s
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Price & Deviation Graph */}
      <div className="mt-5 rounded-lg border border-gray-800/80 bg-gray-950/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800/60 pb-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
            <TrendingUp className="h-4 w-4 text-blue-400" />
            <span>Real-Time Deviation & Dual Price Curves</span>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-cyan-400" />
              <span>Oracle Feed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-purple-400" />
              <span>Spot Exchange</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full bg-emerald-400" />
              <span>Deviation %</span>
            </span>
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="h-0.5 w-3 border-t border-dashed border-gray-600" />
              <span>0% Parity</span>
            </span>
          </div>
        </div>

        {/* SVG Graph */}
        <div className="relative mt-3 w-full overflow-x-auto">
          <svg
            data-testid="price-deviation-graph"
            viewBox={`0 0 ${chartWidth} 230`}
            className="w-full h-auto min-w-[500px]"
            role="img"
            aria-label="Real-time price deviation graph"
          >
            {/* Top Section: Price Curves Background & Grid */}
            <rect
              x={paddingX}
              y={paddingY}
              width={chartWidth - paddingX * 2}
              height={priceChartHeight - paddingY}
              fill="rgba(15, 23, 42, 0.4)"
              stroke="rgba(51, 65, 85, 0.4)"
              strokeWidth="0.5"
            />
            {/* Horizontal Grid lines for Price */}
            {[0, 0.5, 1].map((ratio) => {
              const y = priceChartHeight - paddingY - ratio * (priceChartHeight - paddingY * 2);
              const val = minPrice + ratio * priceRange;
              return (
                <g key={`grid-price-${ratio}`}>
                  <line
                    x1={paddingX}
                    y1={y}
                    x2={chartWidth - paddingX}
                    y2={y}
                    stroke="rgba(51, 65, 85, 0.3)"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={paddingX - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-gray-500 text-[9px] font-mono"
                  >
                    ${val < 1 ? val.toFixed(4) : val < 100 ? val.toFixed(2) : Math.round(val)}
                  </text>
                </g>
              );
            })}

            {/* Price Curves */}
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
              points={oraclePolylinePoints}
            />
            <polyline
              fill="none"
              stroke="#c084fc"
              strokeWidth="2"
              points={spotPolylinePoints}
            />

            {/* Price Data Points */}
            {history.map((pt, i) => (
              <g key={`pt-${i}`}>
                <circle
                  cx={getX(i)}
                  cy={getPriceY(pt.oraclePrice)}
                  r="3"
                  fill="#38bdf8"
                  className="transition hover:r-4 cursor-pointer"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
                <circle
                  cx={getX(i)}
                  cy={getPriceY(pt.spotPrice)}
                  r="3"
                  fill="#c084fc"
                  className="transition hover:r-4 cursor-pointer"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              </g>
            ))}

            {/* Section Divider */}
            <line
              x1={paddingX}
              y1={priceChartHeight + 15}
              x2={chartWidth - paddingX}
              y2={priceChartHeight + 15}
              stroke="rgba(75, 85, 99, 0.3)"
            />
            <text
              x={paddingX}
              y={priceChartHeight + 28}
              className="fill-gray-400 text-[10px] font-mono font-semibold"
            >
              Deviation (% Spread)
            </text>

            {/* Bottom Section: Deviation Curve */}
            <rect
              x={paddingX}
              y={priceChartHeight + 35}
              width={chartWidth - paddingX * 2}
              height={devChartHeight - paddingY}
              fill="rgba(15, 23, 42, 0.4)"
              stroke="rgba(51, 65, 85, 0.4)"
              strokeWidth="0.5"
            />

            {/* Zero Parity Baseline */}
            <line
              x1={paddingX}
              y1={zeroDevY}
              x2={chartWidth - paddingX}
              y2={zeroDevY}
              stroke="rgba(148, 163, 184, 0.6)"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
            <text
              x={chartWidth - paddingX + 6}
              y={zeroDevY + 3}
              className="fill-gray-400 text-[9px] font-mono"
            >
              0.0%
            </text>

            {/* Deviation Polyline */}
            <polyline
              fill="none"
              stroke={
                Math.abs(selectedFeed.deviation.deviationPct) >= 1.0
                  ? "#f43f5e"
                  : Math.abs(selectedFeed.deviation.deviationPct) >= 0.5
                  ? "#f59e0b"
                  : "#10b981"
              }
              strokeWidth="2"
              points={devPolylinePoints}
            />

            {/* Deviation Points */}
            {history.map((pt, i) => (
              <circle
                key={`dev-pt-${i}`}
                cx={getX(i)}
                cy={getDevY(pt.deviationPct)}
                r="3"
                fill={
                  Math.abs(pt.deviationPct) >= 1.0
                    ? "#f43f5e"
                    : Math.abs(pt.deviationPct) >= 0.5
                    ? "#f59e0b"
                    : "#10b981"
                }
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            ))}

            {/* Deviation Bounds Reference Labels */}
            <text
              x={paddingX - 6}
              y={getDevY(maxDev) + 3}
              textAnchor="end"
              className="fill-gray-500 text-[9px] font-mono"
            >
              +{maxDev.toFixed(1)}%
            </text>
            <text
              x={paddingX - 6}
              y={getDevY(minDev) + 3}
              textAnchor="end"
              className="fill-gray-500 text-[9px] font-mono"
            >
              {minDev.toFixed(1)}%
            </text>

            {/* Hover Indicator Line & Tooltip */}
            {hoverIndex !== null && hoveredPoint && (
              <g pointerEvents="none">
                <line
                  x1={getX(hoverIndex)}
                  y1={paddingY}
                  x2={getX(hoverIndex)}
                  y2={priceChartHeight + 35 + devChartHeight - paddingY}
                  stroke="rgba(255, 255, 255, 0.4)"
                  strokeDasharray="2 2"
                />
              </g>
            )}
          </svg>

          {/* Interactive Tooltip Card */}
          {hoverIndex !== null && hoveredPoint && (
            <div
              className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-md border border-gray-700 bg-gray-950/95 p-2 text-xs shadow-lg font-mono text-gray-200"
            >
              <div className="flex gap-4">
                <span>Oracle: ${hoveredPoint.oraclePrice}</span>
                <span>Spot: ${hoveredPoint.spotPrice}</span>
                <span
                  className={
                    Math.abs(hoveredPoint.deviationPct) >= 1.0
                      ? "text-rose-400 font-bold"
                      : "text-emerald-400 font-bold"
                  }
                >
                  Dev: {hoveredPoint.deviationPct > 0 ? "+" : ""}
                  {hoveredPoint.deviationPct.toFixed(2)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OracleStatusWidget;
