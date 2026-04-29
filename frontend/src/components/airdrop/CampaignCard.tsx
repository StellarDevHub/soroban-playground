"use client";

import React from "react";
import { Clock, Users, Coins, CheckCircle2, XCircle, StopCircle } from "lucide-react";
import type { Campaign } from "../../hooks/useAirdrop";

interface Props {
  campaign: Campaign;
  onSelect: (c: Campaign) => void;
  selected: boolean;
}

function formatTs(ts: number) {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function pct(claimed: number, total: number) {
  if (total === 0) return 0;
  return Math.min(100, Math.round((claimed / total) * 100));
}

export default function CampaignCard({ campaign, onSelect, selected }: Props) {
  const progress = pct(campaign.claimedAmount, campaign.totalAmount);
  const isActive = campaign.status === "active";

  return (
    <button
      onClick={() => onSelect(campaign)}
      aria-pressed={selected}
      aria-label={`Campaign: ${campaign.name}`}
      className={`w-full text-left p-4 rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
        selected
          ? "border-indigo-500 bg-indigo-950/40"
          : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-white text-sm truncate max-w-[180px]">{campaign.name}</p>
          <p className="text-xs text-gray-400 truncate max-w-[180px]">{campaign.token}</p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            isActive ? "bg-green-900/50 text-green-400" : "bg-gray-700 text-gray-400"
          }`}
        >
          {isActive ? (
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          ) : (
            <StopCircle className="w-3 h-3" aria-hidden="true" />
          )}
          {campaign.status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{progress}% claimed</span>
          <span>{campaign.claimCount} claims</span>
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden" role="progressbar"
          aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <Coins className="w-3 h-3 text-yellow-400" aria-hidden="true" />
          <span>{campaign.amountPerClaim.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-blue-400" aria-hidden="true" />
          <span>{campaign.allowlistSize > 0 ? campaign.allowlistSize : "Open"}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-gray-400" aria-hidden="true" />
          <span>{formatTs(campaign.endTimestamp)}</span>
        </div>
      </div>
    </button>
  );
}
