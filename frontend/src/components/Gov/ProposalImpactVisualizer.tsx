"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  Vote,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  Sliders,
  Check,
  AlertCircle,
  Database,
  Send,
  Boxes,
  Zap,
  ChevronRight,
  Info,
} from "lucide-react";
import type {
  GovernanceProposal,
  ProposalStatus,
  VoteChoice,
  BatchVoteItem,
  ContractVoteEvent,
} from "@/lib/gov/types";
import {
  calculateQuadraticVotes,
  calculateMarginalCost,
  calculateQuadraticMetrics,
  generateQuadraticCurvePoints,
  calculateQuorumProgress,
  calculateApprovalProgress,
  calculateTreasuryImpact,
} from "@/lib/gov/govMath";
import { INITIAL_GOVERNANCE_PROPOSALS } from "@/lib/gov/mockProposals";
import { QuorumCircularGauge } from "./QuorumCircularGauge";
import { TreasuryImpactVisualizer } from "./TreasuryImpactVisualizer";

export interface ProposalImpactVisualizerProps {
  proposals?: GovernanceProposal[];
  connectedWalletAddress?: string;
  enableLiveStream?: boolean;
  onVoteSubmit?: (
    proposalId: string,
    choice: VoteChoice,
    credits: number,
  ) => Promise<void> | void;
  onBatchVoteSubmit?: (votes: BatchVoteItem[]) => Promise<void> | void;
  className?: string;
}

