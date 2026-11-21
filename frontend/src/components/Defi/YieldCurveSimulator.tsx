"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Download, Printer, RotateCcw, AlertTriangle, CheckCircle2, TrendingUp, Layers } from "lucide-react";
import {
  concentratedRelativeValue,
  concentratedImpermanentLoss,
  capitalEfficiencyMultiplier,
  concentratedFeeApr,
  estimatedFeeApr,
  impermanentLoss,
  FEE_TIERS,
} from "./yieldCurveMath";

type Scenario = {
  priceChangePct: number;
  impermanentLossPct: number;
  concentratedIlPct: number;
  concentratedReturnPct: number;
};

const MIN_CHANGE = -90;
const MAX_CHANGE = 500;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const money = (value: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export default function YieldCurveSimulator() {
  const [volume, setVolume] = useState(1_000_000);
  const [feeBps, setFeeBps] = useState(30);
  const [share, setShare] = useState(1);
  const [capital, setCapital] = useState(10_000);
  const [lowerPct, setLowerPct] = useState(-50);
  const [upperPct, setUpperPct] = useState(100);
  const [activePct, setActivePct] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"lower" | "upper" | null>(null);

  const lower = 1 + lowerPct / 100;
  const upper = 1 + upperPct / 100;
  const isInRange = activePct >= lowerPct && activePct <= upperPct;

  const baseFeeApr = estimatedFeeApr(volume, feeBps, share, capital);
  const efficiency = capitalEfficiencyMultiplier(lower, upper);
  const concFeeApr = concentratedFeeApr(volume, feeBps, share, capital, lower, upper, isInRange);

  const scenarios = useMemo<Scenario[]>(() => {
    return Array.from({ length: 120 }, (_, i) => {
      const priceChangePct = MIN_CHANGE + ((MAX_CHANGE - MIN_CHANGE) * i) / 119;
      const ratio = 1 + priceChangePct / 100;
      const inRangeHere = priceChangePct >= lowerPct && priceChangePct <= upperPct;
      const effectiveConcApr = inRangeHere ? baseFeeApr * efficiency : 0;
      const concIl = concentratedImpermanentLoss(ratio, lower, upper);
      const concReturn = concIl + effectiveConcApr * 0.25;

      return {
        priceChangePct,
        impermanentLossPct: impermanentLoss(ratio) * 100,
        concentratedIlPct: concIl * 100,
        concentratedReturnPct: concReturn * 100,
      };
    });
  }, [lower, upper, baseFeeApr, efficiency, lowerPct, upperPct]);

  const activeRatio = 1 + activePct / 100;
  const activeIl = impermanentLoss(activeRatio) * 100;
  const activeConcIl = concentratedImpermanentLoss(activeRatio, lower, upper) * 100;
  const activeConcentratedReturn = (concentratedRelativeValue(activeRatio, lower, upper) + (isInRange ? concFeeApr * 0.25 : 0)) * 100;

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = bounds.width * dpr;
    canvas.height = bounds.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const w = bounds.width,
      h = bounds.height;
    const pad = { left: 50, right: 18, top: 18, bottom: 30 };
    const x = (pct: number) => pad.left + ((pct - MIN_CHANGE) / (MAX_CHANGE - MIN_CHANGE)) * (w - pad.left - pad.right);
    const all = scenarios.flatMap((s) => [s.impermanentLossPct, s.concentratedReturnPct, s.concentratedIlPct]);
    const yMin = Math.min(-90, Math.floor(Math.min(...all) / 10) * 10);
    const yMax = Math.max(50, Math.ceil(Math.max(...all) / 10) * 10);
    const y = (v: number) => pad.top + ((yMax - v) / (yMax - yMin)) * (h - pad.top - pad.bottom);

    ctx.font = "11px system-ui";
    ctx.strokeStyle = "#263449";
    ctx.fillStyle = "#93a4ba";
    ctx.lineWidth = 1;

    for (let v = Math.ceil(yMin / 25) * 25; v <= yMax; v += 25) {
      ctx.beginPath();
      ctx.moveTo(pad.left, y(v));
      ctx.lineTo(w - pad.right, y(v));
      ctx.stroke();
      ctx.fillText(`${v}%`, 5, y(v) + 4);
    }
    for (let v = -80; v <= 500; v += 100) {
      ctx.beginPath();
      ctx.moveTo(x(v), pad.top);
      ctx.lineTo(x(v), h - pad.bottom);
      ctx.stroke();
      ctx.fillText(`${v}%`, x(v) - 10, h - 8);
    }

    // Zero-line (HODL baseline)
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y(0));
    ctx.lineTo(w - pad.right, y(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Active range highlight
    ctx.fillStyle = "rgba(16, 185, 129, 0.07)";
    const leftX = Math.max(pad.left, x(lowerPct));
    const rightX = Math.min(w - pad.right, x(upperPct));
    if (rightX > leftX) {
      ctx.fillRect(leftX, pad.top, rightX - leftX, h - pad.top - pad.bottom);
    }

    // Shade out-of-range zones
    ctx.fillStyle = "rgba(245, 158, 11, .06)";
    ctx.fillRect(pad.left, pad.top, Math.max(0, x(lowerPct) - pad.left), h - pad.top - pad.bottom);
    ctx.fillRect(x(upperPct), pad.top, Math.max(0, w - pad.right - x(upperPct)), h - pad.top - pad.bottom);

    const drawLine = (key: "impermanentLossPct" | "concentratedIlPct" | "concentratedReturnPct", color: string, dashed = false) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      scenarios.forEach((s, i) => (i ? ctx.lineTo(x(s.priceChangePct), y(s[key])) : ctx.moveTo(x(s.priceChangePct), y(s[key]))));
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Draw lines
    drawLine("impermanentLossPct", "#fb7185", true); // Constant product IL (dashed pink)
    drawLine("concentratedIlPct", "#f59e0b", false); // Concentrated IL alone (amber)
    drawLine("concentratedReturnPct", "#38bdf8", false); // Concentrated + Fees return (cyan)

    // Current active price marker
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(activePct), pad.top);
    ctx.lineTo(x(activePct), h - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lower and Upper draggable boundary markers
    [lowerPct, upperPct].forEach((v) => {
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(v), pad.top);
      ctx.lineTo(x(v), h - pad.bottom);
      ctx.stroke();
      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(x(v), pad.top + 5, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [activePct, lowerPct, upperPct, scenarios]);

  useEffect(() => {
    drawChart();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawChart);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawChart]);

  const chartPctAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp(MIN_CHANGE + ((event.clientX - rect.left - 50) / (rect.width - 68)) * (MAX_CHANGE - MIN_CHANGE), MIN_CHANGE, MAX_CHANGE);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const pct = chartPctAt(event);
    const lowerDistance = Math.abs(pct - lowerPct),
      upperDistance = Math.abs(pct - upperPct);
    if (Math.min(lowerDistance, upperDistance) < 24) {
      dragRef.current = lowerDistance <= upperDistance ? "lower" : "upper";
      event.currentTarget.setPointerCapture(event.pointerId);
    } else setActivePct(Math.round(pct));
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const pct = chartPctAt(event);
    if (dragRef.current === "lower") setLowerPct(Math.round(clamp(pct, -90, upperPct - 5)));
    else if (dragRef.current === "upper") setUpperPct(Math.round(clamp(pct, lowerPct + 5, 500)));
    else if (event.buttons) setActivePct(Math.round(pct));
  };

  const exportJson = () => {
    const config = {
      model: "Soroban Concentrated Liquidity & AMM Math Engine",
      volume,
      feeBps,
      liquiditySharePct: share,
      capital,
      range: { lowerPct, upperPct, lowerBound: lower, upperBound: upper },
      metrics: {
        baseFeeAprPct: baseFeeApr * 100,
        concentratedFeeAprPct: concFeeApr * 100,
        capitalEfficiencyMultiplier: efficiency,
        inRange: isInRange,
        activePriceChangePct: activePct,
        activeStandardIlPct: activeIl,
        activeConcentratedIlPct: activeConcIl,
        activeConcentratedReturnPct: activeConcentratedReturn,
      },
      scenarios,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `soroban-liquidity-yield-${feeBps}bps.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8" data-testid="yield-curve-simulator">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-cyan-400">
                Soroban · DeFi Lab
              </span>
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                Uniswap v3 Math Engine
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold md:text-3xl">Liquidity Yield & APY Simulator</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Explore concentrated liquidity returns, capital efficiency multipliers, and impermanent loss forecasts vs. standard AMM pools.
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={exportJson}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-cyan-400 hover:text-cyan-300"
            >
              <Download size={16} /> Export JSON
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-cyan-400 hover:text-cyan-300"
            >
              <Printer size={16} /> Print Report
            </button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-5" aria-label="Simulation parameters">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-200">Pool Assumptions</h2>
              <button
                aria-label="Reset parameters"
                title="Reset parameters"
                onClick={() => {
                  setVolume(1_000_000);
                  setFeeBps(30);
                  setShare(1);
                  setCapital(10_000);
                  setLowerPct(-50);
                  setUpperPct(100);
                  setActivePct(0);
                }}
                className="text-slate-400 hover:text-white"
              >
                <RotateCcw size={15} />
              </button>
            </div>

            <Slider label="Daily Pool Volume" value={volume} min={10_000} max={10_000_000} step={10_000} display={money(volume)} onChange={setVolume} />

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-300">Fee Tier Presets</span>
                <span className="font-mono text-cyan-200">{(feeBps / 100).toFixed(2)}%</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pb-2">
                {FEE_TIERS.map((tier) => (
                  <button
                    key={tier.bps}
                    type="button"
                    onClick={() => setFeeBps(tier.bps)}
                    className={`rounded border px-2 py-1.5 text-xs font-mono transition-colors text-left ${
                      feeBps === tier.bps
                        ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 font-semibold"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-300"
                    }`}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
              <Slider label="Custom Fee (bps)" value={feeBps} min={1} max={100} step={1} display={`${(feeBps / 100).toFixed(2)}%`} onChange={setFeeBps} />
            </div>

            <Slider label="Your Fee Share" value={share} min={0.01} max={25} step={0.01} display={`${share.toFixed(2)}%`} onChange={setShare} />
            <Slider label="Capital Deposited" value={capital} min={100} max={1_000_000} step={100} display={money(capital)} onChange={setCapital} />

            <div className="border-t border-slate-800 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-200">Concentrated Range</h3>
                <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs font-mono text-emerald-400">
                  <Layers size={12} /> {efficiency.toFixed(1)}x Capital Leverage
                </span>
              </div>
              <Slider
                label="Lower Range Bound"
                value={lowerPct}
                min={-90}
                max={Math.min(upperPct - 5, 499)}
                step={1}
                display={`${lowerPct}% (${lower.toFixed(2)}x)`}
                onChange={setLowerPct}
              />
              <div className="mt-4">
                <Slider
                  label="Upper Range Bound"
                  value={upperPct}
                  min={Math.max(lowerPct + 5, -89)}
                  max={500}
                  step={1}
                  display={`+${upperPct}% (${upper.toFixed(2)}x)`}
                  onChange={setUpperPct}
                />
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Yield estimates">
              <Metric
                label="Concentrated Fee APY"
                value={isInRange ? `${(concFeeApr * 100).toFixed(1)}%` : "0.0% (Out of Range)"}
                detail={`Base APY: ${(baseFeeApr * 100).toFixed(1)}% · ${efficiency.toFixed(1)}x boost in range`}
                color={isInRange ? "text-emerald-300" : "text-amber-400"}
              />
              <Metric
                label="Concentrated Imp. Loss"
                value={`${activeConcIl.toFixed(2)}%`}
                detail={`At ${activePct > 0 ? "+" : ""}${activePct}% price move (Standard IL: ${activeIl.toFixed(2)}%)`}
                color={activeConcIl < -10 ? "text-rose-400" : "text-amber-300"}
              />
              <Metric
                label="Net Projected Return (3mo)"
                value={`${activeConcentratedReturn.toFixed(2)}%`}
                detail={isInRange ? "Includes 1Q concentrated fees + range IL" : "Position 100% in single asset (no fees earned)"}
                color={activeConcentratedReturn >= 0 ? "text-cyan-300" : "text-rose-300"}
              />
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 md:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-200">Yield & Loss vs. Price Move</h2>
                    {isInRange ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 size={12} /> In Active Range
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/20">
                        <AlertTriangle size={12} /> Out of Range
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Drag green boundary handles to tighten range; click or drag chart to probe different price changes.
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="flex items-center gap-2 text-rose-300">
                    <i className="h-0.5 w-4 border-b-2 border-dashed border-rose-400" /> Standard Constant-Product IL
                  </span>
                  <span className="flex items-center gap-2 text-amber-300">
                    <i className="h-0.5 w-4 bg-amber-400" /> Concentrated IL
                  </span>
                  <span className="flex items-center gap-2 text-cyan-300">
                    <i className="h-0.5 w-4 bg-cyan-400" /> Concentrated + Fees (Net)
                  </span>
                  <span className="flex items-center gap-2 text-emerald-300">
                    <i className="h-0.5 w-4 bg-emerald-400" /> Active Range
                  </span>
                </div>
              </div>

              <canvas
                ref={canvasRef}
                className="h-[300px] w-full touch-none cursor-crosshair rounded-lg bg-slate-950/40"
                aria-label="Interactive chart of impermanent loss and concentrated liquidity return by price change"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
              />

              {!isInRange && (
                <div role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
                  <span>
                    Price move ({activePct > 0 ? "+" : ""}{activePct}%) is outside your configured concentrated range [{lowerPct}%, +{upperPct}%].
                    Your position is 100% converted into a single asset and ceases to accrue swap fees until price re-enters the range.
                  </span>
                </div>
              )}

              {activeConcIl <= -20 && (
                <div role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-400" />
                  <span>
                    High concentrated impermanent loss ({activeConcIl.toFixed(1)}%). Tight ranges amplify fee yields ({efficiency.toFixed(1)}x) but also magnify impermanent loss when the price diverges.
                  </span>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4" aria-label="Comparative analysis">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <TrendingUp size={16} className="text-cyan-400" /> Strategy Comparison (At Current Probe: {activePct > 0 ? "+" : ""}{activePct}%)
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400">HODL Strategy</span>
                  <p className="mt-1 font-mono text-base font-semibold text-slate-200">0.00%</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">Benchmark baseline</p>
                </div>
                <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400">Standard Pool (xy=k)</span>
                  <p className="mt-1 font-mono text-base font-semibold text-rose-300">
                    {(activeIl + baseFeeApr * 0.25 * 100).toFixed(2)}%
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">IL: {activeIl.toFixed(1)}% + 1Q fees</p>
                </div>
                <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400">Concentrated IL</span>
                  <p className="mt-1 font-mono text-base font-semibold text-amber-300">
                    {activeConcIl.toFixed(2)}%
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">Pure range IL vs hold</p>
                </div>
                <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400">Concentrated Net (1Q)</span>
                  <p className="mt-1 font-mono text-base font-semibold text-cyan-300">
                    {activeConcentratedReturn.toFixed(2)}%
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">IL + concentrated fees</p>
                </div>
              </div>
            </section>

            <p className="px-1 text-xs leading-relaxed text-slate-500">
              Mathematical Model Notes: Concentrated liquidity uses Uniswap v3 style square-root price bounds sqrt(Pa), sqrt(Pb).
              Capital efficiency multiplier is derived as 1 / (1 - sqrt(Pa / Pb)).
              Impermanent loss represents position value relative to holding the initial deposited token mix.
              Standard AMM pools use x * y = k constant product curve.
            </p>
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
      <span className="mb-2 flex justify-between gap-2 text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-cyan-200">{display}</span>
      </span>
      <input
        className="w-full accent-cyan-400"
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
  detail,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
}
