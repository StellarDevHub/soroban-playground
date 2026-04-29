"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Lock,
  Unlock,
  XCircle,
} from "lucide-react";

export type VestingType = "Linear" | "Milestone";

export interface MilestoneData {
  index: number;
  descriptionHash: number;
  pctBps: number;
  approved: boolean;
}

export interface VestingScheduleData {
  id: number;
  beneficiary: string;
  token: string;
  totalAmount: number;
  releasedAmount: number;
  cliffTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  vestingType: VestingType;
  milestones: MilestoneData[];
  revoked: boolean;
}

interface VestingDashboardProps {
  contractId?: string;
  walletAddress?: string;
  schedules: VestingScheduleData[];
  isLoading: boolean;
  onCreateLinear: (params: {
    beneficiary: string;
    token: string;
    amount: number;
    cliff: number;
    start: number;
    end: number;
  }) => Promise<void>;
  onCreateMilestone: (params: {
    beneficiary: string;
    token: string;
    amount: number;
    cliff: number;
    hashes: number[];
    bps: number[];
  }) => Promise<void>;
  onRelease: (scheduleId: number) => Promise<void>;
  onRevoke: (scheduleId: number) => Promise<void>;
  onApproveMilestone: (scheduleId: number, milestoneIndex: number) => Promise<void>;
}

