"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Gauge,
  Zap,
  TrendingUp,
  AlertTriangle,
  Clock,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  Info,
  Radio,
} from "lucide-react";

// ── Constants & Conversions ───────────────────────────────────────────────────

export const STROOPS_PER_XLM = 10_000_000;
export const DEFAULT_BASE_FEE = 100; // Standard Stellar base fee in Stroops
export const LEDGER_TARGET_TIME_MS = 5000; // ~5 seconds per Stellar ledger

export type CongestionState = "low" | "moderate" | "surge";

export interface FeePreset {
  key: "slow" | "average" | "fast" | "custom";
  label: string;
  stroops: number;
  xlm: string;
  estimatedLatency: string;
  inclusionProbability: number; // heuristic 0 - 100%, not calibrated
  description: string;
}

export interface NetworkFeeMetrics {
  ledgerSequence: number;
  baseFee: number;
  capacityUsage: number; // 0.0 - 1.0 (e.g. 0.45 = 45% ledger full)
  p20: number;
  p50: number;
  p60: number;
  p90: number;
  p95: number;
  p99: number;
  mean: number;
  stdDev: number;
  congestion: CongestionState;
  surgeProbability: number; // 0 - 100%
  samplesCount: number;
  timestamp: number;
  dataSource: "demo" | "live" | "stale";
}

export interface GasForecastBannerProps {
  networkId?: "mainnet" | "testnet" | "futurenet" | "local";
  horizonUrl?: string;
  rpcUrl?: string;
  selectedStroops?: number;
  onSelectFee?: (stroops: number, presetKey: string) => void;
  compact?: boolean;
  className?: string;
  pollingIntervalMs?: number;
  simulateSurge?: boolean; // For testing and previewing surge states
}

// ── Pure Statistical & Forecasting Functions ──────────────────────────────────

/**
 * Converts integer Stroops to human-readable XLM string representation.
 */
export function stroopsToXlm(stroops: number): string {
  if (isNaN(stroops) || stroops < 0) return "0 XLM";
  const xlm = stroops / STROOPS_PER_XLM;
  // If >= 0.01 XLM format to 4 decimals, else up to 7 decimals
  if (xlm >= 0.01) {
    return `${xlm.toFixed(4)} XLM`;
  }
  return `${xlm.toFixed(7).replace(/(\.\d*?[1-9])0+$|\.0*$/, "$1")} XLM`;
}

/**
 * Converts decimal XLM into integer Stroops.
 */
export function xlmToStroops(xlm: number): number {
  if (isNaN(xlm) || xlm <= 0) return 0;
  return Math.round(xlm * STROOPS_PER_XLM);
}

/**
 * Computes arithmetic mean and population standard deviation of fee samples.
 * Time Complexity: O(N), Space Complexity: O(1)
 */
