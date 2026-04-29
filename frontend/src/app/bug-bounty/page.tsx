"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Filter,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Wallet,
  XCircle,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000").replace(
    /\/$/,
    ""
  );

const SEVERITY_COLORS: Record<string, string> = {
  Low: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  Medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  High: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  Critical: "text-red-400 bg-red-400/10 border-red-400/30",
};

const STATUS_COLORS: Record<string, string> = {
  Pending: "text-gray-400 bg-gray-400/10 border-gray-400/30",
  UnderReview: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
  Accepted: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  Rejected: "text-red-400 bg-red-400/10 border-red-400/30",
  Paid: "text-purple-400 bg-purple-400/10 border-purple-400/30",
  Withdrawn: "text-gray-500 bg-gray-500/10 border-gray-500/30",
};

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  Low: <Shield size={14} />,
  Medium: <ShieldAlert size={14} />,
  High: <ShieldAlert size={14} />,
  Critical: <ShieldOff size={14} />,
};

const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
type Severity = (typeof SEVERITIES)[number];

const STATUSES = [
  "Pending",
  "UnderReview",
  "Accepted",
  "Rejected",
  "Paid",
  "Withdrawn",
] as const;
type ReportStatus = (typeof STATUSES)[number];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Report {
  id: number;
  reporter: string;
  title: string;
  descriptionHash: string;
  severity: Severity;
  status: ReportStatus;
  rewardAmount: number;
  paidAmount: number;
  submittedAt: number;
  updatedAt: number;
}