export default function VestingDashboard({
  contractId,
  walletAddress,
  schedules,
  isLoading,
  onCreateLinear,
  onCreateMilestone,
  onRelease,
  onRevoke,
  onApproveMilestone,
}: VestingDashboardProps) {
  const [tab, setTab] = useState<"schedules" | "create">("schedules");
  const [createType, setCreateType] = useState<VestingType>("Linear");
  const [expanded, setExpanded] = useState<number | null>(null);

  // Shared create form fields
  const [beneficiary, setBeneficiary] = useState("");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [cliffHours, setCliffHours] = useState("24");

  // Linear-specific
  const [durationHours, setDurationHours] = useState("720"); // 30 days

  // Milestone-specific (up to 4 milestones)
  const [milestones, setMilestones] = useState([
    { hash: "1", bps: "2500" },
    { hash: "2", bps: "2500" },
    { hash: "3", bps: "2500" },
    { hash: "4", bps: "2500" },
  ]);

  const handleCreateLinear = async () => {
    if (!beneficiary || !token || !amount) return;
    const now = Math.floor(Date.now() / 1000);
    const cliff = now + parseInt(cliffHours) * 3600;
    const end = cliff + parseInt(durationHours) * 3600;
    await onCreateLinear({
      beneficiary,
      token,
      amount: parseInt(amount),
      cliff,
      start: now,
      end,
    });
    setBeneficiary("");
    setToken("");
    setAmount("");
  };

  const handleCreateMilestone = async () => {
    if (!beneficiary || !token || !amount) return;
    const now = Math.floor(Date.now() / 1000);
    const cliff = now + parseInt(cliffHours) * 3600;
    const totalBps = milestones.reduce((s, m) => s + parseInt(m.bps || "0"), 0);
    if (totalBps !== 10000) return;
    await onCreateMilestone({
      beneficiary,
      token,
      amount: parseInt(amount),
      cliff,
      hashes: milestones.map((m) => parseInt(m.hash)),
      bps: milestones.map((m) => parseInt(m.bps)),
    });
    setBeneficiary("");
    setToken("");
    setAmount("");
  };

  if (!contractId) {
    return (
      <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Lock size={16} className="text-violet-400" />
          Token Vesting
        </h3>
        <p className="text-xs text-gray-500 italic">
          Deploy the vesting contract to manage schedules.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Lock size={16} className="text-violet-400" />
          Token Vesting
        </h3>
        {walletAddress && (
          <span className="text-xs text-gray-500 font-mono">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(["schedules", "create"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              tab === t
                ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "schedules" ? `Schedules (${schedules.length})` : "New Schedule"}
          </button>
        ))}
      </div>

      {/* Schedules tab */}
      {tab === "schedules" && (
        <div className="space-y-3">
          {schedules.length === 0 ? (
            <p className="text-xs text-gray-500 italic text-center py-4">
              No vesting schedules yet.
            </p>
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  className="w-full flex items-start justify-between p-3 text-left hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">#{s.id}</span>
                      <span className="text-xs text-gray-200 truncate">
                        {s.beneficiary.slice(0, 8)}…{s.beneficiary.slice(-4)}
                      </span>
                      <VestingBadge type={s.vestingType} revoked={s.revoked} />
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full bg-violet-500/40 relative"
                        style={{ width: `${vestedPercent(s, nowSec())}%` }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-violet-500"
                          style={{ width: `${releasedPercent(s) > 0 ? (releasedPercent(s) / vestedPercent(s, nowSec())) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      {releasedPercent(s)}% released · {vestedPercent(s, nowSec())}% vested ·{" "}
                      {s.totalAmount.toLocaleString()} total
                    </p>
                  </div>
                  {expanded === s.id ? (
                    <ChevronUp size={14} className="text-gray-500 shrink-0 mt-1" />
                  ) : (
                    <ChevronDown size={14} className="text-gray-500 shrink-0 mt-1" />
                  )}
                </button>

                {expanded === s.id && (
                  <div className="border-t border-gray-800 p-3 space-y-3 bg-gray-950/50">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <InfoRow label="Token" value={`${s.token.slice(0, 8)}…`} />
                      <InfoRow label="Total" value={s.totalAmount.toLocaleString()} />
                      <InfoRow label="Released" value={s.releasedAmount.toLocaleString()} />
                      <InfoRow
                        label="Cliff"
                        value={new Date(s.cliffTimestamp * 1000).toLocaleDateString()}
                      />
                    </div>

                    {/* Milestones */}
                    {s.vestingType === "Milestone" && s.milestones.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                          Milestones
                        </p>
                        {s.milestones.map((m) => (
                          <div
                            key={m.index}
                            className="flex items-center justify-between p-2 rounded bg-gray-900 border border-gray-800"
                          >
                            <div className="flex items-center gap-2">
                              {m.approved ? (
                                <CheckCircle2 size={12} className="text-emerald-400" />
                              ) : (
                                <Clock size={12} className="text-gray-500" />
                              )}
                              <span className="text-xs text-gray-300">
                                Milestone {m.index + 1} · {m.pctBps / 100}%
                              </span>
                            </div>
                            {!m.approved && !s.revoked && (
                              <button
                                onClick={() => onApproveMilestone(s.id, m.index)}
                                disabled={isLoading}
                                className="text-[10px] px-2 py-0.5 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-800/50 text-emerald-400 rounded transition-colors"
                              >
                                Approve
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    {!s.revoked && (
                      <div className="flex gap-2 pt-1 border-t border-gray-800">
                        <button
                          onClick={() => onRelease(s.id)}
                          disabled={isLoading}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs rounded transition-colors"
                        >
                          <Unlock size={12} />
                          Release
                        </button>
                        <button
                          onClick={() => onRevoke(s.id)}
                          disabled={isLoading}
                          className="px-3 py-1.5 bg-rose-900/20 hover:bg-rose-900/40 border border-rose-800/40 text-rose-400 text-xs rounded transition-colors"
                        >
                          <XCircle size={12} />
                        </button>
                      </div>
                    )}
                    {s.revoked && (
                      <p className="text-xs text-rose-400 flex items-center gap-1">
                        <XCircle size={12} /> Revoked
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Create tab */}
      {tab === "create" && (
        <div className="space-y-3">
          {/* Type selector */}
          <div className="flex gap-2">
            {(["Linear", "Milestone"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setCreateType(t)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  createType === t
                    ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Shared fields */}
          <Field label="Beneficiary Address">
            <input
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="G..."
              className={inputCls}
            />
          </Field>
          <Field label="Token Address">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="C..."
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Total Amount">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10000"
                className={inputCls}
              />
            </Field>
            <Field label="Cliff (hours)">
              <input
                type="number"
                value={cliffHours}
                onChange={(e) => setCliffHours(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Linear-specific */}
          {createType === "Linear" && (
            <Field label="Vesting Duration (hours after cliff)">
              <input
                type="number"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                className={inputCls}
              />
            </Field>
          )}

          {/* Milestone-specific */}
          {createType === "Milestone" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">
                Milestones (bps must sum to 10000 ={" "}
                {milestones.reduce((s, m) => s + parseInt(m.bps || "0"), 0)})
              </p>
              {milestones.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={m.hash}
                    onChange={(e) =>
                      setMilestones((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, hash: e.target.value } : x))
                      )
                    }
                    placeholder={`Hash ${i + 1}`}
                    className={`${inputCls} w-20`}
                  />
                  <input
                    type="number"
                    value={m.bps}
                    onChange={(e) =>
                      setMilestones((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, bps: e.target.value } : x))
                      )
                    }
                    placeholder="bps"
                    className={`${inputCls} flex-1`}
                  />
                </div>
              ))}
            </div>
          )}

          <button
            onClick={createType === "Linear" ? handleCreateLinear : handleCreateMilestone}
            disabled={isLoading || !beneficiary || !token || !amount}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white" />
            ) : (
              <Coins size={16} />
            )}
            Create {createType} Schedule
          </button>
        </div>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-md py-1.5 px-2 text-xs text-gray-200 focus:outline-none focus:border-violet-500 font-mono";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xs text-gray-300 font-mono truncate">{value}</p>
    </div>
  );
}

function VestingBadge({ type, revoked }: { type: VestingType; revoked: boolean }) {
  if (revoked)
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-900/30 text-rose-400 border-rose-800/50">
        Revoked
      </span>
    );
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
        type === "Linear"
          ? "bg-violet-900/30 text-violet-300 border-violet-800/50"
          : "bg-amber-900/30 text-amber-300 border-amber-800/50"
      }`}
    >
      {type}
    </span>
  );
}

// ── Pure helpers (outside component to satisfy react-hooks/purity) ────────────

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function vestedPercent(s: VestingScheduleData, ts: number): number {
  if (s.totalAmount === 0) return 0;
  if (s.vestingType === "Linear") {
    if (ts < s.cliffTimestamp) return 0;
    if (ts >= s.endTimestamp) return 100;
    const elapsed = ts - s.cliffTimestamp;
    const duration = s.endTimestamp - s.cliffTimestamp;
    return Math.round((elapsed / duration) * 100);
  }
  const approvedBps = s.milestones
    .filter((m) => m.approved)
    .reduce((a, m) => a + m.pctBps, 0);
  return Math.round(approvedBps / 100);
}

function releasedPercent(s: VestingScheduleData): number {
  return s.totalAmount === 0 ? 0 : Math.round((s.releasedAmount / s.totalAmount) * 100);
}
