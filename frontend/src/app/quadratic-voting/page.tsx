"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState, useEffect, useCallback } from "react";
import QuadraticVotingDashboard, { QVProposal } from "../../components/QuadraticVotingDashboard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

export default function QuadraticVotingPage() {
  const [contractId, setContractId] = useState(
    process.env.NEXT_PUBLIC_QV_CONTRACT_ID ?? ""
  );
  const [walletAddress] = useState<string | undefined>(undefined);
  const [proposals, setProposals] = useState<QVProposal[]>([]);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // For demo purposes – in production derive from wallet
  const isAdmin = true;
  const maxCredits = 100;

  const fetchProposals = useCallback(async () => {
    if (!contractId) return;
    setIsLoading(true);
    setError("");
    try {
      const countRes = await fetch(
        `${API_BASE}/api/quadratic-voting/proposals/count?contractId=${encodeURIComponent(contractId)}`
      );
      const countData = await countRes.json();
      if (!countData.success) throw new Error(countData.error);

      const count: number = countData.data.count;
      const fetched: QVProposal[] = [];
      for (let i = 0; i < count; i++) {
        const res = await fetch(
          `${API_BASE}/api/quadratic-voting/proposals/${i}?contractId=${encodeURIComponent(contractId)}`
        );
        const data = await res.json();
        if (data.success) {
          const p = data.data;
          fetched.push({
            id: p.id,
            proposer: p.proposer,
            title: p.title,
            description: p.description,
            status: p.status,
            votesFor: p.votes_for ?? 0,
            votesAgainst: p.votes_against ?? 0,
            voteStart: p.vote_start,
            voteEnd: p.vote_end,
          });
        }
      }
      setProposals(fetched);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load proposals");
    } finally {
      setIsLoading(false);
    }
  }, [contractId]);

  const fetchStatus = useCallback(async () => {
    if (!contractId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/quadratic-voting/status?contractId=${encodeURIComponent(contractId)}`
      );
      const data = await res.json();
      if (data.success) setIsPaused(data.data.paused);
    } catch {
      // non-critical
    }
  }, [contractId]);

  useEffect(() => {
    fetchProposals();
    fetchStatus();
  }, [fetchProposals, fetchStatus]);

  const handleCreateProposal = useCallback(
    async (title: string, description: string) => {
      const res = await fetch(`${API_BASE}/api/quadratic-voting/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, admin: walletAddress, title, description }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchProposals();
    },
    [contractId, walletAddress, fetchProposals]
  );

  const handleVote = useCallback(
    async (proposalId: number, credits: number, isFor: boolean) => {
      const res = await fetch(`${API_BASE}/api/quadratic-voting/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, voter: walletAddress, proposalId, credits, isFor }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchProposals();
    },
    [contractId, walletAddress, fetchProposals]
  );

  const handleFinalize = useCallback(
    async (proposalId: number) => {
      const res = await fetch(
        `${API_BASE}/api/quadratic-voting/proposals/${proposalId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchProposals();
    },
    [contractId, fetchProposals]
  );

  const handleWhitelist = useCallback(
    async (voter: string, allow: boolean) => {
      const res = await fetch(`${API_BASE}/api/quadratic-voting/whitelist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, admin: walletAddress, voter, allow }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
    },
    [contractId, walletAddress]
  );

  const handlePause = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/quadratic-voting/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId, admin: walletAddress }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    setIsPaused(true);
  }, [contractId, walletAddress]);

  const handleUnpause = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/quadratic-voting/unpause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId, admin: walletAddress }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    setIsPaused(false);
  }, [contractId, walletAddress]);

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Contract ID input */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Contract ID (C…)"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            className="flex-1 bg-slate-800 text-white text-sm rounded px-3 py-2 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            aria-label="Contract ID"
          />
          <button
            onClick={() => { fetchProposals(); fetchStatus(); }}
            className="bg-cyan-700 hover:bg-cyan-600 text-white text-sm px-4 py-2 rounded transition-colors"
            aria-label="Refresh proposals"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div
            className="bg-rose-900/30 border border-rose-700 text-rose-300 text-xs rounded p-3"
            role="alert"
          >
            {error}
          </div>
        )}

        <QuadraticVotingDashboard
          contractId={contractId}
          walletAddress={walletAddress}
          proposals={proposals}
          isWhitelisted={isWhitelisted}
          isPaused={isPaused}
          isAdmin={isAdmin}
          maxCredits={maxCredits}
          isLoading={isLoading}
          onCreateProposal={handleCreateProposal}
          onVote={handleVote}
          onFinalize={handleFinalize}
          onWhitelist={handleWhitelist}
          onPause={handlePause}
          onUnpause={handleUnpause}
        />
      </div>
    </main>
  );
}