interface Stats {
  totalReports: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  poolBalance: number;
  totalRewarded: number;
  paused: boolean;
  rewardTiers: Record<string, number>;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

type Toast = { type: "success" | "error"; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(2);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/bug-bounty${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const json = (await res.json()) as { success?: boolean; data?: T; message?: string };
    if (!res.ok) {
      return { ok: false, error: (json as { message?: string }).message ?? "Request failed" };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToastBanner({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-lg border p-4 text-sm ${
        toast.type === "success"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/40 bg-red-500/10 text-red-300"
      }`}
    >
      {toast.type === "success" ? (
        <CheckCircle2 size={16} className="shrink-0" />
      ) : (
        <AlertCircle size={16} className="shrink-0" />
      )}
      {toast.message}
    </div>
  );
}

function Badge({
  label,
  colorClass,
  icon,
}: {
  label: string;
  colorClass: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {icon}
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
        <div className="text-gray-400">{icon}</div>
      </div>
    </div>
  );
}

// ── Report row ────────────────────────────────────────────────────────────────

function ReportRow({
  report,
  onAction,
  adminAddress,
  reporterAddress,
}: {
  report: Report;
  onAction: (action: string, id: number, extra?: Record<string, unknown>) => void;
  adminAddress: string;
  reporterAddress: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isReporter = reporterAddress && report.reporter === reporterAddress;
  const isAdmin = !!adminAddress;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 transition-colors hover:border-gray-700">
      <button
        className="flex w-full items-center gap-4 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="w-10 shrink-0 text-center font-mono text-sm text-gray-500">
          #{report.id}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-gray-200">
          {report.title}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Badge
            label={report.severity}
            colorClass={SEVERITY_COLORS[report.severity]}
            icon={SEVERITY_ICONS[report.severity]}
          />
          <Badge
            label={report.status}
            colorClass={STATUS_COLORS[report.status]}
          />
        </div>
        {expanded ? (
          <ChevronUp size={16} className="shrink-0 text-gray-500" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-gray-500" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-gray-500">Reporter</p>
              <p className="mt-0.5 font-mono text-gray-300">
                {shortAddr(report.reporter)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Description Hash</p>
              <p className="mt-0.5 font-mono text-gray-300 break-all">
                {report.descriptionHash}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Submitted</p>
              <p className="mt-0.5 text-gray-300">{formatDate(report.submittedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Last Updated</p>
              <p className="mt-0.5 text-gray-300">{formatDate(report.updatedAt)}</p>
            </div>
            {report.rewardAmount > 0 && (
              <div>
                <p className="text-xs text-gray-500">Pending Reward</p>
                <p className="mt-0.5 font-semibold text-emerald-400">
                  {stroopsToXlm(report.rewardAmount)} XLM
                </p>
              </div>
            )}
            {report.paidAmount > 0 && (
              <div>
                <p className="text-xs text-gray-500">Paid Out</p>
                <p className="mt-0.5 font-semibold text-purple-400">
                  {stroopsToXlm(report.paidAmount)} XLM
                </p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            {isAdmin && report.status === "Pending" && (
              <button
                onClick={() => onAction("review", report.id)}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-600/20 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-600/30 border border-cyan-600/30"
              >
                <Eye size={12} /> Start Review
              </button>
            )}
            {isAdmin &&
              (report.status === "Pending" ||
                report.status === "UnderReview") && (
                <>
                  <button
                    onClick={() => onAction("accept", report.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs text-emerald-300 transition-colors hover:bg-emerald-600/30 border border-emerald-600/30"
                  >
                    <CheckCircle2 size={12} /> Accept
                  </button>
                  <button
                    onClick={() => onAction("reject", report.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-600/30 border border-red-600/30"
                  >
                    <XCircle size={12} /> Reject
                  </button>
                </>
              )}
            {isReporter && report.status === "Accepted" && (
              <button
                onClick={() => onAction("claim", report.id)}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600/20 px-3 py-1.5 text-xs text-purple-300 transition-colors hover:bg-purple-600/30 border border-purple-600/30"
              >
                <Award size={12} /> Claim Reward
              </button>
            )}
            {isReporter && report.status === "Pending" && (
              <button
                onClick={() => onAction("withdraw", report.id)}
                className="flex items-center gap-1.5 rounded-lg bg-gray-600/20 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-600/30 border border-gray-600/30"
              >
                <XCircle size={12} /> Withdraw
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Submit Report Modal ───────────────────────────────────────────────────────

function SubmitReportModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: {
    reporter: string;
    title: string;
    descriptionHash: string;
    severity: Severity;
  }) => Promise<void>;
}) {
  const [reporter, setReporter] = useState("");
  const [title, setTitle] = useState("");
  const [descriptionHash, setDescriptionHash] = useState("");
  const [severity, setSeverity] = useState<Severity>("Medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!reporter.trim()) { setError("Reporter address is required"); return; }
    if (!title.trim()) { setError("Title is required"); return; }
    if (!descriptionHash.trim()) { setError("Description hash is required"); return; }
    setLoading(true);
    try {
      await onSubmit({ reporter: reporter.trim(), title: title.trim(), descriptionHash: descriptionHash.trim(), severity });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <h2 id="submit-modal-title" className="mb-5 flex items-center gap-2 text-lg font-semibold">
          <FileText size={18} className="text-cyan-400" />
          Submit Vulnerability Report
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="reporter" className="mb-1 block text-xs font-medium text-gray-400">
              Your Stellar Address <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <input
              id="reporter"
              type="text"
              value={reporter}
              onChange={(e) => setReporter(e.target.value)}
              placeholder="G…"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-cyan-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="title" className="mb-1 block text-xs font-medium text-gray-400">
              Vulnerability Title <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Reentrancy in withdraw function"
              maxLength={200}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-cyan-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="descHash" className="mb-1 block text-xs font-medium text-gray-400">
              Description Hash / IPFS CID <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <input
              id="descHash"
              type="text"
              value={descriptionHash}
              onChange={(e) => setDescriptionHash(e.target.value)}
              placeholder="QmXyz… or SHA-256 hash of your disclosure doc"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-cyan-500"
              aria-required="true"
            />
            <p className="mt-1 text-xs text-gray-600">
              Upload your full disclosure to IPFS and paste the CID here.
            </p>
          </div>

          <div>
            <label htmlFor="severity" className="mb-1 block text-xs font-medium text-gray-400">
              Severity <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <select
              id="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
              aria-required="true"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {loading ? "Submitting…" : "Submit Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Fund Pool Modal ───────────────────────────────────────────────────────────

function FundPoolModal({
  onClose,
  onFund,
}: {
  onClose: () => void;
  onFund: (funder: string, tokenAddress: string, amount: number) => Promise<void>;
}) {
  const [funder, setFunder] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [xlm, setXlm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Math.round(parseFloat(xlm) * 10_000_000);
    if (!funder.trim()) { setError("Funder address required"); return; }
    if (!tokenAddress.trim()) { setError("Token address required"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a valid XLM amount"); return; }
    setLoading(true);
    try {
      await onFund(funder.trim(), tokenAddress.trim(), amount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fund-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <h2 id="fund-modal-title" className="mb-5 flex items-center gap-2 text-lg font-semibold">
          <DollarSign size={18} className="text-emerald-400" />
          Fund Bounty Pool
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="funder" className="mb-1 block text-xs font-medium text-gray-400">
              Funder Address <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <input
              id="funder"
              type="text"
              value={funder}
              onChange={(e) => setFunder(e.target.value)}
              placeholder="G…"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label htmlFor="tokenAddr" className="mb-1 block text-xs font-medium text-gray-400">
              Token Contract Address <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <input
              id="tokenAddr"
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              placeholder="C…"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label htmlFor="xlmAmount" className="mb-1 block text-xs font-medium text-gray-400">
              Amount (XLM) <span aria-hidden="true" className="text-red-400">*</span>
            </label>
            <input
              id="xlmAmount"
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={xlm}
              onChange={(e) => setXlm(e.target.value)}
              placeholder="100"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-emerald-500"
            />
          </div>
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
              {loading ? "Funding…" : "Fund Pool"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BugBountyPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterSeverity, setFilterSeverity] = useState<string>("");
  const [filterReporter, setFilterReporter] = useState<string>("");

  // Simulated wallet addresses for demo
  const [adminAddress, setAdminAddress] = useState(
    "GADMIN1111111111111111111111111111111111111111111111111111"
  );
  const [reporterAddress, setReporterAddress] = useState("");

  // ── Toast helper ───────────────────────────────────────────────────────────
  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    const res = await apiFetch<Stats>("/stats");
    if (res.ok && res.data) setStats(res.data);
  }, []);

  const fetchReports = useCallback(
    async (page = 1) => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (filterStatus) params.set("status", filterStatus);
      if (filterSeverity) params.set("severity", filterSeverity);
      if (filterReporter) params.set("reporter", filterReporter);

      const res = await apiFetch<Report[]>(`/reports?${params.toString()}`);
      if (res.ok && res.data) {
        setReports(res.data);
      }
      // Fetch pagination from raw response
      try {
        const raw = await fetch(
          `${API_BASE}/api/bug-bounty/reports?${params.toString()}`
        );
        const json = (await raw.json()) as { pagination?: Pagination };
        if (json.pagination) setPagination(json.pagination);
      } catch {
        // ignore
      }
    },
    [filterStatus, filterSeverity, filterReporter]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchReports(pagination.page)]);
    setLoading(false);
  }, [fetchStats, fetchReports, pagination.page]);

  useEffect(() => {
    refresh();
    // Poll every 15 seconds for live updates
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Re-fetch when filters change
  useEffect(() => {
    fetchReports(1);
  }, [filterStatus, filterSeverity, filterReporter, fetchReports]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleSubmitReport = async (data: {
    reporter: string;
    title: string;
    descriptionHash: string;
    severity: Severity;
  }) => {
    const res = await apiFetch<Report>("/reports", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(res.error ?? "Submission failed");
    showToast("success", `Report #${res.data?.id} submitted successfully`);
    await refresh();
  };

  const handleFundPool = async (
    funder: string,
    tokenAddress: string,
    amount: number
  ) => {
    const res = await apiFetch("/pool/fund", {
      method: "POST",
      body: JSON.stringify({ funder, tokenAddress, amount }),
    });
    if (!res.ok) throw new Error(res.error ?? "Funding failed");
    showToast("success", `Pool funded with ${stroopsToXlm(amount)} XLM`);
    await refresh();
  };

  const handleAction = async (
    action: string,
    id: number,
    _extra?: Record<string, unknown>
  ) => {
    let res: { ok: boolean; data?: unknown; error?: string };

    switch (action) {
      case "review":
        res = await apiFetch(`/reports/${id}/review`, {
          method: "PATCH",
          body: JSON.stringify({ adminAddress }),
        });
        break;
      case "accept":
        res = await apiFetch(`/reports/${id}/accept`, {
          method: "PATCH",
          body: JSON.stringify({ adminAddress }),
        });
        break;
      case "reject":
        res = await apiFetch(`/reports/${id}/reject`, {
          method: "PATCH",
          body: JSON.stringify({ adminAddress }),
        });
        break;
      case "withdraw":
        res = await apiFetch(`/reports/${id}/withdraw`, {
          method: "PATCH",
          body: JSON.stringify({ reporter: reporterAddress }),
        });
        break;
      case "claim":
        res = await apiFetch(`/reports/${id}/claim`, {
          method: "POST",
          body: JSON.stringify({
            reporter: reporterAddress,
            tokenAddress:
              "CTOKEN111111111111111111111111111111111111111111111111111",
          }),
        });
        break;
      default:
        return;
    }

    if (!res.ok) {
      showToast("error", res.error ?? "Action failed");
    } else {
      showToast("success", `Action "${action}" completed for report #${id}`);
      await refresh();
    }
  };

  const handleTogglePause = async () => {
    const newPaused = !stats?.paused;
    const res = await apiFetch("/pause", {
      method: "POST",
      body: JSON.stringify({ adminAddress, paused: newPaused }),
    });
    if (!res.ok) {
      showToast("error", res.error ?? "Failed to toggle pause");
    } else {
      showToast("success", newPaused ? "Contract paused" : "Contract unpaused");
      await refresh();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-gray-100">
            <ShieldCheck size={32} className="text-cyan-400" />
            Bug Bounty Programme
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Decentralised vulnerability disclosure and reward distribution
            powered by Soroban.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Pause toggle */}
          <button
            onClick={handleTogglePause}
            aria-label={stats?.paused ? "Unpause contract" : "Pause contract"}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors ${
              stats?.paused
                ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20"
                : "border-orange-600/40 bg-orange-600/10 text-orange-400 hover:bg-orange-600/20"
            }`}
          >
            {stats?.paused ? (
              <PlayCircle size={16} />
            ) : (
              <PauseCircle size={16} />
            )}
            {stats?.paused ? "Unpause" : "Pause"}
          </button>

          <button
            onClick={() => setShowFundModal(true)}
            className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-2 text-sm text-emerald-400 transition-colors hover:bg-emerald-600/20"
          >
            <DollarSign size={16} /> Fund Pool
          </button>

          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={stats?.paused}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} /> Submit Report
          </button>

          <button
            onClick={refresh}
            aria-label="Refresh data"
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Paused banner */}
      {stats?.paused && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4 text-sm text-orange-300"
        >
          <AlertTriangle size={18} className="shrink-0" />
          The bug bounty programme is currently paused. New submissions are
          disabled.
        </div>
      )}

      {/* Toast */}
      <ToastBanner toast={toast} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Reports"
          value={stats?.totalReports ?? "—"}
          icon={<FileText size={22} />}
        />
        <StatCard
          label="Pool Balance"
          value={stats ? `${stroopsToXlm(stats.poolBalance)} XLM` : "—"}
          icon={<Wallet size={22} />}
          sub="Available for rewards"
        />
        <StatCard
          label="Total Rewarded"
          value={stats ? `${stroopsToXlm(stats.totalRewarded)} XLM` : "—"}
          icon={<Award size={22} />}
          sub="Paid to researchers"
        />
        <StatCard
          label="Open Reports"
          value={
            stats
              ? (stats.byStatus["Pending"] ?? 0) +
                (stats.byStatus["UnderReview"] ?? 0)
              : "—"
          }
          icon={<Clock size={22} />}
          sub="Pending + Under Review"
        />
      </div>

      {/* Reward tiers */}
      {stats?.rewardTiers && (
        <section aria-labelledby="reward-tiers-heading">
          <h2
            id="reward-tiers-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500"
          >
            Reward Tiers
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SEVERITIES.map((s) => (
              <div
                key={s}
                className={`rounded-xl border p-4 ${SEVERITY_COLORS[s]}`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {SEVERITY_ICONS[s]}
                  {s}
                </div>
                <p className="mt-2 text-xl font-bold">
                  {stroopsToXlm(stats.rewardTiers[s] ?? 0)} XLM
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Severity breakdown */}
      {stats?.bySeverity && Object.keys(stats.bySeverity).length > 0 && (
        <section aria-labelledby="breakdown-heading">
          <h2
            id="breakdown-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500"
          >
            Reports by Severity
          </h2>
          <div className="flex h-4 overflow-hidden rounded-full bg-gray-800">
            {SEVERITIES.map((s) => {
              const count = stats.bySeverity[s] ?? 0;
              const pct =
                stats.totalReports > 0
                  ? (count / stats.totalReports) * 100
                  : 0;
              if (pct === 0) return null;
              const barColors: Record<string, string> = {
                Low: "bg-blue-500",
                Medium: "bg-yellow-500",
                High: "bg-orange-500",
                Critical: "bg-red-500",
              };
              return (
                <div
                  key={s}
                  className={`${barColors[s]} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${s}: ${count}`}
                  role="img"
                  aria-label={`${s}: ${count} reports`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
            {SEVERITIES.map((s) => (
              <span key={s} className="flex items-center gap-1">
                {SEVERITY_ICONS[s]}
                {s}: {stats.bySeverity[s] ?? 0}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Demo address inputs */}
      <section
        aria-labelledby="demo-addresses-heading"
        className="rounded-xl border border-gray-800 bg-gray-900/40 p-5"
      >
        <h2
          id="demo-addresses-heading"
          className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-400"
        >
          <Wallet size={16} />
          Demo Addresses (for testing actions)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="adminAddr"
              className="mb-1 block text-xs text-gray-500"
            >
              Admin Address
            </label>
            <input
              id="adminAddr"
              type="text"
              value={adminAddress}
              onChange={(e) => setAdminAddress(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-xs text-gray-300 outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label
              htmlFor="reporterAddr"
              className="mb-1 block text-xs text-gray-500"
            >
              Your Reporter Address (to claim / withdraw)
            </label>
            <input
              id="reporterAddr"
              type="text"
              value={reporterAddress}
              onChange={(e) => setReporterAddress(e.target.value)}
              placeholder="G…"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-xs text-gray-300 outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      </section>

      {/* Filters */}
      <section aria-labelledby="filters-heading">
        <h2
          id="filters-heading"
          className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500"
        >
          <Filter size={14} />
          Filters
        </h2>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Filter by status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 outline-none focus:border-cyan-500"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by severity"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 outline-none focus:border-cyan-500"
          >
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <input
            type="text"
            aria-label="Filter by reporter address"
            value={filterReporter}
            onChange={(e) => setFilterReporter(e.target.value)}
            placeholder="Filter by reporter address…"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-cyan-500"
          />

          {(filterStatus || filterSeverity || filterReporter) && (
            <button
              onClick={() => {
                setFilterStatus("");
                setFilterSeverity("");
                setFilterReporter("");
              }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Reports list */}
      <section aria-labelledby="reports-heading">
        <h2
          id="reports-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500"
        >
          Reports ({pagination.total})
        </h2>

        {loading && reports.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-800 py-16 text-gray-500">
            <FileText size={32} />
            <p className="text-sm">No reports found.</p>
            <button
              onClick={() => setShowSubmitModal(true)}
              disabled={stats?.paused}
              className="mt-2 flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              <Plus size={14} /> Submit the first report
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <ReportRow
                key={r.id}
                report={r}
                onAction={handleAction}
                adminAddress={adminAddress}
                reporterAddress={reporterAddress}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => fetchReports(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => fetchReports(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </section>

      {/* Modals */}
      {showSubmitModal && (
        <SubmitReportModal
          onClose={() => setShowSubmitModal(false)}
          onSubmit={handleSubmitReport}
        />
      )}
      {showFundModal && (
        <FundPoolModal
          onClose={() => setShowFundModal(false)}
          onFund={handleFundPool}
        />
      )}
    </main>
  );
}
