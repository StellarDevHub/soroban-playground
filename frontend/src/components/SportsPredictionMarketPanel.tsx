"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Clock,
  Coins,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  TrendingUp,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SportOutcome = 0 | 1 | 2; // 0=Home, 1=Draw, 2=Away

export interface SportMarket {
  id: number;
  description: string;
  sport: number;
  homeTeam: string;
  awayTeam: string;
  status: "Open" | "Resolved" | "Cancelled";
  resolutionDeadline: number;
  oddsHomeBp: number;
  oddsDrawBp: number;
  oddsAwayBp: number;
  totalHomeStake: number;
  totalDrawStake: number;
  totalAwayStake: number;
  winningOutcome?: number;
  createdAt: number;
}

export interface PoolAnalytics {
  totalPool: number;
  home: { pctBp: number; pct: string };
  draw: { pctBp: number; pct: string };
  away: { pctBp: number; pct: string };
}

const SPORT_LABELS: Record<number, string> = {
  0: "🏈 Football",
  1: "🏀 Basketball",
  2: "⚾ Baseball",
  3: "⚽ Soccer",
  4: "🎾 Tennis",
  5: "🏆 Other",
};

const OUTCOME_LABELS: Record<number, string> = {
  0: "Home",
  1: "Draw",
  2: "Away",
};

function bpToMultiplier(bp: number): string {
  return (bp / 10000).toFixed(2) + "x";
}

