"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState, useMemo, useCallback } from "react";
import {
  Vote,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  PauseCircle,
  PlayCircle,
  Users,
  Zap,
  BarChart2,
  AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProposalStatus = "Active" | "Passed" | "Defeated" | "Cancelled";

export interface QVProposal {
  id: number;
  proposer: string;
  title: string;
  description: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  voteStart: number;
  voteEnd: number;
}

interface Props {
  contractId?: string;
  walletAddress?: string;
  proposals: QVProposal[];
  isWhitelisted: boolean;
  isPaused: boolean;
  isAdmin: boolean;
  maxCredits: number;
  isLoading: boolean;
  onCreateProposal: (title: string, description: string) => Promise<void>;
  onVote: (proposalId: number, credits: number, isFor: boolean) => Promise<void>;
  onFinalize: (proposalId: number) => Promise<void>;
  onWhitelist: (voter: string, allow: boolean) => Promise<void>;
  onPause: () => Promise<void>;
  onUnpause: () => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ProposalStatus, string> = {
  Active: "text-cyan-300",
  Passed: "text-emerald-300",
  Defeated: "text-rose-300",
  Cancelled: "text-slate-500",
};

const STATUS_ICON: Record<ProposalStatus, React.ReactNode> = {
  Active: <Clock size={12} aria-hidden="true" />,
  Passed: <CheckCircle size={12} aria-hidden="true" />,
  Defeated: <XCircle size={12} aria-hidden="true" />,
  Cancelled: <XCircle size={12} aria-hidden="true" />,
};

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function timeRemaining(end: number): string {
  const diff = end - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** votes = floor(sqrt(credits)) */
function creditsToVotes(credits: number): number {
  return Math.floor(Math.sqrt(Math.max(0, credits)));
}

function votePct(votes: number, total: number): number {
  return total === 0 ? 0 : Math.round((votes / total) * 100);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VoteBar({ votesFor, votesAgainst }: { votesFor: number; votesAgainst: number }) {
  const total = votesFor + votesAgainst;
  const forPct = votePct(votesFor, total);
  return (
    <div className="mt-2" role="img" aria-label={`${forPct}% for, ${100 - forPct}% against`}>
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>For: {votesFor} ({forPct}%)</span>
        <span>Against: {votesAgainst} ({100 - forPct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${forPct}%` }}
        />
      </div>
    </div>
  );
}

function CreditSlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const votes = creditsToVotes(value);
  return (
    <div>
      <label className="text-xs text-slate-400 flex justify-between mb-1">
        <span>Credits: <strong className="text-white">{value}</strong></span>
        <span className="flex items-center gap-1">
          <Zap size={10} className="text-yellow-400" aria-hidden="true" />
          Votes: <strong className="text-yellow-300">{votes}</strong>
        </span>
      </label>
      <input
        type="range"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-500"
        aria-label={`Credits to spend (${value} credits = ${votes} votes)`}
      />
      <p className="text-xs text-slate-500 mt-1">
        Cost: {value} credits → {votes} vote{votes !== 1 ? "s" : ""} (√{value} = {votes})
      </p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function QuadraticVotingDashboard({
  contractId,
  walletAddress,
  proposals,
  isWhitelisted,
  isPaused,
  isAdmin,
  maxCredits,
  isLoading,
  onCreateProposal,
  onVote,
  onFinalize,
  onWhitelist,
  onPause,
  onUnpause,
}: Props) {
  // ── Local state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"proposals" | "admin">("proposals");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [voteCredits, setVoteCredits] = useState<Record<number, number>>({});
  const [voting, setVoting] = useState<number | null>(null);
  const [voteError, setVoteError] = useState<Record<number, string>>({});

  const [whitelistAddr, setWhitelistAddr] = useState("");
  const [whitelistAllow, setWhitelistAllow] = useState(true);
  const [whitelisting, setWhitelisting] = useState(false);
  const [whitelistError, setWhitelistError] = useState("");

  const [pauseLoading, setPauseLoading] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const activeProposals = useMemo(() => proposals.filter((p) => p.status === "Active"), [proposals]);
  const closedProposals = useMemo(() => proposals.filter((p) => p.status !== "Active"), [proposals]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    setCreateError("");
    if (!newTitle.trim()) return setCreateError("Title is required");
    if (newTitle.length > 32) return setCreateError("Title must be ≤ 32 characters");
    if (!newDesc.trim()) return setCreateError("Description is required");
    setCreating(true);
    try {
      await onCreateProposal(newTitle.trim(), newDesc.trim());
      setNewTitle("");
      setNewDesc("");
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Failed to create proposal");
    } finally {
      setCreating(false);
    }
  }, [newTitle, newDesc, onCreateProposal]);

  const handleVote = useCallback(
    async (proposalId: number, isFor: boolean) => {
      const credits = voteCredits[proposalId] ?? 1;
      setVoteError((prev) => ({ ...prev, [proposalId]: "" }));
      setVoting(proposalId);
      try {
        await onVote(proposalId, credits, isFor);
      } catch (e: unknown) {
        setVoteError((prev) => ({
          ...prev,
          [proposalId]: e instanceof Error ? e.message : "Vote failed",
        }));
      } finally {
        setVoting(null);
      }
    },
    [voteCredits, onVote]
  );

  const handleWhitelist = useCallback(async () => {
    setWhitelistError("");
    if (!whitelistAddr.trim()) return setWhitelistError("Address is required");
    setWhitelisting(true);
    try {
      await onWhitelist(whitelistAddr.trim(), whitelistAllow);
      setWhitelistAddr("");
    } catch (e: unknown) {
      setWhitelistError(e instanceof Error ? e.message : "Whitelist operation failed");
    } finally {
      setWhitelisting(false);
    }
  }, [whitelistAddr, whitelistAllow, onWhitelist]);

  const handlePauseToggle = useCallback(async () => {
    setPauseLoading(true);
    try {
      if (isPaused) await onUnpause();
      else await onPause();
    } finally {
      setPauseLoading(false);
    }
  }, [isPaused, onPause, onUnpause]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="bg-slate-900 text-slate-100 rounded-xl p-4 space-y-4 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote size={18} className="text-cyan-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-white">Quadratic Voting</h2>
          {isPaused && (
            <span
              className="flex items-center gap-1 text-xs bg-rose-900/50 text-rose-300 px-2 py-0.5 rounded-full"
              role="status"
              aria-live="polite"
            >
              <PauseCircle size={10} aria-hidden="true" /> Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {walletAddress && (
            <span className="bg-slate-800 px-2 py-0.5 rounded" title={walletAddress}>
              {short(walletAddress)}
            </span>
          )}
          {isWhitelisted && (
            <span className="bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full">
              ✓ Whitelisted
            </span>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Total", value: proposals.length, icon: <BarChart2 size={12} /> },
          { label: "Active", value: activeProposals.length, icon: <Clock size={12} /> },
          { label: "Max Credits", value: maxCredits, icon: <Zap size={12} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-slate-800 rounded-lg p-2">
            <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
              {icon}
              <span className="text-xs">{label}</span>
            </div>
            <div className="text-lg font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700 pb-1" role="tablist">
        {(["proposals", ...(isAdmin ? ["admin"] : [])] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={`px-3 py-1 rounded-t text-xs capitalize transition-colors ${
              activeTab === tab
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Proposals tab */}
      {activeTab === "proposals" && (
        <div className="space-y-4" role="tabpanel">
          {/* Create proposal (admin only) */}
          {isAdmin && (
            <section aria-label="Create proposal">
              <h3 className="text-xs text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Plus size={10} aria-hidden="true" /> New Proposal
              </h3>
              <div className="bg-slate-800 rounded-lg p-3 space-y-2">
                <input
                  type="text"
                  placeholder="Title (max 32 chars)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={32}
                  className="w-full bg-slate-700 rounded px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  aria-label="Proposal title"
                />
                <textarea
                  placeholder="Description"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-700 rounded px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
                  aria-label="Proposal description"
                />
                {createError && (
                  <p className="text-xs text-rose-400 flex items-center gap-1" role="alert">
                    <AlertTriangle size={10} aria-hidden="true" /> {createError}
                  </p>
                )}
                <button
                  onClick={handleCreate}
                  disabled={creating || isPaused || isLoading}
                  className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs py-1.5 rounded transition-colors"
                  aria-busy={creating}
                >
                  {creating ? "Creating…" : "Create Proposal"}
                </button>
              </div>
            </section>
          )}

          {/* Active proposals */}
          {isLoading ? (
            <div className="text-center text-slate-500 py-8" role="status" aria-live="polite">
              Loading proposals…
            </div>
          ) : proposals.length === 0 ? (
            <div className="text-center text-slate-500 py-8">No proposals yet.</div>
          ) : (
            <div className="space-y-3">
              {[...activeProposals, ...closedProposals].map((proposal) => {
                const credits = voteCredits[proposal.id] ?? 1;
                const isVoting = voting === proposal.id;
                const canVote =
                  isWhitelisted && proposal.status === "Active" && !isPaused;
                const isEnded =
                  proposal.status === "Active" &&
                  Math.floor(Date.now() / 1000) > proposal.voteEnd;

                return (
                  <article
                    key={proposal.id}
                    className="bg-slate-800 rounded-lg p-3 space-y-2"
                    aria-label={`Proposal: ${proposal.title}`}
                  >
                    {/* Proposal header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">#{proposal.id}</span>
                          <span
                            className={`flex items-center gap-1 text-xs ${STATUS_COLOR[proposal.status]}`}
                          >
                            {STATUS_ICON[proposal.status]}
                            {proposal.status}
                          </span>
                        </div>
                        <h4 className="text-sm font-medium text-white mt-0.5">{proposal.title}</h4>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                          {proposal.description}
                        </p>
                      </div>
                      {proposal.status === "Active" && (
                        <div className="text-right shrink-0">
                          <div className="text-xs text-slate-400">
                            {isEnded ? (
                              <span className="text-amber-400">Ended – finalize</span>
                            ) : (
                              timeRemaining(proposal.voteEnd)
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            by {short(proposal.proposer)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Vote bar */}
                    <VoteBar votesFor={proposal.votesFor} votesAgainst={proposal.votesAgainst} />

                    {/* Voting controls */}
                    {canVote && (
                      <div className="space-y-2 pt-1 border-t border-slate-700">
                        <CreditSlider
                          value={credits}
                          max={maxCredits}
                          onChange={(v) =>
                            setVoteCredits((prev) => ({ ...prev, [proposal.id]: v }))
                          }
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleVote(proposal.id, true)}
                            disabled={isVoting}
                            className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs py-1.5 rounded transition-colors"
                            aria-label={`Vote for proposal ${proposal.id}`}
                            aria-busy={isVoting}
                          >
                            {isVoting ? "Voting…" : "✓ Vote For"}
                          </button>
                          <button
                            onClick={() => handleVote(proposal.id, false)}
                            disabled={isVoting}
                            className="flex-1 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-xs py-1.5 rounded transition-colors"
                            aria-label={`Vote against proposal ${proposal.id}`}
                            aria-busy={isVoting}
                          >
                            {isVoting ? "Voting…" : "✗ Vote Against"}
                          </button>
                        </div>
                        {voteError[proposal.id] && (
                          <p className="text-xs text-rose-400 flex items-center gap-1" role="alert">
                            <AlertTriangle size={10} aria-hidden="true" />
                            {voteError[proposal.id]}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Finalize button */}
                    {isEnded && (
                      <button
                        onClick={() => onFinalize(proposal.id)}
                        className="w-full bg-amber-700 hover:bg-amber-600 text-white text-xs py-1.5 rounded transition-colors"
                        aria-label={`Finalize proposal ${proposal.id}`}
                      >
                        Finalize Proposal
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Admin tab */}
      {activeTab === "admin" && isAdmin && (
        <div className="space-y-4" role="tabpanel">
          {/* Pause / Unpause */}
          <section aria-label="Contract controls">
            <h3 className="text-xs text-slate-400 uppercase tracking-wider mb-2">
              Emergency Controls
            </h3>
            <div className="bg-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white font-medium">
                    Contract is {isPaused ? "PAUSED" : "ACTIVE"}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isPaused
                      ? "All state-changing operations are blocked."
                      : "All operations are running normally."}
                  </p>
                </div>
                <button
                  onClick={handlePauseToggle}
                  disabled={pauseLoading}
                  className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
                    isPaused
                      ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                      : "bg-rose-700 hover:bg-rose-600 text-white"
                  }`}
                  aria-label={isPaused ? "Unpause contract" : "Pause contract"}
                  aria-busy={pauseLoading}
                >
                  {isPaused ? (
                    <><PlayCircle size={12} aria-hidden="true" /> Unpause</>
                  ) : (
                    <><PauseCircle size={12} aria-hidden="true" /> Pause</>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Whitelist management */}
          <section aria-label="Whitelist management">
            <h3 className="text-xs text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Users size={10} aria-hidden="true" /> Voter Whitelist
            </h3>
            <div className="bg-slate-800 rounded-lg p-3 space-y-2">
              <input
                type="text"
                placeholder="Voter address (G…)"
                value={whitelistAddr}
                onChange={(e) => setWhitelistAddr(e.target.value)}
                className="w-full bg-slate-700 rounded px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                aria-label="Voter address to whitelist"
              />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whitelistAllow}
                    onChange={(e) => setWhitelistAllow(e.target.checked)}
                    className="accent-cyan-500"
                    aria-label="Allow voter"
                  />
                  Allow (uncheck to remove)
                </label>
              </div>
              {whitelistError && (
                <p className="text-xs text-rose-400 flex items-center gap-1" role="alert">
                  <AlertTriangle size={10} aria-hidden="true" /> {whitelistError}
                </p>
              )}
              <button
                onClick={handleWhitelist}
                disabled={whitelisting || isPaused}
                className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs py-1.5 rounded transition-colors"
                aria-busy={whitelisting}
              >
                {whitelisting ? "Updating…" : whitelistAllow ? "Add to Whitelist" : "Remove from Whitelist"}
              </button>
            </div>
          </section>

          {/* Contract info */}
          {contractId && (
            <section aria-label="Contract information">
              <h3 className="text-xs text-slate-400 uppercase tracking-wider mb-2">
                Contract Info
              </h3>
              <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Contract ID</span>
                  <span className="text-slate-200 font-mono" title={contractId}>
                    {short(contractId)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Max Credits/Voter</span>
                  <span className="text-slate-200">{maxCredits}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Status</span>
                  <span className={isPaused ? "text-rose-300" : "text-emerald-300"}>
                    {isPaused ? "Paused" : "Active"}
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
