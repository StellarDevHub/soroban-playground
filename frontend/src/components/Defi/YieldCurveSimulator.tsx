"use client";

import { useMemo, useState } from "react";
import { Download, Printer, RotateCcw, AlertTriangle, CheckCircle, BarChart3, Activity } from "lucide-react";
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
  Filler,
  type ChartOptions,
  type ChartData,
} from "chart.js";
import {
  concentratedFeeApr,
  concentratedImpermanentLoss,
  concentratedMultiplier,
  estimatedFeeApr,
  generateHistoricalVsProjectedSeries,
  generateYieldCurveScenarios,
  impermanentLoss,
} from "./yieldCurveMath";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const money = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const FEE_TIERS = [
  { label: "0.01% (1 bps)", value: 1, desc: "Very stable pairs" },
  { label: "0.05% (5 bps)", value: 5, desc: "Stablecoins / pegged" },
  { label: "0.30% (30 bps)", value: 30, desc: "Standard volatile" },
  { label: "1.00% (100 bps)", value: 100, desc: "Exotic / long-tail" },
];

export default function YieldCurveSimulator() {
  const [activeTab, setActiveTab] = useState<"curve" | "timeseries">("curve");
  const [volume, setVolume] = useState(1_000_000);
  const [feeBps, setFeeBps] = useState(30);
  const [share, setShare] = useState(1);
  const [capital, setCapital] = useState(10_000);
  const [lowerPct, setLowerPct] = useState(-50);
  const [upperPct, setUpperPct] = useState(100);
  const [activePct, setActivePct] = useState(0);
  const [timeHorizonDays, setTimeHorizonDays] = useState(30);

  const lowerRatio = Math.max(0.01, 1 + lowerPct / 100);
  const upperRatio = Math.max(lowerRatio + 0.01, 1 + upperPct / 100);
  const activeRatio = Math.max(0.01, 1 + activePct / 100);

  // Math calculations
  const multiplier = useMemo(
    () => concentratedMultiplier(lowerRatio, upperRatio, 1),
    [lowerRatio, upperRatio],
  );

  const baseFeeApr = useMemo(
    () => estimatedFeeApr(volume, feeBps, share, capital),
    [volume, feeBps, share, capital],
  );

  const concFeeApr = useMemo(
    () =>
      concentratedFeeApr(
        volume,
        feeBps,
        share,
        capital,
        lowerRatio,
        upperRatio,
        activeRatio,
      ),
    [volume, feeBps, share, capital, lowerRatio, upperRatio, activeRatio],
  );

  const isPriceInRange = activeRatio >= lowerRatio && activeRatio <= upperRatio;

  const cpIl = useMemo(() => impermanentLoss(activeRatio) * 100, [activeRatio]);
  const concIl = useMemo(
    () =>
      concentratedImpermanentLoss(activeRatio, lowerRatio, upperRatio, 1) * 100,
    [activeRatio, lowerRatio, upperRatio],
  );

  const horizonYearFraction = timeHorizonDays / 365;
  const concNetReturn = concIl + (isPriceInRange ? concFeeApr * 100 * horizonYearFraction : 0);
  const cpNetReturn = cpIl + baseFeeApr * 100 * horizonYearFraction;

  // 1. Yield Curve Scenario Data
  const scenarios = useMemo(
    () =>
      generateYieldCurveScenarios(
        lowerRatio,
        upperRatio,
        volume,
        feeBps,
        share,
        capital,
        -90,
        500,
        80,
      ),
    [lowerRatio, upperRatio, volume, feeBps, share, capital],
  );

  // 2. Historical vs Projected Time Series
  const timeSeries = useMemo(
    () =>
      generateHistoricalVsProjectedSeries({
        lower: lowerRatio,
        upper: upperRatio,
        dailyVolume: volume,
        feeBps,
        liquiditySharePct: share,
        positionValue: capital,
        historyDays: 30,
        projectDays: timeHorizonDays,
      }),
    [lowerRatio, upperRatio, volume, feeBps, share, capital, timeHorizonDays],
  );

  // Chart 1: Yield vs Price Change Chart.js Data
  const curveChartData: ChartData<"line"> = useMemo(() => {
    return {
      labels: scenarios.map((s) => `${s.priceChangePct >= 0 ? "+" : ""}${Math.round(s.priceChangePct)}%`),
      datasets: [
        {
          label: "Concentrated Net Return (% with fees)",
          data: scenarios.map((s) => Number(s.concentratedNetReturnPct.toFixed(2))),
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2.5,
        },
        {
          label: "Concentrated Impermanent Loss (%)",
          data: scenarios.map((s) => Number(s.concentratedIlPct.toFixed(2))),
          borderColor: "#fb7185",
          backgroundColor: "transparent",
          borderDash: [4, 4],
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Constant Product (x·y=k) IL (%)",
          data: scenarios.map((s) => Number(s.constantProductIlPct.toFixed(2))),
          borderColor: "#c084fc",
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.8,
        },
        {
          label: "HODL Baseline (0%)",
          data: scenarios.map(() => 0),
          borderColor: "#64748b",
          borderDash: [2, 2],
          pointRadius: 0,
          borderWidth: 1,
        },
      ],
    };
  }, [scenarios]);

  // Chart 2: Historical vs Projected Returns Chart.js Data
  const timeseriesChartData: ChartData<"line"> = useMemo(() => {
    const combinedPoints = [...timeSeries.historical, ...timeSeries.projected.slice(1)];
    return {
      labels: combinedPoints.map((p) => p.dateLabel),
      datasets: [
        {
          label: "Concentrated Liquidity Return (%)",
          data: combinedPoints.map((p) => Number(p.concentratedReturnPct.toFixed(2))),
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.1)",
          fill: true,
          tension: 0.2,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2.5,
        },
        {
          label: "Constant Product AMM Return (%)",
          data: combinedPoints.map((p) => Number(p.constantProductReturnPct.toFixed(2))),
          borderColor: "#c084fc",
          backgroundColor: "transparent",
          tension: 0.2,
          pointRadius: 2,
          borderWidth: 2,
        },
        {
          label: "HODL Asset Return (%)",
          data: combinedPoints.map((p) => Number(p.hodlReturnPct.toFixed(2))),
          borderColor: "#fbbf24",
          backgroundColor: "transparent",
          borderDash: [4, 4],
          tension: 0.2,
          pointRadius: 2,
          borderWidth: 1.8,
        },
      ],
    };
  }, [timeSeries]);

  const chartOptions: ChartOptions<"line"> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          position: "top",
          labels: {
            color: "#94a3b8",
            boxWidth: 12,
            font: { size: 11, family: "ui-sans-serif, system-ui" },
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#94a3b8",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label(item) {
              return ` ${item.dataset.label}: ${item.formattedValue}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: {
            color: "#64748b",
            font: { size: 10 },
            maxTicksLimit: 12,
          },
        },
        y: {
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: {
            color: "#64748b",
            font: { size: 10 },
            callback(val) {
              return `${val}%`;
            },
          },
        },
      },
    };
  }, []);

  const resetAll = () => {
    setVolume(1_000_000);
    setFeeBps(30);
    setShare(1);
    setCapital(10_000);
    setLowerPct(-50);
    setUpperPct(100);
    setActivePct(0);
    setTimeHorizonDays(30);
  };

  const exportJson = () => {
    const config = {
      model: "Soroban AMM Concentrated Liquidity & Yield Curve Simulator",
      parameters: {
        dailyVolume: volume,
        swapFeeBps: feeBps,
        liquiditySharePct: share,
        capital,
        lowerBoundPct: lowerPct,
        upperBoundPct: upperPct,
        activePriceChangePct: activePct,
        timeHorizonDays,
      },
      metrics: {
        capitalEfficiencyMultiplier: Number(multiplier.toFixed(2)),
        concentratedFeeAprPercent: Number((concFeeApr * 100).toFixed(2)),
        baseFeeAprPercent: Number((baseFeeApr * 100).toFixed(2)),
        concentratedIlPercent: Number(concIl.toFixed(2)),
        constantProductIlPercent: Number(cpIl.toFixed(2)),
        concentratedNetReturnPercent: Number(concNetReturn.toFixed(2)),
        isPriceInRange,
      },
      scenarios,
    };

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `soroban-yield-simulation-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-cyan-400">
                Soroban · DeFi Engine
              </span>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Uniswap v3 Math
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white md:text-3xl">
              Liquidity Yield & APY Curve Simulator
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Interactive concentrated liquidity simulation modeling fee APR, leverage multipliers,
              impermanent loss curves, and historical vs. projected returns.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              onClick={exportJson}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-white"
            >
              <Download size={15} /> Export JSON
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-white"
            >
              <Printer size={15} /> Print Report
            </button>
            <button
              onClick={resetAll}
              aria-label="Reset parameters"
              title="Reset parameters to defaults"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:border-amber-400 hover:text-white"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </header>

        {/* Primary Layout Grid */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Controls Panel */}
          <aside className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-200">Simulation Controls</h2>
              <span className="text-xs font-mono text-cyan-400">
                {multiplier.toFixed(2)}x Leverage
              </span>
            </div>

            {/* Trading Volume Slider */}
            <div>
              <Slider
                label="Daily Trading Volume"
                value={volume}
                min={10_000}
                max={10_000_000}
                step={25_000}
                display={money(volume)}
                onChange={setVolume}
              />
              <div className="mt-2 flex gap-1.5">
                {[100_000, 1_000_000, 5_000_000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVolume(v)}
                    className={`rounded px-2 py-0.5 text-xs font-mono transition-colors ${
                      volume === v
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {money(v)}
                  </button>
                ))}
              </div>
            </div>

            {/* Swap Fee Tier Slider & Selector */}
            <div className="border-t border-slate-800/80 pt-4">
              <Slider
                label="Swap Fee Tier"
                value={feeBps}
                min={1}
                max={100}
                step={1}
                display={`${(feeBps / 100).toFixed(2)}% (${feeBps} bps)`}
                onChange={setFeeBps}
              />
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {FEE_TIERS.map((tier) => (
                  <button
                    key={tier.value}
                    type="button"
                    onClick={() => setFeeBps(tier.value)}
                    className={`rounded border p-1.5 text-left text-xs transition-colors ${
                      feeBps === tier.value
                        ? "border-cyan-400 bg-cyan-950/40 text-cyan-200"
                        : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="font-semibold">{tier.label}</div>
                    <div className="text-[10px] text-slate-500">{tier.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Capital & Fee Share */}
            <div className="border-t border-slate-800/80 pt-4 space-y-4">
              <Slider
                label="Deposited Capital"
                value={capital}
                min={100}
                max={500_000}
                step={500}
                display={money(capital)}
                onChange={setCapital}
              />
              <Slider
                label="Pool Liquidity Share"
                value={share}
                min={0.01}
                max={20}
                step={0.05}
                display={`${share.toFixed(2)}%`}
                onChange={setShare}
              />
            </div>

            {/* Price Range Bounds */}
            <div className="border-t border-slate-800/80 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">Concentrated Range Bounds</h3>
                <span className="text-xs text-amber-300 font-mono">
                  [{lowerRatio.toFixed(2)}x – {upperRatio.toFixed(2)}x]
                </span>
              </div>

              <Slider
                label="Lower Bound"
                value={lowerPct}
                min={-90}
                max={Math.min(upperPct - 5, 200)}
                step={1}
                display={`${lowerPct}% (${lowerRatio.toFixed(2)}x)`}
                onChange={setLowerPct}
              />

              <Slider
                label="Upper Bound"
                value={upperPct}
                min={Math.max(lowerPct + 5, -80)}
                max={500}
                step={5}
                display={`+${upperPct}% (${upperRatio.toFixed(2)}x)`}
                onChange={setUpperPct}
              />

              {/* Range Presets */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => { setLowerPct(-10); setUpperPct(10); }}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  ±10% Tight
                </button>
                <button
                  type="button"
                  onClick={() => { setLowerPct(-25); setUpperPct(25); }}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  ±25% Moderate
                </button>
                <button
                  type="button"
                  onClick={() => { setLowerPct(-50); setUpperPct(100); }}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  −50% / +100%
                </button>
                <button
                  type="button"
                  onClick={() => { setLowerPct(-90); setUpperPct(500); }}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Full AMM (V2)
                </button>
              </div>
            </div>

            {/* Simulation Horizon & Active Move */}
            <div className="border-t border-slate-800/80 pt-4 space-y-3">
              <Slider
                label="Holding Horizon"
                value={timeHorizonDays}
                min={7}
                max={365}
                step={1}
                display={`${timeHorizonDays} days`}
                onChange={setTimeHorizonDays}
              />
              <Slider
                label="Simulated Price Move"
                value={activePct}
                min={-90}
                max={500}
                step={1}
                display={`${activePct >= 0 ? "+" : ""}${activePct}% (${activeRatio.toFixed(2)}x)`}
                onChange={setActivePct}
              />
            </div>
          </aside>

          {/* Visualization & Metric Area */}
          <div className="space-y-5">
            {/* KPI Metric Cards */}
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Yield and loss estimates">
              <Metric
                label="Concentrated Fee APY"
                value={`${(concFeeApr * 100).toFixed(1)}%`}
                badge={`${multiplier.toFixed(1)}x Capital Leverage`}
                detail={isPriceInRange ? "Active: capturing multiplied pool swap fees" : "Inactive: price out of range (0% fees)"}
                color={isPriceInRange ? "text-emerald-300" : "text-slate-500"}
              />
              <Metric
                label="Concentrated IL"
                value={`${concIl.toFixed(2)}%`}
                badge={`vs HODL`}
                detail={`At ${activePct >= 0 ? "+" : ""}${activePct}% price movement`}
                color="text-rose-300"
              />
              <Metric
                label="Constant Product IL"
                value={`${cpIl.toFixed(2)}%`}
                badge="V2 Benchmark"
                detail={`Fee-free: ${cpIl.toFixed(2)}% (net ${cpNetReturn >= 0 ? "+" : ""}${cpNetReturn.toFixed(2)}%)`}
                color="text-purple-300"
              />
              <Metric
                label="Net Horizon Return"
                value={`${concNetReturn >= 0 ? "+" : ""}${concNetReturn.toFixed(2)}%`}
                badge={`${timeHorizonDays} Days`}
                detail={`Concentrated IL + ${timeHorizonDays}d accumulated fees`}
                color={concNetReturn >= 0 ? "text-cyan-300" : "text-amber-300"}
              />
            </section>

            {/* Range Status Alert */}
            {!isPriceInRange ? (
              <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200">
                <AlertTriangle size={18} className="shrink-0 text-amber-400" />
                <div>
                  <strong>Price is outside your configured liquidity range ({lowerRatio.toFixed(2)}x – {upperRatio.toFixed(2)}x).</strong> Position has converted entirely into 100% {activeRatio < lowerRatio ? "Token A" : "Token B"} and earns zero trading fees until price enters the boundary.
                </div>
              </div>
            ) : (
              <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                <CheckCircle size={18} className="shrink-0 text-emerald-400" />
                <div>
                  <strong>Position is Active and in Range.</strong> Capital is earning swap fees at an effective leverage of {multiplier.toFixed(2)}x compared to a standard constant-product AMM pool.
                </div>
              </div>
            )}

            {/* Chart Container */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Interactive Yield Curve Visualization</h2>
                  <p className="text-xs text-slate-400">
                    {activeTab === "curve"
                      ? "Yield and impermanent loss trajectories across price moves from −90% to +500%."
                      : "30-day historical performance backtest vs forward-looking projected return series."}
                  </p>
                </div>

                {/* Tab Switcher */}
                <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab("curve")}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activeTab === "curve"
                        ? "bg-cyan-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Activity size={14} /> Yield & IL Curve
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("timeseries")}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activeTab === "timeseries"
                        ? "bg-cyan-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <BarChart3 size={14} /> Historical vs Projected
                  </button>
                </div>
              </div>

              {/* Chart.js Line Chart */}
              <div className="h-[380px] w-full" aria-label="Interactive Chart.js line chart">
                {activeTab === "curve" ? (
                  <Line data={curveChartData} options={chartOptions} />
                ) : (
                  <Line data={timeseriesChartData} options={chartOptions} />
                )}
              </div>

              {/* Chart Legend / Notes */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3 text-xs text-slate-400">
                <div className="flex flex-wrap gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-sky-400" /> Concentrated Net Return
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-400" /> Concentrated IL
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-purple-400" /> Constant Product (x·y=k)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> HODL Baseline
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Model: Uniswap v3 square root price math adapted for Soroban AMM
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1.5 flex justify-between gap-2 text-slate-300">
        <span className="font-medium text-xs text-slate-300">{label}</span>
        <span className="font-mono text-xs text-cyan-300">{display}</span>
      </div>
      <input
        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-cyan-400"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="sr-only">
        {label}: {display}
      </span>
    </label>
  );
}

function Metric({
  label,
  value,
  badge,
  detail,
  color,
}: {
  label: string;
  value: string;
  badge?: string;
  detail: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-400">{label}</p>
        {badge ? (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
            {badge}
          </span>
        ) : null}
      </div>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
