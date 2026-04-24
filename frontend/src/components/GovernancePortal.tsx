"use client";

import React, { useState, useMemo } from "react";
import { Vote, Plus, Clock, CheckCircle, XCircle, MinusCircle, Users } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProposalStatus = "Active" | "Passed" | "Defeated" | "Executed" | "Cancelled";
export type VoteChoice = "For" | "Against" | "Abstain";

export interface GovernanceProposal {
  id: number;
  proposer: string;
  title: string;
  description: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  totalSupplySnapshot: number;
  quorumBps: number;
  voteEnd: number; // unix timestamp
  executeAfter: number;
}

interface Props {
  contractId?: string;
  walletAddress?: string;
  proposals: GovernanceProposal[];
  votingPower: number;
  isLoading: boolean;
  onPropose: (title: string, description: string) => Promise<void>;
  onVote: (proposalId: number, choice: VoteChoice) => Promise<void>;
  onFinalise: (proposalId: number) => Promise<void>;
  onExecute: (proposalId: number) => Promise<void>;
  onDelegate: (to: string | null) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ProposalStatus, string> = {
  Active: "text-cyan-300",
  Passed: "text-emerald-300",
  Defeated: "text-rose-300",
  Executed: "text-slate-400",
  Cancelled: "text-slate-500",
};

const STATUS_ICON: Record<ProposalStatus, React.ReactNode> = {
  Active: <Clock size={10} />,
  Passed: <CheckCircle size={10} />,
  Defeated: <XCircle size={10} />,
  Executed: <CheckCircle size={10} />,
  Cancelled: <MinusCircle size={10} />,
};

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function timeRemaining(end: number): string {
  const diff = end - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((diff % 3600) / 60)}m`;
}

function quorumPct(p: GovernanceProposal): number {
  if (p.totalSupplySnapshot === 0) return 0;
  const total = p.votesFor + p.votesAgainst + p.votesAbstain;
  return Math.min(100, (total / p.totalSupplySnapshot) * 100);
}

function quorumRequired(p: GovernanceProposal): number {
  return (p.quorumBps / 10_000) * 100;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GovernancePortal({
  contractId,
  walletAddress,
  proposals,
  votingPower,
  isLoading,
  onPropose,
  onVote,
  onFinalise,
  onExecute,
  onDelegate,
}: Props) {
  const [tab, setTab] = useState<"proposals" | "create" | "delegate">("proposals");
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");

  // Create form
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  // Delegate form
  const [delegateTo, setDelegateTo] = useState("");

  const filtered = useMemo(() => {
    if (filter === "active") return proposals.filter((p) => p.status === "Active");
    if (filter === "closed") return proposals.filter((p) => p.status !== "Active");
    return proposals;
  }, [proposals, filter]);

  const activeCount = proposals.filter((p) => p.status === "Active").length;
  const passRate = proposals.length > 0
    ? Math.round((proposals.filter((p) => p.status === "Passed" || p.status === "Executed").length / proposals.length) * 100)
    : 0;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote size={16} className="text-violet-400" />
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Governance
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{activeCount} active</span>
          <span>{passRate}% pass rate</span>
          <span className="text-violet-300">Power: {votingPower.toLocaleString()}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {(["proposals", "create", "delegate"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
              tab === t
                ? "bg-violet-400/20 text-violet-200 border border-violet-400/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Proposals tab ── */}
      {tab === "proposals" && (
        <div className="space-y-3">
          {/* Filter */}
          <div className="flex gap-2">
            {(["all", "active", "closed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize transition ${
                  filter === f ? "text-slate-200 bg-slate-700" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-center text-xs text-slate-600 py-4">No proposals yet.</p>
          )}

          {filtered.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              walletAddress={walletAddress}
              isLoading={isLoading}
              onVote={onVote}
              onFinalise={onFinalise}
              onExecute={onExecute}
            />
          ))}
        </div>
      )}

      {/* ── Create tab ── */}
      {tab === "create" && (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Proposal title"
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description (markdown supported)"
            rows={5}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none resize-none"
          />
          <button
            disabled={isLoading || !contractId || !title.trim()}
            onClick={() => { onPropose(title.trim(), desc.trim()); setTitle(""); setDesc(""); }}
            className="w-full rounded-full border border-violet-400/30 bg-violet-400/10 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-400/20 disabled:opacity-40"
          >
            <Plus size={12} className="inline mr-1" />
            Submit Proposal
          </button>
          {votingPower === 0 && (
            <p className="text-center text-[10px] text-rose-400">
              You need governance tokens to propose.
            </p>
          )}
        </div>
      )}

      {/* ── Delegate tab ── */}
      {tab === "delegate" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              <Users size={12} /> Delegate Voting Power
            </p>
            <input
              value={delegateTo}
              onChange={(e) => setDelegateTo(e.target.value)}
              placeholder="Delegate address (leave empty to revoke)"
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none"
            />
            <div className="flex gap-2">
              <button
                disabled={isLoading || !contractId || !delegateTo.trim()}
                onClick={() => { onDelegate(delegateTo.trim()); setDelegateTo(""); }}
                className="flex-1 rounded-full border border-violet-400/30 bg-violet-400/10 py-1 text-xs font-medium text-violet-200 hover:bg-violet-400/20 disabled:opacity-40"
              >
                Delegate
              </button>
              <button
                disabled={isLoading || !contractId}
                onClick={() => onDelegate(null)}
                className="flex-1 rounded-full border border-rose-400/30 bg-rose-400/10 py-1 text-xs font-medium text-rose-200 hover:bg-rose-400/20 disabled:opacity-40"
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ProposalCard ──────────────────────────────────────────────────────────────

function ProposalCard({
  proposal: p,
  walletAddress,
  isLoading,
  onVote,
  onFinalise,
  onExecute,
}: {
  proposal: GovernanceProposal;
  walletAddress?: string;
  isLoading: boolean;
  onVote: (id: number, c: VoteChoice) => Promise<void>;
  onFinalise: (id: number) => Promise<void>;
  onExecute: (id: number) => Promise<void>;
}) {
  const total = p.votesFor + p.votesAgainst + p.votesAbstain;
  const forPct = total > 0 ? (p.votesFor / total) * 100 : 0;
  const againstPct = total > 0 ? (p.votesAgainst / total) * 100 : 0;
  const qPct = quorumPct(p);
  const qReq = quorumRequired(p);
  const now = Math.floor(Date.now() / 1000);
  const canFinalise = p.status === "Active" && now > p.voteEnd;
  const canExecute = p.status === "Passed" && now >= p.executeAfter;

  return (
    <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3 space-y-2">
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-200 truncate">{p.title}</p>
          <p className="text-[10px] text-slate-500 font-mono">#{p.id} · {short(p.proposer)}</p>
        </div>
        <span className={`flex items-center gap-1 text-[10px] font-semibold ${STATUS_COLOR[p.status]}`}>
          {STATUS_ICON[p.status]} {p.status}
        </span>
      </div>

      {/* Vote bars */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="w-12 text-emerald-400">For</span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-800">
            <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${forPct}%` }} />
          </div>
          <span className="w-8 text-right text-slate-400">{forPct.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="w-12 text-rose-400">Against</span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-800">
            <div className="h-1.5 rounded-full bg-rose-400" style={{ width: `${againstPct}%` }} />
          </div>
          <span className="w-8 text-right text-slate-400">{againstPct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Quorum */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-slate-500">Quorum</span>
        <div className="flex-1 h-1 rounded-full bg-slate-800">
          <div
            className={`h-1 rounded-full transition-all ${qPct >= qReq ? "bg-violet-400" : "bg-slate-600"}`}
            style={{ width: `${Math.min(100, qPct)}%` }}
          />
        </div>
        <span className={`text-[10px] ${qPct >= qReq ? "text-violet-300" : "text-slate-500"}`}>
          {qPct.toFixed(1)}% / {qReq}%
        </span>
      </div>

      {/* Time remaining */}
      {p.status === "Active" && (
        <p className="text-[10px] text-amber-400 flex items-center gap-1">
          <Clock size={9} /> {timeRemaining(p.voteEnd)}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {p.status === "Active" && (
          <>
            {(["For", "Against", "Abstain"] as VoteChoice[]).map((c) => (
              <button
                key={c}
                disabled={isLoading || !walletAddress}
                onClick={() => onVote(p.id, c)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition disabled:opacity-40 ${
                  c === "For"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                    : c === "Against"
                    ? "border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20"
                    : "border-slate-400/30 bg-slate-400/10 text-slate-300 hover:bg-slate-400/20"
                }`}
              >
                {c}
              </button>
            ))}
          </>
        )}
        {canFinalise && (
          <button
            disabled={isLoading}
            onClick={() => onFinalise(p.id)}
            className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[10px] font-medium text-violet-200 hover:bg-violet-400/20 disabled:opacity-40"
          >
            Finalise
          </button>
        )}
        {canExecute && (
          <button
            disabled={isLoading}
            onClick={() => onExecute(p.id)}
            className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
          >
            Execute
          </button>
        )}
      </div>
    </div>
  );
}