export function calculateMovingAverageAndStdDev(samples: number[]): {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
} {
  if (!samples || samples.length === 0) {
    return { mean: DEFAULT_BASE_FEE, stdDev: 0, min: DEFAULT_BASE_FEE, max: DEFAULT_BASE_FEE };
  }

  const n = samples.length;
  let sum = 0;
  let min = samples[0];
  let max = samples[0];

  for (let i = 0; i < n; i++) {
    const val = samples[i];
    sum += val;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const mean = sum / n;
  let varianceSum = 0;

  for (let i = 0; i < n; i++) {
    const diff = samples[i] - mean;
    varianceSum += diff * diff;
  }

  const stdDev = Math.sqrt(varianceSum / n);
  return { mean, stdDev, min, max };
}

export function getHorizonFeeStatsUrl(
  networkId: NonNullable<GasForecastBannerProps["networkId"]>,
  customUrl?: string
): string {
  if (customUrl) {
    const url = customUrl.replace(/\/$/, "");
    return url.endsWith("/fee_stats") ? url : `${url}/fee_stats`;
  }
  switch (networkId) {
    case "mainnet": return "https://horizon.stellar.org/fee_stats";
    case "testnet": return "https://horizon-testnet.stellar.org/fee_stats";
    case "futurenet": return "https://horizon-futurenet.stellar.org/fee_stats";
    case "local": return "http://localhost:8000/fee_stats";
  }
}

export function getFeePollingIntervalMs(isVisible: boolean, requestedMs: number): number {
  return isVisible ? Math.max(1000, requestedMs) : Math.max(30_000, requestedMs);
}

/**
 * Evaluates network congestion and surge pricing likelihood.
 *
 * Scoring model:
 *   Score = 0.55 * capacityUsage + 0.30 * (p90 - p50)/p50 + 0.15 * (stdDev/mean)
 */
export function determineCongestionLevel(
  capacityUsage: number,
  p50: number,
  p90: number,
  stdDev: number,
  mean: number = p50 || DEFAULT_BASE_FEE
): {
  congestion: CongestionState;
  surgeProbability: number;
  score: number;
} {
  const safeCapacity = Math.max(0, Math.min(1, capacityUsage));
  const safeP50 = Math.max(1, p50);
  const percentileSpread = Math.max(0, (p90 - safeP50) / safeP50);
  const cv = mean > 0 ? Math.min(2.0, stdDev / mean) : 0;

  // Composite congestion score bounded in [0.0, 1.0]
  const spreadTerm = Math.min(1.0, percentileSpread / 1.5);
  const cvTerm = Math.min(1.0, cv / 1.5);
  const score = 0.55 * safeCapacity + 0.30 * spreadTerm + 0.15 * cvTerm;

  let congestion: CongestionState = "low";
  let surgeProbability = Math.round(score * 100);

  if (safeCapacity >= 0.85 || score >= 0.7) {
    congestion = "surge";
    surgeProbability = Math.max(75, surgeProbability);
  } else if (safeCapacity >= 0.6 || score >= 0.38) {
    congestion = "moderate";
    surgeProbability = Math.max(25, Math.min(74, surgeProbability));
  } else {
    congestion = "low";
    surgeProbability = Math.min(24, surgeProbability);
  }

  return { congestion, surgeProbability, score };
}

/**
 * Calculates adaptive fee presets (Slow, Average, Fast) in Stroops.
 */
export function calculateFeePresets(
  baseFee: number,
  mean: number,
  stdDev: number,
  p20: number,
  p60: number,
  p95: number,
  congestion: CongestionState
): Record<"slow" | "average" | "fast", FeePreset> {
  const safeBase = Math.max(100, baseFee);

  // Slow / Economy: Sufficient when traffic is low; queued during surges
      const slowStroops = Math.max(safeBase, Math.floor(p20 || mean), Math.floor(mean));

  // Average / Balanced: Targets inclusion in the next 1-2 ledgers
  const avgStroops = Math.max(
    safeBase,
    Math.ceil(mean + 0.5 * stdDev),
    p60 || Math.floor(safeBase * 1.5)
  );

  // Fast / Priority: Surge-shielded fee to guarantee immediate inclusion
  const fastMultiplier = congestion === "surge" ? 3.0 : 2.0;
  const fastStroops = Math.max(
    Math.ceil(safeBase * fastMultiplier),
    Math.ceil(mean + 2.0 * stdDev),
    p95 || safeBase * 3
  );

  return {
    slow: {
      key: "slow",
      label: "Slow (Economy)",
      stroops: slowStroops,
      xlm: stroopsToXlm(slowStroops),
      estimatedLatency: congestion === "surge" ? "May take several ledgers" : "Often 2-4 ledgers",
      inclusionProbability: congestion === "surge" ? 25 : 85,
      description: "Lowest cost inclusion; may queue if blocks fill.",
    },
    average: {
      key: "average",
      label: "Average (Standard)",
      stroops: avgStroops,
      xlm: stroopsToXlm(avgStroops),
      estimatedLatency: congestion === "surge" ? "Often 1-3 ledgers" : "Often next ledger",
      inclusionProbability: congestion === "surge" ? 70 : 96,
      description: "Optimal balance for typical contract invocations.",
    },
    fast: {
      key: "fast",
      label: "Fast (Surge Priority)",
      stroops: fastStroops,
      xlm: stroopsToXlm(fastStroops),
      estimatedLatency: "Higher priority; timing varies",
      inclusionProbability: 99,
      description: "A higher bid may improve inclusion priority; network conditions determine timing.",
    },
  };
}

// ── Default Preset Fallback Data ──────────────────────────────────────────────

function createSyntheticMetrics(
  simulateSurge: boolean = false,
  networkBaseFee: number = DEFAULT_BASE_FEE
): NetworkFeeMetrics {
  const baseFee = networkBaseFee;
  const capacityUsage = simulateSurge ? 0.92 : 0.42;
  const p50 = simulateSurge ? 1200 : 100;
  const p90 = simulateSurge ? 3500 : 180;
  const p95 = simulateSurge ? 5200 : 250;
  const stdDev = simulateSurge ? 1400 : 45;
  const mean = simulateSurge ? 1650 : 120;

  const { congestion, surgeProbability } = determineCongestionLevel(
    capacityUsage,
    p50,
    p90,
    stdDev,
    mean
  );

  return {
    ledgerSequence: 642890,
    baseFee,
    capacityUsage,
    p20: simulateSurge ? 800 : 100,
    p50,
    p60: simulateSurge ? 1500 : 120,
    p90,
    p95,
    p99: simulateSurge ? 8000 : 400,
    mean,
    stdDev,
    congestion,
    surgeProbability,
    samplesCount: 50,
    timestamp: Date.now(),
    dataSource: "demo",
  };
}

// ── Component Implementation ──────────────────────────────────────────────────

export default function GasForecastBanner({
  networkId = "testnet",
  horizonUrl,
  rpcUrl,
  selectedStroops,
  onSelectFee,
  compact = false,
  className = "",
  pollingIntervalMs = 5000,
  simulateSurge = false,
}: GasForecastBannerProps) {
  const [metrics, setMetrics] = useState<NetworkFeeMetrics>(() =>
    createSyntheticMetrics(simulateSurge)
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(!compact);
  const [activePreset, setActivePreset] = useState<"slow" | "average" | "fast" | "custom">("average");
  const [customStroopsInput, setCustomStroopsInput] = useState<string>(String(selectedStroops ?? 200));
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [pollError, setPollError] = useState<string | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible"
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isVisibleRef = useRef<boolean>(isDocumentVisible);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feeHistoryRef = useRef<number[]>([]);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Sync state if simulated surge prop flips
  useEffect(() => {
    if (simulateSurge) {
      setMetrics(createSyntheticMetrics(true));
    }
  }, [simulateSurge]);

  useEffect(() => {
    if (selectedStroops !== undefined && Number.isFinite(selectedStroops)) {
      setCustomStroopsInput(String(Math.max(0, Math.floor(selectedStroops))));
      setActivePreset("custom");
    }
  }, [selectedStroops]);

  useEffect(() => {
    feeHistoryRef.current = [];
  }, [networkId, horizonUrl]);

  // Derive Presets from statistical engine
  const presets = useMemo(() => {
    const raw = calculateFeePresets(
      metrics.baseFee,
      metrics.mean,
      metrics.stdDev,
      metrics.p20,
      metrics.p60,
      metrics.p95,
      metrics.congestion
    );

    const parsedCustom = Number(customStroopsInput);
    const customStroopsNum = Number.isFinite(parsedCustom)
      ? Math.max(metrics.baseFee, Math.floor(parsedCustom))
      : metrics.baseFee;
    const customPreset: FeePreset = {
      key: "custom",
      label: "Custom",
      stroops: customStroopsNum,
      xlm: stroopsToXlm(customStroopsNum),
      estimatedLatency: customStroopsNum >= raw.fast.stroops ? "Higher priority; timing varies" : "Variable",
      inclusionProbability:
        customStroopsNum >= raw.fast.stroops
          ? 99
          : customStroopsNum >= raw.average.stroops
          ? 85
          : 40,
      description: "User-defined fee parameter.",
    };

    return { ...raw, custom: customPreset };
  }, [metrics, customStroopsInput]);

  // Fetch fee percentiles from Horizon and, when configured, the latest ledger
  // sequence from Soroban RPC.
  const fetchFeeStats = useCallback(async () => {
    if (!isVisibleRef.current || simulateSurge) return;
    setIsPolling(true);

    try {
      const endpoint = getHorizonFeeStatsUrl(networkId, horizonUrl);

      const horizonRequest = fetch(endpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const rpcRequest = rpcUrl
        ? fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
          }).catch(() => null)
        : null;
      const [res, rpcRes] = await Promise.all([horizonRequest, rpcRequest]);

      if (!mountedRef.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let rpcLedgerSequence: number | undefined;
      if (rpcRes?.ok) {
        const rpcData = await rpcRes.json();
        const candidate = Number(rpcData?.result?.sequence);
        if (Number.isSafeInteger(candidate) && candidate > 0) rpcLedgerSequence = candidate;
      }

      const parseMetric = (value: unknown, field: string): number => {
        const parsed = Number(value);
        if (value === null || value === undefined || value === "" || !Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Invalid Horizon ${field}`);
        }
        return parsed;
      };
      const lastBaseFee = parseMetric(data.last_ledger_base_fee, "base fee");
      const capacityUsage = Math.max(0, Math.min(1, parseMetric(data.ledger_capacity_usage, "capacity usage")));
      const ledgerSeq = parseMetric(data.last_ledger, "ledger sequence");

      const feeCharged = data.fee_charged || {};
      const p20 = parseMetric(feeCharged.p20, "p20 fee");
      const p50 = parseMetric(feeCharged.p50, "p50 fee");
      const p60 = parseMetric(feeCharged.p60, "p60 fee");
      const p90 = parseMetric(feeCharged.p90, "p90 fee");
      const p95 = parseMetric(feeCharged.p95, "p95 fee");
      const p99 = parseMetric(feeCharged.p99, "p99 fee");

      // Estimate moving average and standard deviation from percentile distribution
      feeHistoryRef.current = [...feeHistoryRef.current, p50].slice(-50);
      const { mean, stdDev } = calculateMovingAverageAndStdDev(feeHistoryRef.current);
      const { congestion, surgeProbability } = determineCongestionLevel(
        capacityUsage,
        p50,
        p90,
        stdDev,
        mean
      );

      setMetrics({
        ledgerSequence: rpcLedgerSequence ?? ledgerSeq,
        baseFee: lastBaseFee,
        capacityUsage,
        p20,
        p50,
        p60,
        p90,
        p95,
        p99,
        mean,
        stdDev,
        congestion,
        surgeProbability,
        samplesCount: feeHistoryRef.current.length,
        timestamp: Date.now(),
        dataSource: "live",
      });
      setPollError(null);
      setLastRefreshedAt(Date.now());
    } catch (error) {
      // Keep last known data. Synthetic values remain explicitly marked as demo.
      if (!mountedRef.current) return;
      setMetrics((prev) => {
        return prev.dataSource === "live" ? { ...prev, dataSource: "stale" } : prev;
      });
      setPollError(error instanceof Error ? error.message : "Unable to refresh network fees");
    } finally {
      if (mountedRef.current) setIsPolling(false);
    }
  }, [horizonUrl, networkId, rpcUrl, simulateSurge]);

  // Tab Visibility Lifecycle Backoff
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      isVisibleRef.current = isVisible;
      setIsDocumentVisible(isVisible);

    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Polling Interval Engine
  useEffect(() => {
    if (isDocumentVisible) fetchFeeStats();
    const intervalMs = getFeePollingIntervalMs(isDocumentVisible, pollingIntervalMs);
    const interval = setInterval(() => {
      if (isVisibleRef.current) fetchFeeStats();
    }, intervalMs);

    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [fetchFeeStats, pollingIntervalMs, isDocumentVisible]);

  // Handle Preset Selection
  const handleSelectPreset = (key: "slow" | "average" | "fast" | "custom") => {
    setActivePreset(key);
    const chosen = presets[key];
    if (onSelectFee) {
      onSelectFee(chosen.stroops, key);
    }
  };

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Color & Badge Tokens
  const statusTheme = useMemo(() => {
    switch (metrics.congestion) {
      case "surge":
        return {
          badgeBg: "bg-red-500/15 border-red-500/40 text-red-400",
          dotBg: "bg-red-500",
          glow: "shadow-[0_0_12px_rgba(239,68,68,0.25)]",
          label: "Surge Expected",
          barColor: "bg-red-500",
          cardBg: "bg-red-950/20 border-red-900/50",
        };
      case "moderate":
        return {
          badgeBg: "bg-amber-500/15 border-amber-500/40 text-amber-400",
          dotBg: "bg-amber-500",
          glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]",
          label: "Moderate Load",
          barColor: "bg-amber-500",
          cardBg: "bg-amber-950/20 border-amber-900/50",
        };
      case "low":
      default:
        return {
          badgeBg: "bg-emerald-500/15 border-emerald-500/40 text-emerald-400",
          dotBg: "bg-emerald-500",
          glow: "shadow-[0_0_12px_rgba(16,185,129,0.2)]",
          label: "Low Congestion",
          barColor: "bg-emerald-500",
          cardBg: "bg-slate-900/90 border-slate-800",
        };
    }
  }, [metrics.congestion]);

  return (
    <div
      className={`w-full bg-slate-950/90 border border-slate-800/80 rounded-xl shadow-xl backdrop-blur-md transition-all duration-200 overflow-hidden ${className}`}
      data-testid="gas-forecast-banner"
    >
      {/* ── Compact Top Bar / Header ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary-400" />
            <span className="text-xs font-semibold tracking-wider uppercase text-slate-300">
              Soroban Fee & Congestion
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-[10px] text-slate-500" data-testid="fee-data-status">
            <span className={metrics.dataSource === "live" ? "text-emerald-400" : metrics.dataSource === "stale" ? "text-amber-300" : "text-slate-400"}>
              {metrics.dataSource === "live" ? "Live Horizon data" : metrics.dataSource === "stale" ? "Stale network data" : "Demo data"}
            </span>
            <span>{metrics.dataSource === "demo" ? "Sample values" : `Updated ${new Date(lastRefreshedAt).toLocaleTimeString()}`}</span>
          </div>

          {/* Dynamic Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusTheme.badgeBg} ${statusTheme.glow}`}
            data-testid="congestion-status-pill"
          >
            <span className={`w-2 h-2 rounded-full ${statusTheme.dotBg} animate-pulse`} />
            <span>{statusTheme.label}</span>
          </div>

          {/* Ledger Capacity Gauge Meter */}
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-800 text-xs text-slate-400">
            <span>Capacity:</span>
            <div className="w-20 bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${statusTheme.barColor}`}
                style={{ width: `${Math.round(metrics.capacityUsage * 100)}%` }}
                data-testid="capacity-progress-bar"
              />
            </div>
            <span className="font-mono text-slate-300">
              {Math.round(metrics.capacityUsage * 100)}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {/* Base Fee Indicator */}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <span>Base:</span>
            <span className="text-slate-200 font-semibold">{metrics.baseFee} Stroops</span>
          </div>

          {/* Ledger Height Pill */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
            <Radio className="w-3 h-3 text-slate-500" />
            <span>Ledger #{metrics.ledgerSequence.toLocaleString()}</span>
          </div>

          {/* Refresh Action */}
          <button
            onClick={fetchFeeStats}
            disabled={isPolling}
            aria-label="Refresh fee stats"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? "animate-spin text-primary-400" : ""}`} />
          </button>

          {/* Toggle Expand / Collapse */}
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-label={isExpanded ? "Collapse fee drawer" : "Expand fee drawer"}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors"
          >
            <span>{isExpanded ? "Hide" : "Details"}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {pollError && (
        <p role="status" className="px-4 pb-2 text-[11px] text-amber-300">
          Network fee refresh failed: {pollError}. Showing {metrics.dataSource === "demo" ? "demo values" : "the last successful reading"}.
        </p>
      )}

      {/* ── High Congestion Alert Drawer ────────────────────────────────────── */}
      {metrics.congestion === "surge" && (
        <div
          className="flex items-start gap-2.5 px-4 py-2.5 bg-red-950/40 border-y border-red-500/30 text-red-300 text-xs animate-fadeIn"
          data-testid="surge-alert-callout"
        >
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-red-200">
              High Network Congestion Detected (heuristic score: {metrics.surgeProbability}%)
            </span>
            <p className="text-red-300/90 leading-relaxed">
              Recent blocks are utilizing {Math.round(metrics.capacityUsage * 100)}% of capacity.
              Higher bids can improve priority, but ledger capacity and competing bids determine
              inclusion. The <strong>Fast (Surge Priority)</strong> preset is a heuristic suggestion.
            </p>
          </div>
        </div>
      )}

      {/* ── Expanded Analytics & Presets Drawer ───────────────────────────────── */}
      {isExpanded && (
        <div className="p-4 pt-2 border-t border-slate-800/80 space-y-4">
          {/* Preset Selector Cards */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Suggested Inclusion Fee Presets
              </span>
              <span className="text-[11px] text-slate-500">
                Network: <span className="uppercase text-slate-300 font-mono">{networkId}</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(["slow", "average", "fast", "custom"] as const).map((key) => {
                const preset = presets[key];
                const isSelected = activePreset === key;

                return (
                  <div
                    key={key}
                    onClick={() => handleSelectPreset(key)}
                    className={`cursor-pointer rounded-lg p-3 border transition-all text-left flex flex-col justify-between ${
                      isSelected
                        ? "bg-primary-950/30 border-primary-500 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                    data-testid={`preset-card-${key}`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                          {key === "fast" && <Zap className="w-3.5 h-3.5 text-amber-400" />}
                          {preset.label}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-300 border border-primary-500/30">
                            Active
                          </span>
                        )}
                      </div>

                      {key !== "custom" ? (
                        <>
                          <div className="text-base font-bold font-mono text-slate-100">
                            {preset.stroops.toLocaleString()}{" "}
                            <span className="text-xs font-normal text-slate-400">Stroops</span>
                          </div>
                          <div className="text-xs text-slate-400 font-mono">{preset.xlm}</div>
                        </>
                      ) : (
                        <div className="space-y-1.5 my-1" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={metrics.baseFee}
                              step={50}
                              value={customStroopsInput}
                              onChange={(e) => setCustomStroopsInput(e.target.value)}
                              onBlur={() => handleSelectPreset("custom")}
                              className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-primary-500"
                              placeholder="Stroops"
                              data-testid="custom-stroops-input"
                            />
                            <span className="text-[11px] text-slate-400">Str</span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {stroopsToXlm(parseInt(customStroopsInput, 10) || 0)}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {preset.estimatedLatency}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(key, preset.stroops.toString());
                        }}
                        aria-label={`Copy ${preset.stroops} Stroops fee`}
                        className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                      >
                        {copiedKey === key ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Heuristic inclusion estimate: {preset.inclusionProbability}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Statistical Metrics Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-800/60 text-xs">
            <div className="p-2 rounded bg-slate-900/40 border border-slate-800/60">
              <span className="text-slate-400 text-[11px] block">Median Fee (p50)</span>
              <span className="font-mono text-slate-200 font-semibold">{metrics.p50} Stroops</span>
            </div>
            <div className="p-2 rounded bg-slate-900/40 border border-slate-800/60">
              <span className="text-slate-400 text-[11px] block">90th Percentile (p90)</span>
              <span className="font-mono text-slate-200 font-semibold">{metrics.p90} Stroops</span>
            </div>
            <div className="p-2 rounded bg-slate-900/40 border border-slate-800/60">
              <span className="text-slate-400 text-[11px] block">Std Deviation (σ)</span>
              <span className="font-mono text-slate-200 font-semibold">
                ±{Math.round(metrics.stdDev)} Stroops
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900/40 border border-slate-800/60">
              <span className="text-slate-400 text-[11px] block">Heuristic Surge Score</span>
              <span
                className={`font-mono font-semibold ${
                  metrics.congestion === "surge"
                    ? "text-red-400"
                    : metrics.congestion === "moderate"
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              >
                {metrics.surgeProbability}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
