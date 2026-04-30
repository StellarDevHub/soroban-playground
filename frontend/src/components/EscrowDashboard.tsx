"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  FileText,
  Gavel,
  Gift,
  Loader2,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MilestoneStatus = "Pending" | "InProgress" | "UnderReview" | "Approved" | "Rejected" | "Paid";
export type EscrowStatus = "Pending" | "Active" | "Completed" | "Disputed" | "Cancelled";

export interface EscrowMilestone {
  id: number;
  escrowId: number;
  amount: number;
  status: MilestoneStatus;
}

export interface EscrowContract {
  id: number;
  client: string;
  freelancer: string;
  arbiter: string;
  totalAmount: number;
  paidAmount: number;
  milestoneCount: number;
  status: EscrowStatus;
  createdAt: number;
  arbiterFeeBps: number;
  milestones: EscrowMilestone[];
}

export interface EscrowAnalytics {
  totalEscrows: number;
  activeEscrows: number;
  completedEscrows: number;
  disputedEscrows: number;
  cancelledEscrows: number;
  totalValueLocked: number;
  totalPaidOut: number;
}

interface EscrowDashboardProps {
  contractId?: string;
  walletAddress?: string;
  apiBase?: string;
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const DEFAULT_API = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:5000";

function escrowStatusColor(status: EscrowStatus) {
  switch (status) {
    case "Pending":   return "text-slate-500 bg-slate-100 dark:bg-slate-800";
    case "Active":    return "text-green-600 bg-green-50 dark:bg-green-900/20";
    case "Completed": return "text-blue-600 bg-blue-50 dark:bg-blue-900/20";
    case "Disputed":  return "text-orange-500 bg-orange-50 dark:bg-orange-900/20";
    case "Cancelled": return "text-red-500 bg-red-50 dark:bg-red-900/20";
  }
}

function milestoneStatusColor(status: MilestoneStatus) {
  switch (status) {
    case "Pending":     return "text-slate-400";
    case "InProgress":  return "text-indigo-500";
    case "UnderReview": return "text-amber-500";
    case "Approved":    return "text-green-500";
    case "Rejected":    return "text-red-500";
    case "Paid":        return "text-blue-500";
  }
}

function shortenAddr(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}

function pct(paid: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((paid / total) * 100));
}

// ---------------------------------------------------------------------------
// MilestoneRow — stable component identity (defined outside parent)
// ---------------------------------------------------------------------------

interface MilestoneRowProps {
  milestone: EscrowMilestone;
  escrow: EscrowContract;
  caller: string;
  onSubmit: (escrowId: number, milestoneId: number) => void;
  onApprove: (escrowId: number, milestoneId: number) => void;
  onReject: (escrowId: number, milestoneId: number) => void;
  onRelease: (escrowId: number, milestoneId: number) => void;
}