export default function ProposalImpactVisualizer({
  proposals: initialProposals = INITIAL_GOVERNANCE_PROPOSALS,
  connectedWalletAddress = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGONUCTXOTMIW2ELW5P",
  enableLiveStream = false,
  onVoteSubmit,
  onBatchVoteSubmit,
  className = "",
}: ProposalImpactVisualizerProps) {
  // --- Proposals & Selection State ---
  const [proposals, setProposals] =
    useState<GovernanceProposal[]>(initialProposals);
  const [selectedProposalId, setSelectedProposalId] = useState<string>(
    initialProposals[0]?.id || "",
  );
  const [statusFilter, setStatusFilter] = useState<"All" | ProposalStatus>(
    "All",
  );

  // --- Live Soroban Contract Event Subscription State ---
  const [isLiveStreamActive, setIsLiveStreamActive] = useState<boolean>(enableLiveStream);
  const [liveEventCount, setLiveEventCount] = useState<number>(0);
  const [recentEvents, setRecentEvents] = useState<ContractVoteEvent[]>([]);

  // --- Voting & Quadratic Simulator State ---
  const [creditAllocation, setCreditAllocation] = useState<number>(100);
  const [voteChoice, setVoteChoice] = useState<VoteChoice>("For");
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [voteSuccessMessage, setVoteSuccessMessage] = useState<string | null>(
    null,
  );
  const [voteErrorMessage, setVoteErrorMessage] = useState<string | null>(null);

  // --- Batch Voting State ---
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchSelections, setBatchSelections] = useState<
    Record<string, { choice: VoteChoice; credits: number; selected: boolean }>
  >({});
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);

  const activeProposalCount = proposals.filter(
    (proposal) => proposal.status === "Active",
  ).length;
  const totalTokenParticipation = proposals.reduce(
    (sum, proposal) => sum + proposal.totalTokensVoted,
    0,
  );
  const displayedLedger = proposals.reduce(
    (max, proposal) => Math.max(max, proposal.currentLedger),
    0,
  );

  // Filtered proposal list
  const filteredProposals = useMemo(() => {
    if (statusFilter === "All") return proposals;
    return proposals.filter((p) => p.status === statusFilter);
  }, [proposals, statusFilter]);

  // Selected proposal
  const activeProposal = useMemo(() => {
    return proposals.find((p) => p.id === selectedProposalId) || proposals[0];
  }, [proposals, selectedProposalId]);

  // Quorum & Approval metrics for active proposal
  const quorum = useMemo(() => {
    if (!activeProposal)
      return { reached: false, progressPct: 0, tokensRemaining: 0 };
    return calculateQuorumProgress(
      activeProposal.totalTokensVoted,
      activeProposal.quorumThresholdTokens,
    );
  }, [activeProposal]);

  const approval = useMemo(() => {
    if (!activeProposal)
      return { approvalPct: 0, isPassing: false, totalVotes: 0 };
    return calculateApprovalProgress(
      activeProposal.votesFor,
      activeProposal.votesAgainst,
      activeProposal.votesAbstain,
      activeProposal.approvalThresholdPct,
    );
  }, [activeProposal]);

  // Quadratic voting curve metrics
  const qvMetrics = useMemo(() => {
    return calculateQuadraticMetrics(creditAllocation);
  }, [creditAllocation]);

  // Simulated treasury impact for active proposal
  const treasuryImpact = useMemo(() => {
    if (!activeProposal) return null;
    return calculateTreasuryImpact(activeProposal);
  }, [activeProposal]);

  // Live Soroban Contract Event stream subscription
  useEffect(() => {
    if (!isLiveStreamActive || !activeProposal) return;

    const interval = setInterval(() => {
      if (activeProposal.status !== "Active") return;

      const randomCredits = 50;
      const effectiveVotes = calculateQuadraticVotes(randomCredits);

      const newEvent: ContractVoteEvent = {
        proposalId: activeProposal.id,
        voter: "GCOMMUNITY...VOTER",
        choice: "For",
        credits: randomCredits,
        votes: effectiveVotes,
        ledger: activeProposal.currentLedger + 1,
        timestamp: Date.now(),
      };

      setRecentEvents((prev) => [newEvent, ...prev].slice(0, 5));
      setLiveEventCount((c) => c + 1);

      setProposals((prev) =>
        prev.map((p) => {
          if (p.id !== activeProposal.id) return p;
          return {
            ...p,
            votesFor: p.votesFor + effectiveVotes,
            totalTokensVoted: p.totalTokensVoted + randomCredits,
          };
        }),
      );
    }, 15000);

    return () => clearInterval(interval);
  }, [isLiveStreamActive, activeProposal]);

  // SVG points for quadratic curve (Votes = sqrt(Credits))
  const curvePoints = useMemo(() => {
    return generateQuadraticCurvePoints(250, 30);
  }, []);

  // Format addresses for clean presentation
  const formatAddress = (addr: string) => {
    if (!addr || addr.length < 12) return addr || "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Status color styles
  const getStatusBadge = (status: ProposalStatus) => {
    switch (status) {
      case "Active":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Active
          </span>
        );
      case "Passed":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
            Passed
          </span>
        );
      case "Defeated":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            Defeated
          </span>
        );
      case "Executed":
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Executed
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300">
            {status}
          </span>
        );
    }
  };

  // Submit single vote
  const handleVoteSubmit = async () => {
    if (!activeProposal || activeProposal.status !== "Active") return;

    setIsSubmittingVote(true);
    setVoteSuccessMessage(null);
    setVoteErrorMessage(null);

    const effectiveVotes = activeProposal.quadraticVotingEnabled
      ? calculateQuadraticVotes(creditAllocation)
      : creditAllocation;

    try {
      if (onVoteSubmit) {
        await onVoteSubmit(activeProposal.id, voteChoice, creditAllocation);
      }

      // Update local proposals state
      setProposals((prev) =>
        prev.map((p) => {
          if (p.id !== activeProposal.id) return p;
          const nextFor =
            voteChoice === "For" ? p.votesFor + effectiveVotes : p.votesFor;
          const nextAgainst =
            voteChoice === "Against"
              ? p.votesAgainst + effectiveVotes
              : p.votesAgainst;
          const nextAbstain =
            voteChoice === "Abstain"
              ? p.votesAbstain + effectiveVotes
              : p.votesAbstain;
          const nextTokens = p.totalTokensVoted + creditAllocation;

          return {
            ...p,
            votesFor: nextFor,
            votesAgainst: nextAgainst,
            votesAbstain: nextAbstain,
            totalTokensVoted: nextTokens,
            votersCount: p.votersCount + 1,
          };
        }),
      );

      setVoteSuccessMessage(
        onVoteSubmit
          ? `Vote callback completed. ${effectiveVotes.toLocaleString()} ${activeProposal.quadraticVotingEnabled ? "quadratic votes" : "votes"} (${voteChoice}) were recorded in this view.`
          : `Demo vote recorded locally. No on-chain transaction was submitted. Cast ${effectiveVotes.toLocaleString()} ${activeProposal.quadraticVotingEnabled ? "quadratic votes" : "votes"} (${voteChoice}) using ${creditAllocation} credits.`,
      );
      setTimeout(() => setVoteSuccessMessage(null), 5000);
    } catch (error) {
      setVoteErrorMessage(
        error instanceof Error ? error.message : "Vote submission failed.",
      );
    } finally {
      setIsSubmittingVote(false);
    }
  };

  // Initialize batch voting selections
  const openBatchModal = () => {
    const initialBatch: Record<
      string,
      { choice: VoteChoice; credits: number; selected: boolean }
    > = {};
    proposals
      .filter((p) => p.status === "Active")
      .forEach((p) => {
        initialBatch[p.id] = { choice: "For", credits: 50, selected: true };
      });
    setBatchSelections(initialBatch);
    setIsBatchModalOpen(true);
  };

  // Submit batch votes
  const handleBatchSubmit = async () => {
    setIsSubmittingBatch(true);
    const batchItems: BatchVoteItem[] = Object.entries(batchSelections)
      .filter(([, val]) => val.selected)
      .map(([id, val]) => ({
        proposalId: id,
        choice: val.choice,
        credits: val.credits,
      }));

    if (batchItems.length === 0) {
      setVoteErrorMessage("Select at least one active proposal to vote on.");
      setIsSubmittingBatch(false);
      return;
    }

    setVoteErrorMessage(null);
    setVoteSuccessMessage(null);
    try {
      if (onBatchVoteSubmit) {
        await onBatchVoteSubmit(batchItems);
      }

      // Update state for all voted proposals
      setProposals((prev) =>
        prev.map((p) => {
          const item = batchSelections[p.id];
          if (!item || !batchSelections[p.id]?.selected) return p;
          const votes = p.quadraticVotingEnabled
            ? calculateQuadraticVotes(item.credits)
            : item.credits;

          return {
            ...p,
            votesFor: item.choice === "For" ? p.votesFor + votes : p.votesFor,
            votesAgainst:
              item.choice === "Against"
                ? p.votesAgainst + votes
                : p.votesAgainst,
            votesAbstain:
              item.choice === "Abstain"
                ? p.votesAbstain + votes
                : p.votesAbstain,
            totalTokensVoted: p.totalTokensVoted + item.credits,
            votersCount: p.votersCount + 1,
          };
        }),
      );

      setIsBatchModalOpen(false);
      setVoteSuccessMessage(
        onBatchVoteSubmit
          ? `Batch callback completed for ${batchItems.length} proposals; this view updated locally.`
          : `Demo batch recorded locally for ${batchItems.length} proposals. No on-chain transaction was submitted.`,
      );
      setTimeout(() => setVoteSuccessMessage(null), 5000);
    } catch (error) {
      setVoteErrorMessage(
        error instanceof Error
          ? error.message
          : "Batch vote submission failed.",
      );
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  return (
    <div
      className={`flex flex-col w-full rounded-2xl border border-white/10 bg-slate-950/85 backdrop-blur-2xl shadow-2xl text-slate-100 overflow-hidden ${className}`}
      data-testid="proposal-impact-visualizer"
    >
      {/* --- Top Header & Governance Stats Banner --- */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 border-b border-white/8 bg-gradient-to-r from-slate-900/90 via-indigo-950/30 to-slate-900/90">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Vote className="w-5 h-5" />
            </span>
            <h1 className="text-lg font-bold tracking-tight text-white">
              Governance Proposal Impact Visualizer
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Explore sample governance data and simulate voting impact. Voting is
            a local demo unless host callbacks are provided.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/8">
            <span className="text-slate-400">Active proposals: </span>
            <span className="font-semibold text-indigo-300">
              {activeProposalCount}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/8">
            <span className="text-slate-400">Sample participation: </span>
            <span className="font-semibold text-indigo-300">
              {totalTokenParticipation.toLocaleString()}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/8 flex items-center gap-2">
            <span className="text-slate-400">Sample ledger:</span>
            <span className="font-semibold text-indigo-300">
              #{displayedLedger.toLocaleString()}
            </span>
          </div>

          <button
            onClick={openBatchModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-indigo-600/90 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 transition"
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Batch Voting</span>
          </button>

          {/* Live Event Stream Toggle */}
          <button
            type="button"
            data-testid="live-event-stream-toggle"
            onClick={() => setIsLiveStreamActive((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono transition ${
              isLiveStreamActive
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-white/5 text-slate-400 border-white/8"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isLiveStreamActive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              }`}
            />
            <span>
              {isLiveStreamActive ? "Live Stream (Active)" : "Live Stream (Paused)"}
            </span>
          </button>
        </div>
      </div>

      {/* --- Notification Banner --- */}
      {voteSuccessMessage && (
        <div className="flex items-center justify-between px-5 py-2.5 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-200 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{voteSuccessMessage}</span>
          </div>
          <button
            onClick={() => setVoteSuccessMessage(null)}
            className="text-emerald-400 hover:text-emerald-200"
          >
            ✕
          </button>
        </div>
      )}
      {voteErrorMessage && (
        <div
          role="alert"
          className="px-5 py-2.5 bg-rose-500/15 border-b border-rose-500/30 text-rose-200 text-xs"
        >
          {voteErrorMessage}
        </div>
      )}

      {/* --- Main 2-Column Content Layout --- */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* === Left: Proposal Selector & Filter Deck === */}
        <div className="w-full lg:w-80 xl:w-96 border-b lg:border-b-0 lg:border-r border-white/8 p-4 flex flex-col bg-slate-900/40">
          {/* Status Filters */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/70 border border-white/6 mb-3 text-xs">
            {(
              [
                "All",
                "Active",
                "Passed",
                "Defeated",
                "Executed",
                "Queued",
              ] as const
            ).map((filter) => (
              <button
                key={filter}
                onClick={() => {
                  setStatusFilter(filter);
                  const first = proposals.find(
                    (proposal) =>
                      filter === "All" || proposal.status === filter,
                  );
                  if (first) setSelectedProposalId(first.id);
                }}
                className={`flex-1 py-1 px-2 rounded-lg text-center transition ${
                  statusFilter === filter
                    ? "bg-indigo-600 text-white font-medium shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Proposals List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredProposals.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No proposals found matching filter.
              </div>
            ) : (
              filteredProposals.map((proposal) => {
                const isSelected = proposal.id === activeProposal?.id;
                const pQuorum = calculateQuorumProgress(
                  proposal.totalTokensVoted,
                  proposal.quorumThresholdTokens,
                );

                return (
                  <button
                    key={proposal.id}
                    onClick={() => setSelectedProposalId(proposal.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-indigo-950/40 border-indigo-500/50 shadow-md ring-1 ring-indigo-500/30"
                        : "bg-white/3 border-white/6 hover:bg-white/6 hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-mono text-xs font-semibold text-indigo-400">
                        {proposal.id}
                      </span>
                      {getStatusBadge(proposal.status)}
                    </div>

                    <h2 className="text-xs font-semibold text-slate-200 line-clamp-2 leading-relaxed mb-2">
                      {proposal.title}
                    </h2>

                    {/* Mini Quorum Tracker */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>Quorum ({pQuorum.progressPct}%)</span>
                        <span className="font-mono">
                          {(proposal.totalTokensVoted / 1000).toFixed(0)}k /{" "}
                          {(proposal.quorumThresholdTokens / 1000).toFixed(0)}k
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${pQuorum.progressPct}%` }}
                          className={`h-full rounded-full transition-all duration-500 ${
                            pQuorum.reached ? "bg-emerald-400" : "bg-indigo-500"
                          }`}
                        />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* === Right: Proposal Detail, Curves & State Diff Visualizer === */}
        {activeProposal ? (
          <div className="flex-1 overflow-y-auto p-5 lg:p-6 space-y-6">
            {/* Header: Proposal Overview */}
            <div className="space-y-3 border-b border-white/8 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    {activeProposal.id}
                  </span>
                  {getStatusBadge(activeProposal.status)}
                  {activeProposal.quadraticVotingEnabled && (
                    <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      Quadratic Voting
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-400 flex items-center gap-2 font-mono">
                  <span>Proposer:</span>
                  <span
                    className="text-slate-200 font-semibold"
                    title={activeProposal.proposer}
                  >
                    {formatAddress(activeProposal.proposer)}
                  </span>
                </div>
              </div>

              <h2 className="text-lg font-bold text-white leading-snug">
                {activeProposal.title}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                {activeProposal.description}
              </p>

              {/* Ledger Window Timeline */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] font-mono text-slate-400 border-t border-white/4">
                <span>
                  Start Ledger: #{activeProposal.startLedger.toLocaleString()}
                </span>
                <span className="text-indigo-400">
                  Current: #{activeProposal.currentLedger.toLocaleString()}
                </span>
                <span>
                  End Ledger: #{activeProposal.endLedger.toLocaleString()}
                </span>
              </div>
            </div>

            {/* --- Quorum & Approval Split Gauges --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Quorum Progress Bar & Circular Gauge */}
              <div className="p-4 rounded-xl border border-white/8 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    <span>Quorum Threshold</span>
                  </div>
                  <span
                    className={`font-semibold ${
                      quorum.reached ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {quorum.reached
                      ? "Quorum Reached"
                      : `${quorum.progressPct}% Reached`}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {/* SVG Circular Quorum Gauge */}
                  <QuorumCircularGauge
                    progressPct={quorum.progressPct}
                    totalTokensVoted={activeProposal.totalTokensVoted}
                    quorumThresholdTokens={activeProposal.quorumThresholdTokens}
                    reached={quorum.reached}
                    size={110}
                    strokeWidth={8}
                  />

                  <div className="flex-1 w-full space-y-2">
                    <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden p-0.5 border border-white/6 relative">
                      <div
                        style={{ width: `${quorum.progressPct}%` }}
                        className={`h-full rounded-full transition-all duration-700 ${
                          quorum.reached
                            ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                            : "bg-gradient-to-r from-indigo-500 to-cyan-400"
                        }`}
                      />
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                      <span>
                        Voted: {activeProposal.totalTokensVoted.toLocaleString()}{" "}
                        Tokens
                      </span>
                      <span>
                        Threshold:{" "}
                        {activeProposal.quorumThresholdTokens.toLocaleString()}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      {quorum.reached ? (
                        <span className="text-emerald-400 font-semibold">
                          ✓ Quorum floor satisfied
                        </span>
                      ) : (
                        <span className="text-amber-400 font-medium">
                          ⚠️ Needs {quorum.tokensRemaining.toLocaleString()} more tokens
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Approval Ratio Progress */}
              <div className="p-4 rounded-xl border border-white/8 bg-slate-900/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Approval Ratio</span>
                  </div>
                  <span className="font-semibold text-slate-200">
                    {approval.approvalPct}% For (
                    {approval.isPassing ? "Passing" : "Failing"})
                  </span>
                </div>

                <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex border border-white/6">
                  <div
                    style={{
                      width: `${(activeProposal.votesFor / (approval.totalVotes || 1)) * 100}%`,
                    }}
                    className="h-full bg-emerald-500 transition-all duration-700"
                    title={`For: ${activeProposal.votesFor}`}
                  />
                  <div
                    style={{
                      width: `${(activeProposal.votesAgainst / (approval.totalVotes || 1)) * 100}%`,
                    }}
                    className="h-full bg-rose-500 transition-all duration-700"
                    title={`Against: ${activeProposal.votesAgainst}`}
                  />
                  <div
                    style={{
                      width: `${(activeProposal.votesAbstain / (approval.totalVotes || 1)) * 100}%`,
                    }}
                    className="h-full bg-slate-700 transition-all duration-700"
                    title={`Abstain: ${activeProposal.votesAbstain}`}
                  />
                </div>

                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span className="text-emerald-400">
                    For: {activeProposal.votesFor.toLocaleString()}
                  </span>
                  <span className="text-rose-400">
                    Against: {activeProposal.votesAgainst.toLocaleString()}
                  </span>
                  <span className="text-slate-400">
                    Abstain: {activeProposal.votesAbstain.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* --- Quadratic Voting Curve Simulator --- */}
            {activeProposal.quadraticVotingEnabled && (
              <div className="p-5 rounded-2xl border border-white/8 bg-slate-900/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-amber-400" />
                      Quadratic Voting Cost Curve & Simulator
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Votes scale with the square root of allocated token
                      credits: Votes = ⌊√Credits⌋
                    </p>
                  </div>

                  <div className="text-right font-mono text-xs">
                    <span className="text-slate-400">
                      Marginal Cost Next Vote:{" "}
                    </span>
                    <span className="font-bold text-amber-400">
                      {qvMetrics.marginalCostNextVote} Credits
                    </span>
                  </div>
                </div>

                {/* Interactive Slider & Live Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-950 border border-white/6">
                    <span className="text-[11px] text-slate-400">
                      Token Credits Allocated
                    </span>
                    <p className="text-lg font-mono font-bold text-indigo-300">
                      {qvMetrics.creditsAllocated.toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-white/6">
                    <span className="text-[11px] text-slate-400">
                      Effective Voting Power
                    </span>
                    <p className="text-lg font-mono font-bold text-emerald-400">
                      {qvMetrics.votesEarned.toLocaleString()} Votes
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-white/6">
                    <span className="text-[11px] text-slate-400">
                      Cost-Vote Ratio
                    </span>
                    <p className="text-lg font-mono font-bold text-cyan-300">
                      {(
                        qvMetrics.creditsAllocated /
                        Math.max(1, qvMetrics.votesEarned)
                      ).toFixed(2)}
                      x
                    </p>
                  </div>
                </div>

                {/* Slider Input */}
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-xs text-slate-400 font-mono">
                    <span>1 Credit</span>
                    <span className="text-amber-400 font-bold">
                      {creditAllocation} Credits
                    </span>
                    <span>250 Credits</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={250}
                    value={creditAllocation}
                    onChange={(e) =>
                      setCreditAllocation(Number(e.target.value))
                    }
                    className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                    aria-label="Quadratic credit allocation slider"
                  />
                </div>

                {/* Vector SVG Curve */}
                <div className="pt-2">
                  <svg
                    viewBox="0 0 300 100"
                    className="w-full h-24 bg-slate-950/70 rounded-xl border border-white/6 p-2"
                  >
                    {/* Gridlines */}
                    <line
                      x1="20"
                      y1="80"
                      x2="280"
                      y2="80"
                      stroke="#334155"
                      strokeWidth="1"
                    />
                    <line
                      x1="20"
                      y1="20"
                      x2="20"
                      y2="80"
                      stroke="#334155"
                      strokeWidth="1"
                    />

                    {/* Quadratic curve line */}
                    <path
                      d={
                        "M " +
                        curvePoints
                          .map((p) => {
                            const x = 20 + (p.credits / 250) * 260;
                            const y = 80 - (p.votes / 16) * 60;
                            return `${x} ${y}`;
                          })
                          .join(" L ")
                      }
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth="2.5"
                    />

                    {/* Active position dot */}
                    {(() => {
                      const activeX =
                        20 + (qvMetrics.creditsAllocated / 250) * 260;
                      const activeY = 80 - (qvMetrics.votesEarned / 16) * 60;
                      return (
                        <>
                          <circle
                            cx={activeX}
                            cy={activeY}
                            r="4.5"
                            fill="#f59e0b"
                          />
                          <circle
                            cx={activeX}
                            cy={activeY}
                            r="8"
                            fill="#f59e0b"
                            fillOpacity="0.25"
                            className="animate-ping"
                          />
                        </>
                      );
                    })()}
                  </svg>
                </div>
              </div>
            )}

            {/* --- Simulated Treasury Impact --- */}
            {treasuryImpact && (
              <TreasuryImpactVisualizer impact={treasuryImpact} />
            )}

            {/* --- Forecasted Execution Impact (State Diffs) --- */}
            <div className="p-5 rounded-2xl border border-white/8 bg-slate-900/50 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-cyan-400" />
                  Forecasted Execution Impact & Ledger State Diffs
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Illustrative fixture data only. These diffs are not produced
                  by contract execution or a live ledger.
                </p>
              </div>

              {/* Target Contract Entrypoint Card */}
              <div className="p-3 rounded-xl bg-slate-950 border border-white/6 font-mono text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Target Contract:</span>
                  <span className="text-slate-200 font-semibold truncate max-w-xs">
                    {activeProposal.executablePayload.targetContract}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Entrypoint Function:</span>
                  <span className="text-indigo-400 font-semibold">
                    {activeProposal.executablePayload.functionName}()
                  </span>
                </div>
              </div>

              {/* State Diffs Table */}
              <div className="border border-white/8 rounded-xl overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 border-b border-white/8 text-slate-400 font-mono text-[11px]">
                    <tr>
                      <th className="p-3">Ledger Storage Key</th>
                      <th className="p-3">Diff Type</th>
                      <th className="p-3">Previous State</th>
                      <th className="p-3">Forecasted State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/4 font-mono">
                    {activeProposal.prospectiveStateDiff.map((diff) => (
                      <tr
                        key={diff.key}
                        className="hover:bg-white/2 transition"
                      >
                        <td className="p-3 font-semibold text-slate-200">
                          <div className="flex items-center gap-1.5">
                            <span>{diff.key}</span>
                            {diff.isSecurityCritical && (
                              <span
                                className="px-1.5 py-0.2 rounded text-[10px] font-sans font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                title="Security critical parameter"
                              >
                                Critical
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          {diff.diffType === "modified" && (
                            <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-[10px] font-semibold">
                              Δ Modified
                            </span>
                          )}
                          {diff.diffType === "added" && (
                            <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] font-semibold">
                              + Added
                            </span>
                          )}
                          {diff.diffType === "removed" && (
                            <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded text-[10px] font-semibold">
                              - Removed
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-400 truncate max-w-xs">
                          {diff.previousValue !== null
                            ? JSON.stringify(diff.previousValue)
                            : "null"}
                        </td>
                        <td className="p-3 font-semibold text-emerald-300 truncate max-w-xs">
                          {diff.proposedValue !== null
                            ? JSON.stringify(diff.proposedValue)
                            : "null"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* --- Interactive Voting Interface --- */}
            {activeProposal.status === "Active" && (
              <div className="p-5 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-indigo-950/40 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Vote className="w-4 h-4 text-indigo-400" />
                    Cast Your Vote (Wallet:{" "}
                    {formatAddress(connectedWalletAddress)})
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    Allocating {creditAllocation} Credits (
                    {qvMetrics.votesEarned} Votes)
                  </span>
                </div>

                {/* Choice Buttons */}
                <div className="grid grid-cols-3 gap-3">
                  {(["For", "Against", "Abstain"] as const).map((choice) => (
                    <button
                      key={choice}
                      onClick={() => setVoteChoice(choice)}
                      className={`py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                        voteChoice === choice
                          ? choice === "For"
                            ? "bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-500/20"
                            : choice === "Against"
                              ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-500/20"
                              : "bg-slate-700 text-white border-slate-600 shadow-lg"
                          : "bg-slate-950 border-white/8 text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      {voteChoice === choice && (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Vote {choice}</span>
                    </button>
                  ))}
                </div>

                {/* Submit Vote Button */}
                <button
                  onClick={handleVoteSubmit}
                  disabled={isSubmittingVote}
                  className="w-full py-3 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center justify-center gap-2 shadow-xl shadow-indigo-600/25 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmittingVote
                      ? "Submitting Vote..."
                      : `Authorize Vote (${voteChoice} - ${qvMetrics.votesEarned} Votes)`}
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-xs p-10">
            Select a proposal to view impact analysis and voting metrics.
          </div>
        )}
      </div>

      {/* --- Batch Voting Modal --- */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b border-white/8 bg-slate-900/60">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  Batch Proposal Voting
                </h3>
              </div>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              <p className="text-xs text-slate-300">
                Choose proposals and credits for this demo batch. A host
                callback may handle submission; this component does not create
                an on-chain transaction.
              </p>

              {proposals
                .filter((p) => p.status === "Active")
                .map((p) => {
                  const currentSelection = batchSelections[p.id] || {
                    choice: "For",
                    credits: 50,
                    selected: false,
                  };
                  return (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl border border-white/8 bg-slate-900/40 space-y-2"
                    >
                      <div className="flex justify-between items-center text-xs">
                        <label className="flex items-center gap-2 font-mono font-bold text-indigo-400">
                          <input
                            type="checkbox"
                            aria-label={`Include ${p.id} in batch`}
                            checked={currentSelection.selected ?? false}
                            onChange={(event) =>
                              setBatchSelections((prev) => ({
                                ...prev,
                                [p.id]: {
                                  ...currentSelection,
                                  selected: event.target.checked,
                                },
                              }))
                            }
                          />
                          {p.id}
                        </label>
                        <span className="text-slate-400 truncate max-w-xs font-semibold">
                          {p.title}
                        </span>
                      </div>
                      <label className="flex items-center gap-3 text-xs text-slate-400">
                        Credits
                        <input
                          type="number"
                          min={1}
                          max={250}
                          value={currentSelection.credits}
                          aria-label={`Credits for ${p.id}`}
                          onChange={(event) =>
                            setBatchSelections((prev) => ({
                              ...prev,
                              [p.id]: {
                                ...currentSelection,
                                credits: Math.min(
                                  250,
                                  Math.max(1, Number(event.target.value) || 1),
                                ),
                              },
                            }))
                          }
                          className="w-24 rounded bg-slate-950 border border-white/10 px-2 py-1 text-slate-100"
                        />
                      </label>

                      <div className="grid grid-cols-3 gap-2">
                        {(["For", "Against", "Abstain"] as const).map((c) => (
                          <button
                            key={c}
                            onClick={() =>
                              setBatchSelections((prev) => ({
                                ...prev,
                                [p.id]: { ...currentSelection, choice: c },
                              }))
                            }
                            className={`py-1 rounded-lg text-xs font-semibold border ${
                              currentSelection.choice === c
                                ? "bg-indigo-600 text-white border-indigo-500"
                                : "bg-slate-950 border-white/6 text-slate-400"
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="p-4 border-t border-white/8 bg-slate-900/60 flex items-center justify-between">
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchSubmit}
                disabled={
                  isSubmittingBatch ||
                  !Object.values(batchSelections).some(
                    (selection) => selection.selected,
                  )
                }
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition"
              >
                {isSubmittingBatch
                  ? "Submitting Batch..."
                  : "Submit Batch Votes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
