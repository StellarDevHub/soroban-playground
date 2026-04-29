"use client";

import React, { useEffect, useState } from "react";
import { Coins, Users, Clock, BarChart2, StopCircle, CheckCircle2, AlertCircle } from "lucide-react";
import type { Campaign, CampaignStats, EligibilityResult } from "../../hooks/useAirdrop";

interface Props {
  campaign: Campaign;
  walletAddress: string | null;
  onClaim: (campaignId: number, address: string) => Promise<void>;
  onEnd: (campaignId: number, admin: string) => Promise<void>;
  onAddAllowlist: (campaignId: number, addresses: string[]) => Promise<void>;
  getStats: (id: number) => Promise<CampaignStats | null>;
  checkEligibility: (id: number, address: string) => Promise<EligibilityResult | null>;
}

function formatTs(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

export default function CampaignDetail({
  campaign, walletAddress, onClaim, onEnd, onAddAllowlist, getStats, checkEligibility,
}: Props) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [allowlistInput, setAllowlistInput] = useState("");
  const [claimStatus, setClaimStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [claimMsg, setClaimMsg] = useState("");

  useEffect(() => {
    getStats(campaign.id).then(setStats);
    if (walletAddress) {
      checkEligibility(campaign.id, walletAddress).then(setEligibility);
    }
  }, [campaign.id, walletAddress, getStats, checkEligibility]);

  async function handleClaim() {
    if (!walletAddress) return;
    setClaimStatus("loading");
    try {
      await onClaim(campaign.id, walletAddress);
      setClaimStatus("success");
      setClaimMsg(`Claimed ${campaign.amountPerClaim.toLocaleString()} tokens!`);
      getStats(campaign.id).then(setStats);
      checkEligibility(campaign.id, walletAddress).then(setEligibility);
    } catch (e) {
      setClaimStatus("error");
      setClaimMsg(e instanceof Error ? e.message : "Claim failed");
    }
  }

  async function handleAddAllowlist() {
    const addrs = allowlistInput.split(/[\n,]+/).map((a) => a.trim()).filter(Boolean);
    if (!addrs.length) return;
    await onAddAllowlist(campaign.id, addrs);
    setAllowlistInput("");
    getStats(campaign.id).then(setStats);
  }

  const isAdmin = walletAddress === campaign.admin;
  const progress = stats
    ? Math.min(100, Math.round((stats.claimedAmount / stats.totalAmount) * 100))
    : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-white">{campaign.name}</h3>
          {campaign.description && (
            <p className="text-sm text-gray-400 mt-0.5">{campaign.description}</p>
          )}
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
          campaign.status === "active" ? "bg-green-900/50 text-green-400" : "bg-gray-700 text-gray-400"
        }`}>
          {campaign.status === "active"
            ? <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            : <StopCircle className="w-3 h-3" aria-hidden="true" />}
          {campaign.status}
        </span>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Per Claim", value: stats.claimedAmount.toLocaleString(), icon: <Coins className="w-4 h-4 text-yellow-400" /> },
            { label: "Remaining", value: stats.remainingAmount.toLocaleString(), icon: <BarChart2 className="w-4 h-4 text-indigo-400" /> },
            { label: "Claims", value: stats.claimCount, icon: <Users className="w-4 h-4 text-blue-400" /> },
            { label: "Claim Rate", value: `${stats.claimRate}%`, icon: <BarChart2 className="w-4 h-4 text-green-400" /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                {icon}<span>{label}</span>
              </div>
              <p className="text-lg font-bold text-white">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Distribution progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden" role="progressbar"
          aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Timestamps */}
      <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Start: {formatTs(campaign.startTimestamp)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>End: {formatTs(campaign.endTimestamp)}</span>
        </div>
      </div>

      {/* Claim section */}
      {walletAddress && campaign.status === "active" && (
        <div className="border border-gray-700 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">Claim Tokens</h4>

          {eligibility && (
            <div className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
              eligibility.eligible ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
            }`}>
              {eligibility.eligible
                ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                : <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
              <span>
                {eligibility.hasClaimed
                  ? "Already claimed"
                  : !eligibility.isAllowlisted
                  ? "Not on allowlist"
                  : !eligibility.hasStarted
                  ? "Campaign not started yet"
                  : !eligibility.notExpired
                  ? "Campaign expired"
                  : !eligibility.hasFunds
                  ? "Campaign out of funds"
                  : "Eligible to claim"}
              </span>
            </div>
          )}

          {claimStatus === "success" && (
            <p className="text-green-400 text-xs">{claimMsg}</p>
          )}
          {claimStatus === "error" && (
            <p className="text-red-400 text-xs">{claimMsg}</p>
          )}

          <button
            onClick={handleClaim}
            disabled={claimStatus === "loading" || !eligibility?.eligible}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            {claimStatus === "loading" ? "Claiming…" : `Claim ${campaign.amountPerClaim.toLocaleString()} tokens`}
          </button>
        </div>
      )}

      {/* Admin section */}
      {isAdmin && campaign.status === "active" && (
        <div className="border border-gray-700 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">Admin Controls</h4>

          {campaign.requireAllowlist && (
            <div className="space-y-2">
              <label className="block text-xs text-gray-400" htmlFor="allowlist-input">
                Add to allowlist (one address per line or comma-separated)
              </label>
              <textarea
                id="allowlist-input"
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={allowlistInput}
                onChange={(e) => setAllowlistInput(e.target.value)}
                placeholder="G..., G..."
              />
              <button
                onClick={handleAddAllowlist}
                className="w-full bg-blue-700 hover:bg-blue-600 text-white text-sm py-1.5 rounded-lg transition-colors"
              >
                Add Addresses
              </button>
            </div>
          )}

          <button
            onClick={() => onEnd(campaign.id, campaign.admin)}
            className="w-full bg-red-800 hover:bg-red-700 text-white text-sm py-1.5 rounded-lg transition-colors"
          >
            End Campaign &amp; Reclaim Funds
          </button>
        </div>
      )}
    </div>
  );
}