function MilestoneRow({ milestone, escrow, caller, onSubmit, onApprove, onReject, onRelease }: MilestoneRowProps) {
  const isFreelancer = caller === escrow.freelancer;
  const isClient = caller === escrow.client;

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-slate-400 w-5 shrink-0">#{milestone.id}</span>
        <span className={`text-xs font-medium ${milestoneStatusColor(milestone.status)}`}>
          {milestone.status}
        </span>
        <span className="text-xs text-slate-500 font-mono">{milestone.amount.toLocaleString()} stroops</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {milestone.status === "InProgress" && isFreelancer && escrow.status === "Active" && (
          <button
            onClick={() => onSubmit(escrow.id, milestone.id)}
            className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
          >
            Submit
          </button>
        )}
        {milestone.status === "UnderReview" && isClient && escrow.status === "Active" && (
          <>
            <button
              onClick={() => onApprove(escrow.id, milestone.id)}
              className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center gap-1"
            >
              <ThumbsUp className="w-3 h-3" /> Approve
            </button>
            <button
              onClick={() => onReject(escrow.id, milestone.id)}
              className="text-xs px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded transition-colors flex items-center gap-1"
            >
              <ThumbsDown className="w-3 h-3" /> Reject
            </button>
          </>
        )}
        {milestone.status === "Approved" && isClient && escrow.status === "Active" && (
          <button
            onClick={() => onRelease(escrow.id, milestone.id)}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1"
          >
            <Gift className="w-3 h-3" /> Release
          </button>
        )}
        {milestone.status === "Paid" && (
          <CheckCircle2 className="w-4 h-4 text-blue-400" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EscrowCard — stable component identity (defined outside parent)
// ---------------------------------------------------------------------------

interface EscrowCardProps {
  escrow: EscrowContract;
  expanded: boolean;
  onToggle: () => void;
  caller: string;
  onDeposit: (id: number) => void;
  onDispute: (id: number) => void;
  onResolve: (id: number, ruling: number) => void;
  onCancel: (id: number) => void;
  onSubmitMilestone: (escrowId: number, milestoneId: number) => void;
  onApproveMilestone: (escrowId: number, milestoneId: number) => void;
  onRejectMilestone: (escrowId: number, milestoneId: number) => void;
  onReleaseMilestone: (escrowId: number, milestoneId: number) => void;
}

function EscrowCard({
  escrow, expanded, onToggle, caller,
  onDeposit, onDispute, onResolve, onCancel,
  onSubmitMilestone, onApproveMilestone, onRejectMilestone, onReleaseMilestone,
}: EscrowCardProps) {
  const progress = pct(escrow.paidAmount, escrow.totalAmount);
  const isClient = caller === escrow.client;
  const isArbiter = caller === escrow.arbiter;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-white">Escrow #{escrow.id}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${escrowStatusColor(escrow.status)}`}>
            {escrow.status}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-500 shrink-0">
          <span className="flex items-center gap-1 hidden sm:flex">
            <Coins className="w-3.5 h-3.5" />
            {escrow.totalAmount.toLocaleString()}
          </span>
          <span className="text-xs font-mono">{progress}%</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-white dark:bg-slate-900">
          {/* Parties */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {[
              { icon: <User className="w-3 h-3" />, label: "Client", addr: escrow.client },
              { icon: <User className="w-3 h-3" />, label: "Freelancer", addr: escrow.freelancer },
              { icon: <Gavel className="w-3 h-3" />, label: "Arbiter", addr: escrow.arbiter },
            ].map(({ icon, label, addr }) => (
              <div key={label} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <span className="text-slate-400">{icon}</span>
                <div>
                  <div className="text-slate-400 uppercase tracking-wide text-[10px]">{label}</div>
                  <div className="font-mono text-slate-700 dark:text-slate-300">{shortenAddr(addr)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Progress</span>
              <span>{escrow.paidAmount.toLocaleString()} / {escrow.totalAmount.toLocaleString()} stroops</span>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Milestones */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Milestones</div>
            {escrow.milestones.map(m => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                escrow={escrow}
                caller={caller}
                onSubmit={onSubmitMilestone}
                onApprove={onApproveMilestone}
                onReject={onRejectMilestone}
                onRelease={onReleaseMilestone}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            {escrow.status === "Pending" && isClient && (
              <>
                <button
                  onClick={() => onDeposit(escrow.id)}
                  className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  <Coins className="w-3.5 h-3.5" /> Deposit & Activate
                </button>
                <button
                  onClick={() => onCancel(escrow.id)}
                  className="flex items-center gap-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Cancel
                </button>
              </>
            )}
            {escrow.status === "Active" && (isClient || caller === escrow.freelancer) && (
              <button
                onClick={() => onDispute(escrow.id)}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Raise Dispute
              </button>
            )}
            {escrow.status === "Disputed" && isArbiter && (
              <div className="flex flex-wrap gap-2">
                <div className="w-full text-xs text-slate-500 font-medium">Ruling:</div>
                <button
                  onClick={() => onResolve(escrow.id, 0)}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                >
                  Freelancer Wins
                </button>
                <button
                  onClick={() => onResolve(escrow.id, 1)}
                  className="flex items-center gap-1.5 bg-slate-600 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                >
                  Client Wins
                </button>
                <button
                  onClick={() => onResolve(escrow.id, 2)}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                >
                  Split 50/50
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function EscrowDashboard({ contractId, walletAddress, apiBase = DEFAULT_API }: EscrowDashboardProps) {
  const [tab, setTab] = useState<"escrows" | "create" | "analytics">("escrows");
  const [escrowList, setEscrowList] = useState<EscrowContract[]>([]);
  const [analytics, setAnalytics] = useState<EscrowAnalytics | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [arbiterFeeBps, setArbiterFeeBps] = useState(200);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Init form
  const [initAdmin, setInitAdmin] = useState(walletAddress ?? "");
  const [initFeeBps, setInitFeeBps] = useState("200");

  // Create form
  const [formCaller, setFormCaller] = useState(walletAddress ?? "");
  const [formFreelancer, setFormFreelancer] = useState("");
  const [formArbiter, setFormArbiter] = useState("");
  const [formTotal, setFormTotal] = useState("10000000");
  const [formMilestones, setFormMilestones] = useState("5000000,3000000,2000000");

  // Caller for actions
  const [actionCaller, setActionCaller] = useState(walletAddress ?? "");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync wallet address after mount
  useEffect(() => {
    if (walletAddress) {
      setInitAdmin(a => a || walletAddress);
      setFormCaller(a => a || walletAddress);
      setActionCaller(a => a || walletAddress);
    }
  }, [walletAddress]);

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  const apiCall = useCallback(async (path: string, method = "GET", body?: object) => {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiBase}/api/escrow${path}`, opts);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message ?? "Request failed");
    return json;
  }, [apiBase]);

  const loadAll = useCallback(async () => {
    try {
      const statusRes = await apiCall("/status");
      setInitialized(statusRes.data.initialized);
      setArbiterFeeBps(statusRes.data.arbiterFeeBps ?? 200);
    } catch { /* not yet initialized */ }

    try {
      const roundsRes = await apiCall("/escrows?limit=50");
      setEscrowList(roundsRes.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load escrows");
    }

    try {
      const analyticsRes = await apiCall("/analytics");
      setAnalytics(analyticsRes.data);
    } catch { /* not yet initialized */ }
  }, [apiCall]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try { await loadAll(); } finally { setIsLoading(false); }
  }, [loadAll]);

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
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  async function handleInit() {
    setError(null);
    try {
      await apiCall("/initialize", "POST", { admin: initAdmin, arbiterFeeBps: parseInt(initFeeBps, 10) });
      flash("Contract initialized");
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Init failed"); }
  }

  async function handleCreate() {
    setError(null);
    const amounts = formMilestones.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (amounts.length === 0) { setError("Enter comma-separated milestone amounts"); return; }
    try {
      const r = await apiCall("/escrows", "POST", {
        client: formCaller,
        freelancer: formFreelancer,
        arbiter: formArbiter,
        totalAmount: Number(formTotal),
        milestoneAmounts: amounts,
      });
      flash(`Escrow #${r.data.id} created`);
      setTab("escrows");
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Create failed"); }
  }

  async function handleDeposit(id: number) {
    setError(null);
    try {
      await apiCall(`/escrows/${id}/deposit`, "POST", { caller: actionCaller });
      flash(`Escrow #${id} activated`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Deposit failed"); }
  }

  async function handleDispute(id: number) {
    setError(null);
    try {
      await apiCall(`/escrows/${id}/dispute`, "POST", { caller: actionCaller });
      flash(`Dispute raised on escrow #${id}`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Dispute failed"); }
  }

  async function handleResolve(id: number, ruling: number) {
    setError(null);
    try {
      const r = await apiCall(`/escrows/${id}/resolve`, "POST", { caller: actionCaller, ruling });
      const labels = ["Freelancer Wins", "Client Wins", "Split 50/50"];
      flash(`Dispute resolved: ${labels[ruling]} — payout ${r.data.freelancerPayout} stroops`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Resolve failed"); }
  }

  async function handleCancel(id: number) {
    setError(null);
    try {
      await apiCall(`/escrows/${id}/cancel`, "POST", { caller: actionCaller });
      flash(`Escrow #${id} cancelled`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Cancel failed"); }
  }

  async function handleSubmitMilestone(escrowId: number, milestoneId: number) {
    setError(null);
    try {
      await apiCall(`/escrows/${escrowId}/milestones/${milestoneId}/submit`, "POST", { caller: actionCaller });
      flash(`Milestone #${milestoneId} submitted`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Submit failed"); }
  }

  async function handleApproveMilestone(escrowId: number, milestoneId: number) {
    setError(null);
    try {
      await apiCall(`/escrows/${escrowId}/milestones/${milestoneId}/approve`, "POST", { caller: actionCaller });
      flash(`Milestone #${milestoneId} approved`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Approve failed"); }
  }

  async function handleRejectMilestone(escrowId: number, milestoneId: number) {
    setError(null);
    try {
      await apiCall(`/escrows/${escrowId}/milestones/${milestoneId}/reject`, "POST", { caller: actionCaller });
      flash(`Milestone #${milestoneId} rejected`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Reject failed"); }
  }

  async function handleReleaseMilestone(escrowId: number, milestoneId: number) {
    setError(null);
    try {
      const r = await apiCall(`/escrows/${escrowId}/milestones/${milestoneId}/release`, "POST", { caller: actionCaller });
      flash(`Payment of ${r.data.netPayout} stroops released for milestone #${milestoneId}`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Release failed"); }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const milestoneSum = formMilestones.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
  const totalNum = Number(formTotal);
  const sumsMatch = Math.abs(milestoneSum - totalNum) < 0.0001;

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
            <Gavel className="w-6 h-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Freelancer Escrow</h2>
            {contractId && (
              <p className="text-xs text-slate-400 font-mono">{contractId.slice(0, 12)}…{contractId.slice(-6)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {initialized && (
            <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-green-50 text-green-600 dark:bg-green-900/20">
              <Activity className="w-3 h-3" /> Active
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
        <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Initialize */}
      {!initialized && (
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
              placeholder="Arbiter fee (basis points, e.g. 200 = 2%)"
              value={initFeeBps}
              onChange={e => setInitFeeBps(e.target.value)}
            />
          </div>
          <button
            onClick={handleInit}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Initialize
          </button>
        </div>
      )}

      {initialized && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
            {(["escrows", "create", "analytics"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
              >
                {t === "escrows" ? "Escrows" : t === "create" ? "New Escrow" : "Analytics"}
              </button>
            ))}
          </div>

          {/* ── Escrows tab ── */}
          {tab === "escrows" && (
            <div className="space-y-4">
              {/* Caller address bar */}
              <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <User className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  className="flex-1 text-sm px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                  placeholder="Your address (used as caller for actions)"
                  value={actionCaller}
                  onChange={e => setActionCaller(e.target.value)}
                />
              </div>

              {escrowList.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No escrows yet. Create one from the "New Escrow" tab.</p>
                </div>
              ) : (
                escrowList.map(e => (
                  <EscrowCard
                    key={e.id}
                    escrow={e}
                    expanded={expandedId === e.id}
                    onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                    caller={actionCaller}
                    onDeposit={handleDeposit}
                    onDispute={handleDispute}
                    onResolve={handleResolve}
                    onCancel={handleCancel}
                    onSubmitMilestone={handleSubmitMilestone}
                    onApproveMilestone={handleApproveMilestone}
                    onRejectMilestone={handleRejectMilestone}
                    onReleaseMilestone={handleReleaseMilestone}
                  />
                ))
              )}
            </div>
          )}

          {/* ── Create tab ── */}
          {tab === "create" && (
            <div className="space-y-4 max-w-lg">
              {[
                { label: "Your address (client)", value: formCaller, set: setFormCaller, placeholder: "Client wallet address" },
                { label: "Freelancer address", value: formFreelancer, set: setFormFreelancer, placeholder: "Freelancer wallet address" },
                { label: "Arbiter address", value: formArbiter, set: setFormArbiter, placeholder: "Dispute arbiter address" },
              ].map(({ label, value, set, placeholder }) => (
                <div key={label}>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
                  <input
                    className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                    placeholder={placeholder}
                    value={value}
                    onChange={e => set(e.target.value)}
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Total amount (stroops)</label>
                <input
                  type="number"
                  className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                  value={formTotal}
                  onChange={e => setFormTotal(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Milestone amounts (comma-separated stroops)</label>
                <input
                  className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                  placeholder="5000000,3000000,2000000"
                  value={formMilestones}
                  onChange={e => setFormMilestones(e.target.value)}
                />
                <p className={`text-xs mt-1 ${sumsMatch ? "text-green-500" : "text-amber-500"}`}>
                  Sum: {milestoneSum.toLocaleString()} {sumsMatch ? "✓ matches total" : `≠ total (${totalNum.toLocaleString()})`}
                </p>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs text-slate-500">
                Arbiter fee: {arbiterFeeBps / 100}% ({arbiterFeeBps} bps) deducted from each milestone payment
              </div>
              <button
                onClick={handleCreate}
                disabled={!sumsMatch}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> Create Escrow
              </button>
            </div>
          )}

          {/* ── Analytics tab ── */}
          {tab === "analytics" && analytics && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Escrows", value: analytics.totalEscrows, color: "text-slate-900 dark:text-white" },
                  { label: "Active", value: analytics.activeEscrows, color: "text-green-600" },
                  { label: "Completed", value: analytics.completedEscrows, color: "text-blue-600" },
                  { label: "Disputed", value: analytics.disputedEscrows, color: "text-orange-500" },
                  { label: "Cancelled", value: analytics.cancelledEscrows, color: "text-red-500" },
                  { label: "Value Locked", value: `${analytics.totalValueLocked.toLocaleString()} str`, color: "text-violet-600" },
                  { label: "Total Paid Out", value: `${analytics.totalPaidOut.toLocaleString()} str`, color: "text-indigo-600" },
                  {
                    label: "Completion Rate",
                    value: analytics.totalEscrows > 0
                      ? `${Math.round((analytics.completedEscrows / analytics.totalEscrows) * 100)}%`
                      : "—",
                    color: "text-emerald-600",
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                    <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {analytics.totalEscrows > 0 && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Escrow Outcomes</div>
                  <div className="flex h-5 rounded overflow-hidden gap-0.5">
                    {[
                      { count: analytics.activeEscrows, color: "bg-green-400", label: "Active" },
                      { count: analytics.completedEscrows, color: "bg-blue-500", label: "Completed" },
                      { count: analytics.disputedEscrows, color: "bg-orange-400", label: "Disputed" },
                      { count: analytics.cancelledEscrows, color: "bg-red-400", label: "Cancelled" },
                    ].filter(({ count }) => count > 0).map(({ count, color, label }) => (
                      <div
                        key={label}
                        className={`h-full ${color} transition-all`}
                        style={{ width: `${(count / analytics.totalEscrows) * 100}%` }}
                        title={`${label}: ${count}`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                    {[
                      { color: "bg-green-400", label: "Active" },
                      { color: "bg-blue-500", label: "Completed" },
                      { color: "bg-orange-400", label: "Disputed" },
                      { color: "bg-red-400", label: "Cancelled" },
                    ].map(({ color, label }) => (
                      <span key={label} className="flex items-center gap-1">
                        <span className={`w-2 h-2 ${color} rounded-full inline-block`} />{label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "analytics" && !analytics && (
            <div className="text-center py-12 text-slate-400">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No analytics yet.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
