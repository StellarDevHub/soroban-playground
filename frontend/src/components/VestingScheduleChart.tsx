"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Coins,
  Lock,
  Unlock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
  Calendar,
} from "lucide-react";
import {
  VestingScheduleData,
  VestingBreakdown,
} from "../types/vesting";
import {
  calculateVestedTokens,
  getVestingBreakdown,
  formatCountdown,
  formatTokenAmount,
} from "../utils/vestingMath";

export interface VestingScheduleChartProps {
  schedule: VestingScheduleData;
  onClaim?: (scheduleId: number) => Promise<void> | void;
  onClaimSuccess?: (scheduleId: number, claimedAmount: number) => void;
  className?: string;
  simulatedTimestamp?: number;
}

interface HoverState {
  x: number;
  y: number;
  timestamp: number;
  vestedAmount: number;
  vestedPercentage: number;
  lockedAmount: number;
  stage: string;
}

export default function VestingScheduleChart({
  schedule,
  onClaim,
  onClaimSuccess,
  className = "",
  simulatedTimestamp,
}: VestingScheduleChartProps) {
  // Real-time ticking timestamp or simulated timestamp
  const [realTimestamp, setRealTimestamp] = useState<number>(() =>
    Math.floor(Date.now() / 1000),
  );
  const currentTimestamp = simulatedTimestamp ?? realTimestamp;

  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimSuccess, setClaimSuccess] = useState<boolean>(false);
  const [lastClaimedAmount, setLastClaimedAmount] = useState<number>(0);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [hoverData, setHoverData] = useState<HoverState | null>(null);

  const successTimerRef = useRef<NodeJS.Timeout | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Real-time 1s countdown clock when not in fixed simulation
  useEffect(() => {
    if (simulatedTimestamp !== undefined) return;

    const interval = setInterval(() => {
      setRealTimestamp(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [simulatedTimestamp]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const symbol = schedule.symbol || "XLM";

  // Financial breakdown
  const breakdown: VestingBreakdown = useMemo(() => {
    return getVestingBreakdown(schedule, currentTimestamp);
  }, [schedule, currentTimestamp]);

  // Claim handler
  const handleClaim = useCallback(async () => {
    if (breakdown.claimableAmount <= 0 || isClaiming) return;

    const claimAmount = breakdown.claimableAmount;
    setIsClaiming(true);
    setClaimError(null);
    setClaimSuccess(false);

    try {
      if (onClaim) {
        await onClaim(schedule.id);
      } else {
        // Contract invocation mock fallback
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      setClaimSuccess(true);
      setLastClaimedAmount(claimAmount);
      onClaimSuccess?.(schedule.id, claimAmount);

      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setClaimSuccess(false);
      }, 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Claim execution failed";
      setClaimError(msg);
    } finally {
      setIsClaiming(false);
    }
  }, [breakdown.claimableAmount, isClaiming, onClaim, onClaimSuccess, schedule.id]);

  // ── SVG Chart Dimensions & Scales ──────────────────────────────────────────
  const viewBoxWidth = 760;
  const viewBoxHeight = 260;
  const margin = { top: 28, right: 32, bottom: 38, left: 58 };
  const plotWidth = viewBoxWidth - margin.left - margin.right;
  const plotHeight = viewBoxHeight - margin.top - margin.bottom;

  const { startTimestamp, cliffTimestamp, endTimestamp, totalAmount } = schedule;
  const totalDuration = Math.max(1, endTimestamp - startTimestamp);

  const getX = useCallback(
    (ts: number) => {
      const clamped = Math.max(startTimestamp, Math.min(endTimestamp, ts));
      return margin.left + ((clamped - startTimestamp) / totalDuration) * plotWidth;
    },
    [startTimestamp, endTimestamp, totalDuration, plotWidth, margin.left],
  );

  const getY = useCallback(
    (amount: number) => {
      const clamped = Math.max(0, Math.min(totalAmount, amount));
      const ratio = totalAmount > 0 ? clamped / totalAmount : 0;
      return margin.top + plotHeight - ratio * plotHeight;
    },
    [totalAmount, plotHeight, margin.top],
  );

  // SVG Coordinates for stepped-area curve
  const chartCoordinates = useMemo(() => {
    const xStart = getX(startTimestamp);
    const xCliff = getX(cliffTimestamp);
    const xEnd = getX(endTimestamp);

    const yZero = getY(0);
    const cliffAmount = calculateVestedTokens(schedule, cliffTimestamp);
    const yCliff = getY(cliffAmount);
    const yEnd = getY(totalAmount);

    // Stepped path: (Start, 0) -> (Cliff, 0) -> (Cliff, CliffAmount) -> (End, Total)
    const linePath = `M ${xStart.toFixed(1)} ${yZero.toFixed(1)} L ${xCliff.toFixed(1)} ${yZero.toFixed(1)} L ${xCliff.toFixed(1)} ${yCliff.toFixed(1)} L ${xEnd.toFixed(1)} ${yEnd.toFixed(1)}`;
    const areaPath = `${linePath} L ${xEnd.toFixed(1)} ${yZero.toFixed(1)} Z`;

    // Claimed overlay area
    const yClaimed = getY(breakdown.claimedAmount);
    const claimedAreaPath = `M ${xStart.toFixed(1)} ${yZero.toFixed(1)} L ${xEnd.toFixed(1)} ${yZero.toFixed(1)} L ${xEnd.toFixed(1)} ${yClaimed.toFixed(1)} L ${xStart.toFixed(1)} ${yClaimed.toFixed(1)} Z`;

    return {
      xStart,
      xCliff,
      xEnd,
      yZero,
      yCliff,
      yEnd,
      linePath,
      areaPath,
      claimedAreaPath,
      cliffAmount,
    };
  }, [
    schedule,
    startTimestamp,
    cliffTimestamp,
    endTimestamp,
    totalAmount,
    breakdown.claimedAmount,
    getX,
    getY,
  ]);

  // Current time position
  const nowPos = useMemo(() => {
    if (currentTimestamp < startTimestamp || currentTimestamp > endTimestamp) {
      return null;
    }
    const xNow = getX(currentTimestamp);
    const yNow = getY(breakdown.vestedAmount);
    return { x: xNow, y: yNow };
  }, [currentTimestamp, startTimestamp, endTimestamp, breakdown.vestedAmount, getX, getY]);

  // Mouse hover scrubber
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * viewBoxWidth;

    if (svgX < margin.left || svgX > margin.left + plotWidth) {
      setHoverData(null);
      return;
    }

    const ratio = (svgX - margin.left) / plotWidth;
    const ts = Math.round(startTimestamp + ratio * totalDuration);
    const vested = calculateVestedTokens(schedule, ts);
    const vestedPct = totalAmount > 0 ? (vested / totalAmount) * 100 : 0;
    const locked = Math.max(0, totalAmount - vested);

    let stage = "Linear Vesting";
    if (ts < cliffTimestamp) {
      stage = "Cliff Lockup Period";
    } else if (ts === cliffTimestamp) {
      stage = "Cliff Unlock Event";
    } else if (ts >= endTimestamp) {
      stage = "Schedule Matured";
    }

    setHoverData({
      x: svgX,
      y: getY(vested),
      timestamp: ts,
      vestedAmount: vested,
      vestedPercentage: Math.round(vestedPct * 10) / 10,
      lockedAmount: locked,
      stage,
    });
  };

  const handleMouseLeave = () => {
    setHoverData(null);
  };

  // Cliff duration and percentage
  const cliffDurationDays = Math.max(
    0,
    Math.round((cliffTimestamp - startTimestamp) / 86400),
  );
  const cliffUnlockPct =
    schedule.cliffUnlockPercentage ??
    (totalAmount > 0 ? Math.round((chartCoordinates.cliffAmount / totalAmount) * 100) : 0);

  // Time progress bar %
  const totalScheduleDuration = Math.max(1, endTimestamp - startTimestamp);
  const elapsedDuration = Math.max(0, currentTimestamp - startTimestamp);
  const timelineProgressPct = Math.min(
    100,
    Math.round((elapsedDuration / totalScheduleDuration) * 100),
  );

  return (
    <div
      role="region"
      aria-label="Token vesting schedule visualizer"
      className={`flex flex-col space-y-4 p-5 bg-gray-900/90 border border-gray-800 rounded-xl shadow-2xl text-gray-100 ${className}`}
    >
      {/* ── Top Header & Countdown Timer ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-violet-950/60 border border-violet-700/40 text-violet-400">
              <TrendingUp size={16} />
            </span>
            <h4 className="text-sm font-semibold tracking-wide text-gray-200">
              Vesting Schedule #{schedule.id}
            </h4>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                schedule.revoked
                  ? "bg-rose-950/40 text-rose-400 border-rose-800/50"
                  : schedule.revocable !== false
                    ? "bg-amber-950/30 text-amber-300 border-amber-800/40"
                    : "bg-emerald-950/30 text-emerald-300 border-emerald-800/40"
              }`}
            >
              {schedule.revoked
                ? "Revoked"
                : schedule.revocable !== false
                  ? "Revocable"
                  : "Irrevocable"}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 font-mono">
              {schedule.vestingType}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 font-mono truncate max-w-sm sm:max-w-md">
            Beneficiary: {schedule.beneficiary}
          </p>
        </div>

        {/* Real-Time Countdown to Next Milestone */}
        <div
          data-testid="vesting-countdown-panel"
          className="flex items-center gap-3 bg-gray-950/80 border border-gray-800 px-3.5 py-2 rounded-lg self-start sm:self-auto"
        >
          <Clock size={16} className="text-violet-400 animate-pulse shrink-0" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              {breakdown.nextMilestoneLabel}
            </div>
            <div
              data-testid="countdown-timer-value"
              className="text-xs sm:text-sm font-mono font-semibold text-violet-300"
            >
              {breakdown.isMatured
                ? "Matured"
                : formatCountdown(breakdown.secondsToNextMilestone)}
            </div>
          </div>
        </div>
      </div>

      {/* Revocation Warning Banner */}
      {schedule.revoked && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 bg-rose-950/30 border border-rose-800/50 rounded-lg text-rose-300 text-xs"
        >
          <ShieldAlert size={16} className="shrink-0 text-rose-400" />
          <span>
            <strong>Schedule Revoked:</strong> Unvested tokens have been forfeited. Vested tokens earned prior to revocation remain secure.
          </span>
        </div>
      )}

      {/* ── Visual Breakdown Metric Cards (5 Pillars) ────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {/* Total Granted */}
        <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-medium uppercase tracking-wider">
              Total Granted
            </span>
            <Coins size={14} className="text-violet-400" />
          </div>
          <div className="mt-1.5">
            <span className="text-sm sm:text-base font-semibold font-mono text-gray-100">
              {formatTokenAmount(breakdown.totalGranted, symbol)}
            </span>
            <div className="text-[10px] text-gray-500">100% allocation</div>
          </div>
        </div>

        {/* Currently Vested */}
        <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-medium uppercase tracking-wider">
              Vested
            </span>
            <CheckCircle2 size={14} className="text-emerald-400" />
          </div>
          <div className="mt-1.5">
            <span
              data-testid="vested-tokens-amount"
              className="text-sm sm:text-base font-semibold font-mono text-emerald-400"
            >
              {formatTokenAmount(breakdown.vestedAmount, symbol)}
            </span>
            <div className="text-[10px] text-emerald-500/80">
              {breakdown.vestedPercentage}% of total
            </div>
          </div>
        </div>

        {/* Already Claimed */}
        <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-medium uppercase tracking-wider">
              Claimed
            </span>
            <Clock size={14} className="text-sky-400" />
          </div>
          <div className="mt-1.5">
            <span
              data-testid="claimed-tokens-amount"
              className="text-sm sm:text-base font-semibold font-mono text-sky-400"
            >
              {formatTokenAmount(breakdown.claimedAmount, symbol)}
            </span>
            <div className="text-[10px] text-sky-500/80">
              {breakdown.claimedPercentage}% released
            </div>
          </div>
        </div>

        {/* Claimable Right Now */}
        <div className="p-3 bg-violet-950/20 border border-violet-500/30 rounded-lg flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-violet-300">
            <span className="text-[10px] font-medium uppercase tracking-wider">
              Claimable
            </span>
            <Unlock size={14} className="text-violet-400" />
          </div>
          <div className="mt-1.5">
            <span
              data-testid="claimable-tokens-amount"
              className="text-sm sm:text-base font-semibold font-mono text-violet-300"
            >
              {formatTokenAmount(breakdown.claimableAmount, symbol)}
            </span>
            <div className="text-[10px] text-violet-400/80">
              Ready to withdraw
            </div>
          </div>
        </div>

        {/* Remaining Locked */}
        <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-medium uppercase tracking-wider">
              Locked
            </span>
            <Lock size={14} className="text-amber-400" />
          </div>
          <div className="mt-1.5">
            <span
              data-testid="locked-tokens-amount"
              className="text-sm sm:text-base font-semibold font-mono text-amber-400"
            >
              {formatTokenAmount(breakdown.lockedAmount, symbol)}
            </span>
            <div className="text-[10px] text-amber-500/80">
              {breakdown.lockedPercentage}% remaining
            </div>
          </div>
        </div>
      </div>

      {/* ── Interactive Stepped-Area Vesting Schedule SVG Chart ──────────────── */}
      <div className="relative bg-gray-950/70 border border-gray-800/80 rounded-xl p-3 overflow-hidden">
        {/* Chart Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1 text-[11px] text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" />
              <span>Vested Unlock Curve</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-500/40 inline-block border border-sky-500/60" />
              <span>Claimed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/20 inline-block border border-dashed border-amber-500/60" />
              <span>Cliff Lockup Period</span>
            </span>
          </div>
          {nowPos && (
            <span className="flex items-center gap-1 text-cyan-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
              <span>Now: {timelineProgressPct}% elapsed</span>
            </span>
          )}
        </div>

        {/* The SVG Canvas */}
        <div className="relative w-full overflow-x-auto">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
            role="img"
            aria-label={`Interactive stepped-area vesting chart for schedule #${schedule.id}`}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full h-auto select-none cursor-crosshair block"
          >
            <defs>
              {/* Stepped-area fill gradient */}
              <linearGradient id={`vesting-grad-${schedule.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45" />
                <stop offset="70%" stopColor="#6366f1" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
              </linearGradient>

              {/* Cliff zone diagonal pattern */}
              <pattern
                id={`cliff-stripes-${schedule.id}`}
                width="8"
                height="8"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="8"
                  stroke="rgba(245, 158, 11, 0.12)"
                  strokeWidth="2"
                />
              </pattern>
            </defs>

            {/* Horizontal Gridlines & Y-Axis Labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
              const yVal = margin.top + plotHeight - pct * plotHeight;
              return (
                <g key={pct} className="text-gray-600">
                  <line
                    x1={margin.left}
                    y1={yVal}
                    x2={margin.left + plotWidth}
                    y2={yVal}
                    stroke="rgba(75, 85, 99, 0.25)"
                    strokeDasharray={pct === 0 || pct === 1 ? undefined : "3 3"}
                  />
                  <text
                    x={margin.left - 8}
                    y={yVal + 3}
                    textAnchor="end"
                    className="text-[9px] fill-gray-500 font-mono"
                  >
                    {Math.round(pct * 100)}%
                  </text>
                </g>
              );
            })}

            {/* ── 1. Cliff Period Shaded Band ─────────────────────────────────── */}
            <rect
              x={chartCoordinates.xStart}
              y={margin.top}
              width={Math.max(0, chartCoordinates.xCliff - chartCoordinates.xStart)}
              height={plotHeight}
              fill={`url(#cliff-stripes-${schedule.id})`}
            />
            <rect
              x={chartCoordinates.xStart}
              y={margin.top}
              width={Math.max(0, chartCoordinates.xCliff - chartCoordinates.xStart)}
              height={plotHeight}
              fill="rgba(245, 158, 11, 0.04)"
            />

            {/* Cliff Lockup Label */}
            {chartCoordinates.xCliff - chartCoordinates.xStart > 60 && (
              <text
                x={(chartCoordinates.xStart + chartCoordinates.xCliff) / 2}
                y={margin.top + plotHeight / 2}
                textAnchor="middle"
                className="text-[10px] fill-amber-400/60 font-medium tracking-wider"
              >
                CLIFF LOCKUP ({cliffDurationDays}d)
              </text>
            )}

            {/* Vertical Marker at Cliff Unlock */}
            <line
              x1={chartCoordinates.xCliff}
              y1={margin.top}
              x2={chartCoordinates.xCliff}
              y2={margin.top + plotHeight}
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />

            {/* ── 2. Claimed Amount Base Overlay ─────────────────────────────── */}
            {breakdown.claimedAmount > 0 && (
              <path
                d={chartCoordinates.claimedAreaPath}
                fill="rgba(14, 165, 233, 0.12)"
                stroke="rgba(14, 165, 233, 0.3)"
                strokeWidth="1"
              />
            )}

            {/* ── 3. Stepped Area Fill ────────────────────────────────────────── */}
            <path
              d={chartCoordinates.areaPath}
              fill={`url(#vesting-grad-${schedule.id})`}
            />

            {/* Stepped Curve Stroke Line */}
            <path
              d={chartCoordinates.linePath}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* ── 4. Key Milestone Points (Cliff, Maturity) ───────────────────── */}
            {/* Start Point */}
            <circle
              cx={chartCoordinates.xStart}
              cy={chartCoordinates.yZero}
              r="4"
              fill="#9ca3af"
            />

            {/* Cliff Unlock Point (Step Start) */}
            <circle
              cx={chartCoordinates.xCliff}
              cy={chartCoordinates.yCliff}
              r="5"
              fill="#f59e0b"
              stroke="#1f2937"
              strokeWidth="2"
            />

            {/* Maturity Point */}
            <circle
              cx={chartCoordinates.xEnd}
              cy={chartCoordinates.yEnd}
              r="5"
              fill="#10b981"
              stroke="#1f2937"
              strokeWidth="2"
            />

            {/* ── 5. Current Time Indicator Marker ────────────────────────────── */}
            {nowPos && (
              <g className="transition-all duration-300">
                <line
                  x1={nowPos.x}
                  y1={margin.top}
                  x2={nowPos.x}
                  y2={margin.top + plotHeight}
                  stroke="#06b6d4"
                  strokeWidth="2"
                />
                {/* Glowing NOW circle */}
                <circle
                  cx={nowPos.x}
                  cy={nowPos.y}
                  r="6"
                  fill="#06b6d4"
                  stroke="#0f172a"
                  strokeWidth="2"
                  className="animate-pulse"
                />
                {/* "NOW" tag at top */}
                <rect
                  x={nowPos.x - 16}
                  y={margin.top - 18}
                  width="32"
                  height="14"
                  rx="3"
                  fill="#06b6d4"
                />
                <text
                  x={nowPos.x}
                  y={margin.top - 8}
                  textAnchor="middle"
                  className="text-[9px] fill-slate-950 font-bold tracking-wider"
                >
                  NOW
                </text>
              </g>
            )}

            {/* ── 6. Interactive Scrubber Crosshair & Marker ───────────────────── */}
            {hoverData && (
              <g>
                <line
                  x1={hoverData.x}
                  y1={margin.top}
                  x2={hoverData.x}
                  y2={margin.top + plotHeight}
                  stroke="#ffffff"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={hoverData.x}
                  cy={hoverData.y}
                  r="5"
                  fill="#ffffff"
                  stroke="#8b5cf6"
                  strokeWidth="2"
                />
              </g>
            )}

            {/* ── 7. X-Axis Timeline Labels ───────────────────────────────────── */}
            <text
              x={chartCoordinates.xStart}
              y={margin.top + plotHeight + 16}
              textAnchor="start"
              className="text-[9px] fill-gray-500 font-mono"
            >
              Start ({new Date(startTimestamp * 1000).toLocaleDateString()})
            </text>

            <text
              x={chartCoordinates.xCliff}
              y={margin.top + plotHeight + 16}
              textAnchor="middle"
              className="text-[9px] fill-amber-400 font-mono font-medium"
            >
              Cliff ({new Date(cliffTimestamp * 1000).toLocaleDateString()})
            </text>

            <text
              x={chartCoordinates.xEnd}
              y={margin.top + plotHeight + 16}
              textAnchor="end"
              className="text-[9px] fill-emerald-400 font-mono"
            >
              End ({new Date(endTimestamp * 1000).toLocaleDateString()})
            </text>
          </svg>

          {/* Floating Hover Tooltip */}
          {hoverData && (
            <div
              className="absolute pointer-events-none z-20 bg-gray-900/95 border border-gray-700/80 backdrop-blur-md rounded-lg p-2.5 shadow-2xl text-xs space-y-1"
              style={{
                left: `${Math.min(
                  Math.max(10, (hoverData.x / viewBoxWidth) * 100),
                  75,
                )}%`,
                top: "10px",
              }}
            >
              <div className="flex items-center justify-between gap-3 text-gray-400 border-b border-gray-800 pb-1">
                <span className="font-semibold text-gray-200">
                  {hoverData.stage}
                </span>
                <span className="font-mono text-[10px]">
                  {new Date(hoverData.timestamp * 1000).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Vested:</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {formatTokenAmount(hoverData.vestedAmount, symbol)} (
                  {hoverData.vestedPercentage}%)
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Locked:</span>
                <span className="font-mono font-medium text-amber-400">
                  {formatTokenAmount(hoverData.lockedAmount, symbol)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Schedule Configuration & Revocability Summary ────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-gray-950/40 border border-gray-800/60 p-3 rounded-lg">
        {/* Cliff & Linear Unlock Specs */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-gray-400 font-medium">
            <Calendar size={14} className="text-amber-400" />
            <span>Cliff & Unlock Details</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-gray-300 font-mono">
            <div>
              <span className="text-gray-500 text-[10px] block uppercase">
                Cliff Duration
              </span>
              <span>{cliffDurationDays} days</span>
            </div>
            <div>
              <span className="text-gray-500 text-[10px] block uppercase">
                Cliff Unlock Amount
              </span>
              <span>
                {formatTokenAmount(chartCoordinates.cliffAmount, symbol)} ({cliffUnlockPct}%)
              </span>
            </div>
            <div>
              <span className="text-gray-500 text-[10px] block uppercase">
                Linear Phase
              </span>
              <span>
                {Math.max(
                  0,
                  Math.round((endTimestamp - cliffTimestamp) / 86400),
                )}{" "}
                days
              </span>
            </div>
            <div>
              <span className="text-gray-500 text-[10px] block uppercase">
                Token Contract
              </span>
              <span className="truncate block" title={schedule.token}>
                {schedule.token.slice(0, 8)}…{schedule.token.slice(-4)}
              </span>
            </div>
          </div>
        </div>

        {/* Revocable vs Non-Revocable Breakdown */}
        <div className="space-y-1.5 border-t md:border-t-0 md:border-l border-gray-800/80 pt-2 md:pt-0 md:pl-3">
          <div className="flex items-center gap-2 text-gray-400 font-medium">
            <ShieldCheck size={14} className="text-violet-400" />
            <span>Revocability Guarantees</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-gray-300 font-mono">
            <div>
              <span className="text-gray-500 text-[10px] block uppercase">
                Non-Revocable Guaranteed
              </span>
              <span className="text-emerald-400">
                {formatTokenAmount(breakdown.nonRevocableAmount, symbol)}
              </span>
            </div>
            <div>
              <span className="text-gray-500 text-[10px] block uppercase">
                Subject to Revocation
              </span>
              <span className={breakdown.revocableAmount > 0 ? "text-amber-400" : "text-gray-400"}>
                {formatTokenAmount(breakdown.revocableAmount, symbol)}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-gray-500">
            {schedule.revocable !== false
              ? "Granter retains authority to revoke unvested portion. Vested tokens cannot be clawed back."
              : "Irrevocable agreement. All tokens will vest unconditionally according to the schedule."}
          </p>
        </div>
      </div>

      {/* ── One-Click 'Claim Vested Tokens' Action Section ────────────────────── */}
      <div className="pt-2 border-t border-gray-800/80 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-gray-400 text-center sm:text-left">
          {breakdown.claimableAmount > 0 ? (
            <span>
              You have{" "}
              <strong className="text-violet-300 font-mono">
                {formatTokenAmount(breakdown.claimableAmount, symbol)}
              </strong>{" "}
              available for instant withdrawal to your wallet.
            </span>
          ) : !breakdown.isCliffReached ? (
            <span className="text-amber-400/80">
              Cliff lockup in effect. First unlock occurs on{" "}
              {new Date(cliffTimestamp * 1000).toLocaleDateString()}.
            </span>
          ) : breakdown.lockedAmount > 0 ? (
            <span>All currently vested tokens have been claimed. Next unlock ongoing.</span>
          ) : (
            <span className="text-emerald-400">
              All tokens have been completely vested and released!
            </span>
          )}
        </div>

        {/* Claim Action Button */}
        <button
          onClick={handleClaim}
          disabled={breakdown.claimableAmount <= 0 || isClaiming || schedule.revoked}
          aria-label={
            breakdown.claimableAmount > 0
              ? `Claim ${formatTokenAmount(breakdown.claimableAmount, symbol)}`
              : "No tokens available to claim"
          }
          className={`w-full sm:w-auto px-5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-200 shadow-md ${
            breakdown.claimableAmount > 0 && !schedule.revoked
              ? "bg-violet-600 hover:bg-violet-500 text-white shadow-violet-900/30 hover:shadow-violet-900/50 cursor-pointer active:scale-95"
              : "bg-gray-800/70 text-gray-500 cursor-not-allowed border border-gray-800"
          }`}
        >
          {isClaiming ? (
            <>
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white/20 border-t-white" />
              <span>Claiming Tokens...</span>
            </>
          ) : (
            <>
              <Sparkles size={14} className="text-violet-200" />
              <span>
                {breakdown.claimableAmount > 0
                  ? `Claim ${formatTokenAmount(breakdown.claimableAmount, symbol)}`
                  : "Claim Vested Tokens"}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Claim Success Feedback */}
      {claimSuccess && (
        <div
          role="status"
          className="flex items-center justify-between p-3 bg-emerald-950/40 border border-emerald-600/50 rounded-lg text-emerald-300 text-xs animate-in fade-in duration-200"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>
              Claim successful! Transferred{" "}
              <strong>{formatTokenAmount(lastClaimedAmount, symbol)}</strong> to your wallet.
            </span>
          </div>
          <button
            onClick={() => setClaimSuccess(false)}
            className="text-emerald-400 hover:text-emerald-200 text-xs underline ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Claim Error Feedback */}
      {claimError && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-rose-300 text-xs"
        >
          <AlertTriangle size={16} className="text-rose-400 shrink-0" />
          <span>Error: {claimError}</span>
        </div>
      )}
    </div>
  );
}