function formatDeadline(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

// ── API client ────────────────────────────────────────────────────────────────

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

async function apiGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

// ── AnalyticsBar ──────────────────────────────────────────────────────────────

function AnalyticsBar({ analytics }: { analytics: PoolAnalytics }) {
  const { home, draw, away, totalPool } = analytics;
  return (
    <div className="mt-3 space-y-1" aria-label="Pool analytics">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Pool: {totalPool.toLocaleString()} stroops</span>
      </div>
      <div className="flex h-3 rounded overflow-hidden" role="img" aria-label="Stake distribution">
        <div
          className="bg-blue-500 transition-all"
          style={{ width: `${home.pct}%` }}
          title={`Home ${home.pct}%`}
        />
        <div
          className="bg-yellow-400 transition-all"
          style={{ width: `${draw.pct}%` }}
          title={`Draw ${draw.pct}%`}
        />
        <div
          className="bg-red-500 transition-all"
          style={{ width: `${away.pct}%` }}
          title={`Away ${away.pct}%`}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-blue-400">Home {home.pct}%</span>
        <span className="text-yellow-400">Draw {draw.pct}%</span>
        <span className="text-red-400">Away {away.pct}%</span>
      </div>
    </div>
  );
}

// ── MarketCard ────────────────────────────────────────────────────────────────

interface MarketCardProps {
  market: SportMarket;
  contractId: string;
  walletAddress: string;
  onRefresh: () => void;
}

function MarketCard({ market, contractId, walletAddress, onRefresh }: MarketCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [betOutcome, setBetOutcome] = useState<SportOutcome>(0);
  const [betStake, setBetStake] = useState("");
  const [payout, setPayout] = useState<number | null>(null);
  const [analytics, setAnalytics] = useState<PoolAnalytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const statusColor =
    market.status === "Open"
      ? "text-green-400"
      : market.status === "Resolved"
      ? "text-blue-400"
      : "text-gray-400";

  const StatusIcon =
    market.status === "Open"
      ? Activity
      : market.status === "Resolved"
      ? CheckCircle2
      : XCircle;

  async function loadAnalytics() {
    try {
      const data = await apiGet(`/api/sports-markets/${market.id}/analytics`, {
        contractId,
      });
      setAnalytics(data.analytics);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    if (expanded) loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function handleBet() {
    if (!walletAddress) return setError("Connect wallet first");
    const stake = parseInt(betStake, 10);
    if (!stake || stake <= 0) return setError("Enter a valid stake");
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/sports-markets/${market.id}/bet`, {
        contractId,
        bettor: walletAddress,
        outcome: betOutcome,
        stake,
      });
      setBetStake("");
      onRefresh();
      await loadAnalytics();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePayout() {
    if (!walletAddress) return setError("Connect wallet first");
    setBusy(true);
    setError("");
    try {
      const data = await apiGet(
        `/api/sports-markets/${market.id}/payout/${walletAddress}`,
        { contractId }
      );
      setPayout(data.payout);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Payout query failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="bg-gray-800 border border-gray-700 rounded-lg p-4"
      aria-label={`Market: ${market.description}`}
    >
      {/* Header */}
      <button
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400">{SPORT_LABELS[market.sport] ?? "Sport"}</p>
            <h3 className="font-semibold text-white truncate">{market.description}</h3>
            <p className="text-sm text-gray-300">
              {market.homeTeam} vs {market.awayTeam}
            </p>
          </div>
          <span className={`flex items-center gap-1 text-xs font-medium ${statusColor}`}>
            <StatusIcon size={12} aria-hidden />
            {market.status}
          </span>
        </div>

        {/* Odds row */}
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          {[
            { label: market.homeTeam, bp: market.oddsHomeBp, color: "bg-blue-900 text-blue-300" },
            { label: "Draw", bp: market.oddsDrawBp, color: "bg-yellow-900 text-yellow-300" },
            { label: market.awayTeam, bp: market.oddsAwayBp, color: "bg-red-900 text-red-300" },
          ].map(({ label, bp, color }) => (
            <div key={label} className={`rounded px-2 py-1 ${color}`}>
              <div className="font-bold">{bpToMultiplier(bp)}</div>
              <div className="truncate">{label}</div>
            </div>
          ))}
        </div>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="mt-4 space-y-3 border-t border-gray-700 pt-3">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={11} aria-hidden />
            Deadline: {formatDeadline(market.resolutionDeadline)}
          </p>

          {analytics && <AnalyticsBar analytics={analytics} />}

          {market.status === "Open" && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-300">Place Bet</p>
              <div className="flex gap-2">
                {([0, 1, 2] as SportOutcome[]).map((o) => (
                  <button
                    key={o}
                    onClick={() => setBetOutcome(o)}
                    className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                      betOutcome === o
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                    aria-pressed={betOutcome === o}
                  >
                    {OUTCOME_LABELS[o]}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Stake (stroops)"
                  value={betStake}
                  onChange={(e) => setBetStake(e.target.value)}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  aria-label="Bet stake amount"
                />
                <button
                  onClick={handleBet}
                  disabled={busy}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded transition-colors"
                >
                  {busy ? "…" : "Bet"}
                </button>
              </div>
            </div>
          )}

          {market.status === "Resolved" && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400">
                Winner:{" "}
                <span className="text-white font-medium">
                  {market.winningOutcome !== undefined
                    ? OUTCOME_LABELS[market.winningOutcome]
                    : "—"}
                </span>
              </p>
              <button
                onClick={handlePayout}
                disabled={busy}
                className="w-full py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
              >
                {busy ? "Checking…" : "Check My Payout"}
              </button>
              {payout !== null && (
                <p className="text-xs text-green-400 flex items-center gap-1">
                  <Coins size={11} aria-hidden />
                  Payout: {payout.toLocaleString()} stroops
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1" role="alert">
              <AlertTriangle size={11} aria-hidden />
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// ── CreateMarketForm ──────────────────────────────────────────────────────────

interface CreateMarketFormProps {
  contractId: string;
  walletAddress: string;
  onCreated: () => void;
}

function CreateMarketForm({ contractId, walletAddress, onCreated }: CreateMarketFormProps) {
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState(3);
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [oracle, setOracle] = useState("");
  const [deadlineHours, setDeadlineHours] = useState("48");
  const [oddsHome, setOddsHome] = useState("20000");
  const [oddsDraw, setOddsDraw] = useState("32000");
  const [oddsAway, setOddsAway] = useState("22000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return setError("Connect wallet first");
    setBusy(true);
    setError("");
    try {
      const deadline = Math.floor(Date.now() / 1000) + parseInt(deadlineHours, 10) * 3600;
      await apiPost("/api/sports-markets", {
        contractId,
        creator: walletAddress,
        description,
        sport,
        homeTeam,
        awayTeam,
        resolutionDeadline: deadline,
        oracle,
        oddsHomeBp: parseInt(oddsHome, 10),
        oddsDrawBp: parseInt(oddsDraw, 10),
        oddsAwayBp: parseInt(oddsAway, 10),
      });
      setDescription("");
      setHomeTeam("");
      setAwayTeam("");
      setOracle("");
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="Create sports market">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-xs text-gray-400 mb-1" htmlFor="spm-description">
            Match Description
          </label>
          <input
            id="spm-description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Lakers vs Celtics – 2026-05-01"
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="spm-sport">
            Sport
          </label>
          <select
            id="spm-sport"
            value={sport}
            onChange={(e) => setSport(Number(e.target.value))}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            {Object.entries(SPORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="spm-deadline">
            Deadline (hours)
          </label>
          <input
            id="spm-deadline"
            type="number"
            min="1"
            value={deadlineHours}
            onChange={(e) => setDeadlineHours(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="spm-home">
            Home Team
          </label>
          <input
            id="spm-home"
            required
            value={homeTeam}
            onChange={(e) => setHomeTeam(e.target.value)}
            placeholder="Lakers"
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="spm-away">
            Away Team
          </label>
          <input
            id="spm-away"
            required
            value={awayTeam}
            onChange={(e) => setAwayTeam(e.target.value)}
            placeholder="Celtics"
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-400 mb-1" htmlFor="spm-oracle">
            Oracle Address
          </label>
          <input
            id="spm-oracle"
            required
            value={oracle}
            onChange={(e) => setOracle(e.target.value)}
            placeholder="G…"
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Odds */}
      <div>
        <p className="text-xs text-gray-400 mb-1">
          Odds (basis points — 10000 = 1.00x, 20000 = 2.00x)
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "spm-odds-home", label: "Home", val: oddsHome, set: setOddsHome },
            { id: "spm-odds-draw", label: "Draw", val: oddsDraw, set: setOddsDraw },
            { id: "spm-odds-away", label: "Away", val: oddsAway, set: setOddsAway },
          ].map(({ id, label, val, set }) => (
            <div key={id}>
              <label className="block text-xs text-gray-500 mb-0.5" htmlFor={id}>
                {label}
              </label>
              <input
                id={id}
                type="number"
                min="10100"
                value={val}
                onChange={(e) => set(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1" role="alert">
          <AlertTriangle size={11} aria-hidden />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
      >
        {busy ? "Creating…" : "Create Market"}
      </button>
    </form>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export interface SportsPredictionMarketPanelProps {
  contractId?: string;
  walletAddress?: string;
}

export default function SportsPredictionMarketPanel({
  contractId = "",
  walletAddress = "",
}: SportsPredictionMarketPanelProps) {
  const [tab, setTab] = useState<"markets" | "create" | "admin">("markets");
  const [markets, setMarkets] = useState<SportMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);

  const fetchMarkets = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    setError("");
    try {
      // Get count then fetch each market
      const countData = await apiGet("/api/sports-markets", { contractId });
      const count: number = countData.marketCount ?? 0;
      const fetched: SportMarket[] = [];
      for (let i = 1; i <= count; i++) {
        try {
          const d = await apiGet(`/api/sports-markets/${i}`, { contractId });
          if (d.market) fetched.push(d.market as SportMarket);
        } catch {
          // skip missing
        }
      }
      setMarkets(fetched.reverse()); // newest first
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  async function togglePause() {
    if (!contractId) return;
    setAdminBusy(true);
    try {
      await apiPost(`/api/sports-markets/${paused ? "unpause" : "pause"}`, { contractId });
      setPaused((v) => !v);
    } catch {
      // ignore
    } finally {
      setAdminBusy(false);
    }
  }

  const openCount = markets.filter((m) => m.status === "Open").length;
  const resolvedCount = markets.filter((m) => m.status === "Resolved").length;

  return (
    <section
      className="bg-gray-900 text-white rounded-xl border border-gray-700 overflow-hidden"
      aria-label="Sports Prediction Market"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-indigo-400" aria-hidden />
          <h2 className="font-semibold text-sm">Sports Prediction Market</h2>
          {paused && (
            <span className="text-xs bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">
              Paused
            </span>
          )}
        </div>
        <button
          onClick={fetchMarkets}
          disabled={loading}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Refresh markets"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 divide-x divide-gray-700 border-b border-gray-700 text-center text-xs">
        <div className="py-2">
          <div className="font-bold text-white">{markets.length}</div>
          <div className="text-gray-400">Total</div>
        </div>
        <div className="py-2">
          <div className="font-bold text-green-400">{openCount}</div>
          <div className="text-gray-400">Open</div>
        </div>
        <div className="py-2">
          <div className="font-bold text-blue-400">{resolvedCount}</div>
          <div className="text-gray-400">Resolved</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 text-xs">
        {(["markets", "create", "admin"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-indigo-500 text-indigo-400"
                : "text-gray-400 hover:text-white"
            }`}
            aria-selected={tab === t}
            role="tab"
          >
            {t === "markets" && <BarChart2 size={11} className="inline mr-1" aria-hidden />}
            {t === "create" && <Plus size={11} className="inline mr-1" aria-hidden />}
            {t === "admin" && <Activity size={11} className="inline mr-1" aria-hidden />}
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-4">
        {!contractId && (
          <p className="text-xs text-yellow-400 flex items-center gap-1 mb-3" role="alert">
            <AlertTriangle size={12} aria-hidden />
            Enter a contract ID to interact with the market.
          </p>
        )}

        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1 mb-3" role="alert">
            <AlertTriangle size={12} aria-hidden />
            {error}
          </p>
        )}

        {/* Markets tab */}
        {tab === "markets" && (
          <div className="space-y-3">
            {loading && (
              <p className="text-xs text-gray-400 text-center py-4">Loading markets…</p>
            )}
            {!loading && markets.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-4">
                No markets found. Create one to get started.
              </p>
            )}
            {markets.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                contractId={contractId}
                walletAddress={walletAddress}
                onRefresh={fetchMarkets}
              />
            ))}
          </div>
        )}

        {/* Create tab */}
        {tab === "create" && (
          <CreateMarketForm
            contractId={contractId}
            walletAddress={walletAddress}
            onCreated={() => {
              setTab("markets");
              fetchMarkets();
            }}
          />
        )}

        {/* Admin tab */}
        {tab === "admin" && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Activity size={14} className="text-indigo-400" aria-hidden />
                Contract Controls
              </h3>
              <button
                onClick={togglePause}
                disabled={adminBusy || !contractId}
                className={`w-full py-2 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  paused
                    ? "bg-green-700 hover:bg-green-600"
                    : "bg-yellow-700 hover:bg-yellow-600"
                } disabled:opacity-50`}
                aria-label={paused ? "Unpause contract" : "Pause contract"}
              >
                {paused ? (
                  <>
                    <PlayCircle size={14} aria-hidden /> Unpause Contract
                  </>
                ) : (
                  <>
                    <PauseCircle size={14} aria-hidden /> Pause Contract
                  </>
                )}
              </button>
              <p className="text-xs text-gray-400">
                Pausing prevents new bets and market creation. Existing markets and
                payouts are unaffected.
              </p>
            </div>

            <div className="bg-gray-800 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Coins size={14} className="text-indigo-400" aria-hidden />
                Market Summary
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-gray-400">Total Markets</dt>
                <dd className="text-white font-medium">{markets.length}</dd>
                <dt className="text-gray-400">Open</dt>
                <dd className="text-green-400 font-medium">{openCount}</dd>
                <dt className="text-gray-400">Resolved</dt>
                <dd className="text-blue-400 font-medium">{resolvedCount}</dd>
                <dt className="text-gray-400">Cancelled</dt>
                <dd className="text-gray-400 font-medium">
                  {markets.filter((m) => m.status === "Cancelled").length}
                </dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
