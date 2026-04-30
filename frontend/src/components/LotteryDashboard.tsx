"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Gift,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Ticket,
  Trophy,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LotteryRound {
  id: number;
  status: "Open" | "Completed" | "Cancelled";
  startTime: number;
  endTime: number;
  ticketPriceStroops: number;
  ticketPriceXlm: string;
  totalTickets: number;
  prizePoolStroops: number;
  prizePoolXlm: string;
  winnerTicketId: number | null;
  winner: string | null;
  committedSeed: string;
  claimed: boolean;
}

export interface LotteryAnalytics {
  totalRounds: number;
  completedRounds: number;
  cancelledRounds: number;
  totalTicketsSold: number;
  totalPrizePool: number;
  totalPrizesClaimed: number;
  totalPrizePoolXlm: string;
  totalPrizesClaimedXlm: string;
}

export interface LotteryStatus {
  initialized: boolean;
  paused: boolean;
  admin: string | null;
  ticketPriceStroops: number;
  ticketPriceXlm: string;
  roundCount: number;
}

interface LotteryDashboardProps {
  contractId?: string;
  walletAddress?: string;
  apiBase?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_API = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:5000";

function statusColor(status: LotteryRound["status"]) {
  switch (status) {
    case "Open": return "text-green-500 bg-green-50 dark:bg-green-900/20";
    case "Completed": return "text-blue-500 bg-blue-50 dark:bg-blue-900/20";
    case "Cancelled": return "text-red-500 bg-red-50 dark:bg-red-900/20";
  }
}

function StatusIcon({ status }: { status: LotteryRound["status"] }) {
  switch (status) {
    case "Open": return <PlayCircle className="w-4 h-4 text-green-500" />;
    case "Completed": return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
    case "Cancelled": return <XCircle className="w-4 h-4 text-red-500" />;
  }
}

function timeLeft(endTime: number): string {
  const diff = endTime - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LotteryDashboard({ contractId, walletAddress, apiBase = DEFAULT_API }: LotteryDashboardProps) {
  const [tab, setTab] = useState<"rounds" | "create" | "analytics">("rounds");
  const [rounds, setRounds] = useState<LotteryRound[]>([]);
  const [analytics, setAnalytics] = useState<LotteryAnalytics | null>(null);
  const [status, setStatus] = useState<LotteryStatus | null>(null);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Init form
  const [initAdmin, setInitAdmin] = useState(walletAddress ?? "");
  const [initPrice, setInitPrice] = useState("10000000");

  // Create round form
  const [durationSecs, setDurationSecs] = useState("3600");
  const [callerAddr, setCallerAddr] = useState(walletAddress ?? "");

  // Buy ticket form state per round
  const [buyerAddr, setBuyerAddr] = useState<Record<number, string>>({});

  // Claim/draw caller per round
  const [actionCaller, setActionCaller] = useState<Record<number, string>>({});

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // API calls
  // ---------------------------------------------------------------------------

  const apiCall = useCallback(async (path: string, method = "GET", body?: object) => {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiBase}/api/lottery${path}`, opts);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message ?? "Request failed");
    return json;
  }, [apiBase]);

  const loadStatus = useCallback(async () => {
    try {
      const r = await apiCall("/status");
      setStatus(r.data);
    } catch {
      // contract not yet initialized — status stays null
    }
  }, [apiCall]);

  const loadRounds = useCallback(async () => {
    try {
      const r = await apiCall("/rounds?limit=50");
      setRounds(r.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load rounds");
    }
  }, [apiCall]);

  const loadAnalytics = useCallback(async () => {
    try {
      const r = await apiCall("/analytics");
      setAnalytics(r.data);
    } catch {
      // analytics only available after init
    }
  }, [apiCall]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([loadStatus(), loadRounds(), loadAnalytics()]);
    } finally {
      setIsLoading(false);
    }
  }, [loadStatus, loadRounds, loadAnalytics]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function handleInit() {
    setError(null);
    try {
      await apiCall("/initialize", "POST", { admin: initAdmin, ticketPriceStroops: parseInt(initPrice, 10) });
      flash("Contract initialized");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Init failed");
    }
  }

  async function handleCreateRound() {
    setError(null);
    try {
      await apiCall("/rounds", "POST", { caller: callerAddr, durationSecs: parseInt(durationSecs, 10) });
      flash("Round started");
      setTab("rounds");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start round");
    }
  }

  async function handleBuyTicket(roundId: number) {
    const buyer = buyerAddr[roundId] ?? walletAddress ?? "";
    if (!buyer) { setError("Enter a buyer address"); return; }
    setError(null);
    try {
      const r = await apiCall(`/rounds/${roundId}/buy-ticket`, "POST", { buyer });
      flash(`Ticket #${r.data.ticketId} purchased for round ${roundId}`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Buy ticket failed");
    }
  }

  async function handleDrawWinner(roundId: number) {
    const caller = actionCaller[roundId] ?? callerAddr;
    if (!caller) { setError("Enter admin address"); return; }
    setError(null);
    try {
      const r = await apiCall(`/rounds/${roundId}/draw-winner`, "POST", { caller });
      flash(`Winner drawn: ${r.data.winner} (ticket #${r.data.winnerTicketId})`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Draw winner failed");
    }
  }

  async function handleClaimPrize(roundId: number) {
    const claimant = actionCaller[roundId] ?? walletAddress ?? "";
    if (!claimant) { setError("Enter claimant address"); return; }
    setError(null);
    try {
      const r = await apiCall(`/rounds/${roundId}/claim-prize`, "POST", { claimant });
      flash(`Prize of ${r.data.prizeXlm} XLM claimed by ${claimant}`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Claim prize failed");
    }
  }

  async function handleCancelRound(roundId: number) {
    const caller = actionCaller[roundId] ?? callerAddr;
    if (!caller) { setError("Enter admin address"); return; }
    setError(null);
    try {
      await apiCall(`/rounds/${roundId}/cancel`, "POST", { caller });
      flash(`Round ${roundId} cancelled`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleTogglePause() {
    const caller = callerAddr;
    if (!caller) { setError("Enter admin address"); return; }
    setError(null);
    try {
      const endpoint = status?.paused ? "/unpause" : "/pause";
      await apiCall(endpoint, "POST", { caller });
      flash(status?.paused ? "Contract unpaused" : "Contract paused");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Pause toggle failed");
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function RoundCard({ round }: { round: LotteryRound }) {
    const isExpanded = expandedRound === round.id;
    const toggle = () => setExpandedRound(isExpanded ? null : round.id);
    const now = Math.floor(Date.now() / 1000);
    const isEnded = now >= round.endTime;

    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <StatusIcon status={round.status} />
            <span className="font-semibold text-slate-900 dark:text-white">Round #{round.id}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(round.status)}`}>
              {round.status}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span className="flex items-center gap-1"><Ticket className="w-3.5 h-3.5" />{round.totalTickets}</span>
            <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5" />{round.prizePoolXlm} XLM</span>
            {round.status === "Open" && <span className="text-amber-500 font-mono text-xs">{timeLeft(round.endTime)}</span>}
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {isExpanded && (
          <div className="p-4 space-y-4 bg-white dark:bg-slate-900">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                <div className="text-slate-500 text-xs mb-1">Ticket Price</div>
                <div className="font-semibold">{round.ticketPriceXlm} XLM</div>
              </div>
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                <div className="text-slate-500 text-xs mb-1">Prize Pool</div>
                <div className="font-semibold text-green-600">{round.prizePoolXlm} XLM</div>
              </div>
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                <div className="text-slate-500 text-xs mb-1">Tickets Sold</div>
                <div className="font-semibold">{round.totalTickets}</div>
              </div>
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                <div className="text-slate-500 text-xs mb-1">Status</div>
                <div className="font-semibold">{round.status}</div>
              </div>
            </div>

            {round.winner && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold text-amber-700 dark:text-amber-300">Winner: </span>
                  <span className="font-mono text-xs break-all">{round.winner}</span>
                  <span className="ml-2 text-amber-600">(ticket #{round.winnerTicketId})</span>
                  {round.claimed && <span className="ml-2 text-green-600 font-semibold">• Claimed</span>}
                </div>
              </div>
            )}

            <div className="text-xs text-slate-400 font-mono break-all">
              Seed: {round.committedSeed}
            </div>

            {/* Admin address for actions */}
            <input
              className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
              placeholder="Admin/caller address"
              value={actionCaller[round.id] ?? ""}
              onChange={e => setActionCaller(c => ({ ...c, [round.id]: e.target.value }))}
            />

            <div className="flex flex-wrap gap-2">
              {round.status === "Open" && (
                <>
                  <div className="flex gap-2 w-full">
                    <input
                      className="flex-1 text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                      placeholder="Buyer address"
                      value={buyerAddr[round.id] ?? walletAddress ?? ""}
                      onChange={e => setBuyerAddr(b => ({ ...b, [round.id]: e.target.value }))}
                    />
                    <button
                      onClick={() => handleBuyTicket(round.id)}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                    >
                      <Ticket className="w-3.5 h-3.5" /> Buy Ticket
                    </button>
                  </div>
                  {isEnded && (
                    <button
                      onClick={() => handleDrawWinner(round.id)}
                      className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                    >
                      <Trophy className="w-3.5 h-3.5" /> Draw Winner
                    </button>
                  )}
                  <button
                    onClick={() => handleCancelRound(round.id)}
                    className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Cancel
                  </button>
                </>
              )}

              {round.status === "Completed" && !round.claimed && (
                <button
                  onClick={() => handleClaimPrize(round.id)}
                  className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  <Gift className="w-3.5 h-3.5" /> Claim Prize
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <Trophy className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Lottery</h2>
            {contractId && (
              <p className="text-xs text-slate-400 font-mono">{contractId.slice(0, 12)}…{contractId.slice(-6)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${status.paused ? "bg-red-50 text-red-600 dark:bg-red-900/20" : "bg-green-50 text-green-600 dark:bg-green-900/20"}`}>
              {status.paused ? <Lock className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
              {status.paused ? "Paused" : "Active"}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <RefreshCw className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Not initialized */}
      {!status?.initialized && (
        <div className="mb-6 p-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg space-y-3">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Initialize Contract</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
              placeholder="Admin address"
              value={initAdmin}
              onChange={e => setInitAdmin(e.target.value)}
            />
            <input
              type="number"
              className="text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
              placeholder="Ticket price (stroops)"
              value={initPrice}
              onChange={e => setInitPrice(e.target.value)}
            />
          </div>
          <button
            onClick={handleInit}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Initialize
          </button>
        </div>
      )}

      {/* Tabs */}
      {status?.initialized && (
        <>
          <div className="flex gap-1 mb-6 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
            {(["rounds", "create", "analytics"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
              >
                {t === "rounds" ? "Rounds" : t === "create" ? "New Round" : "Analytics"}
              </button>
            ))}
          </div>

          {/* Rounds tab */}
          {tab === "rounds" && (
            <div className="space-y-3">
              {/* Admin controls */}
              <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <input
                  className="flex-1 min-w-[180px] text-sm px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                  placeholder="Admin address (for pause/unpause)"
                  value={callerAddr}
                  onChange={e => setCallerAddr(e.target.value)}
                />
                <button
                  onClick={handleTogglePause}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status.paused ? "bg-green-600 hover:bg-green-700 text-white" : "bg-orange-500 hover:bg-orange-600 text-white"}`}
                >
                  {status.paused ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                  {status.paused ? "Unpause" : "Pause"}
                </button>
              </div>

              {rounds.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No rounds yet. Start one from the "New Round" tab.</p>
                </div>
              ) : (
                rounds.map(r => <RoundCard key={r.id} round={r} />)
              )}
            </div>
          )}

          {/* Create round tab */}
          {tab === "create" && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Admin address</label>
                <input
                  className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                  placeholder="Admin wallet address"
                  value={callerAddr}
                  onChange={e => setCallerAddr(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Duration (seconds)</label>
                <input
                  type="number"
                  className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                  placeholder="3600"
                  value={durationSecs}
                  onChange={e => setDurationSecs(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">{Math.floor(parseInt(durationSecs, 10) / 3600)}h {Math.floor((parseInt(durationSecs, 10) % 3600) / 60)}m</p>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm text-slate-600 dark:text-slate-400">
                Ticket price: <span className="font-semibold">{status.ticketPriceXlm} XLM</span> ({status.ticketPriceStroops} stroops)
              </div>
              <button
                onClick={handleCreateRound}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> Start Round
              </button>
            </div>
          )}

          {/* Analytics tab */}
          {tab === "analytics" && analytics && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: "Total Rounds", value: analytics.totalRounds, color: "text-slate-900 dark:text-white" },
                  { label: "Completed", value: analytics.completedRounds, color: "text-blue-600" },
                  { label: "Cancelled", value: analytics.cancelledRounds, color: "text-red-500" },
                  { label: "Tickets Sold", value: analytics.totalTicketsSold.toLocaleString(), color: "text-indigo-600" },
                  { label: "Total Prize Pool", value: `${analytics.totalPrizePoolXlm} XLM`, color: "text-green-600" },
                  { label: "Prizes Claimed", value: `${analytics.totalPrizesClaimedXlm} XLM`, color: "text-amber-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                    <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {analytics.totalRounds > 0 && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Round Outcomes</div>
                  <div className="flex gap-2 items-center h-6">
                    {analytics.completedRounds > 0 && (
                      <div
                        className="h-full bg-blue-500 rounded"
                        style={{ width: `${(analytics.completedRounds / analytics.totalRounds) * 100}%` }}
                        title={`Completed: ${analytics.completedRounds}`}
                      />
                    )}
                    {analytics.cancelledRounds > 0 && (
                      <div
                        className="h-full bg-red-400 rounded"
                        style={{ width: `${(analytics.cancelledRounds / analytics.totalRounds) * 100}%` }}
                        title={`Cancelled: ${analytics.cancelledRounds}`}
                      />
                    )}
                    {(analytics.totalRounds - analytics.completedRounds - analytics.cancelledRounds) > 0 && (
                      <div
                        className="h-full bg-green-400 rounded"
                        style={{ width: `${((analytics.totalRounds - analytics.completedRounds - analytics.cancelledRounds) / analytics.totalRounds) * 100}%` }}
                        title="Open"
                      />
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-full inline-block" />Completed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded-full inline-block" />Cancelled</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-400 rounded-full inline-block" />Open</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "analytics" && !analytics && (
            <div className="text-center py-12 text-slate-400">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No analytics available yet.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
