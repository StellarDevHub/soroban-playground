"use client";

import React from "react";
import { Clock, AlertTriangle, ShieldCheck, Archive } from "lucide-react";
import type { TtlStatus } from "@/types/storageBrowser";

interface TtlBadgeProps {
  ttl: TtlStatus | null;
  className?: string;
  showDetails?: boolean;
}

export const TtlBadge: React.FC<TtlBadgeProps> = ({
  ttl,
  className = "",
  showDetails = true,
}) => {
  if (!ttl) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-800/60 text-gray-400 border border-gray-700/50">
        <Clock className="w-3 h-3 text-gray-500" />
        No TTL
      </span>
    );
  }

  const { status, ledgersRemaining, liveUntilLedgerSeq, estimatedTimeRemaining } =
    ttl;

  if (status === "archived") {
    return (
      <div className={`inline-flex flex-col ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-rose-950/40 text-rose-300 border border-rose-800/40"
          title={`Expired at ledger #${liveUntilLedgerSeq.toLocaleString()}`}
        >
          <Archive className="w-3.5 h-3.5 text-rose-400" />
          Archived
        </span>
        {showDetails && (
          <span className="text-[10px] text-gray-500 mt-0.5">
            Expired #{liveUntilLedgerSeq.toLocaleString()}
          </span>
        )}
      </div>
    );
  }

  if (status === "critical") {
    return (
      <div className={`inline-flex flex-col ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-950/50 text-red-300 border border-red-700/60 shadow-sm shadow-red-950/30"
          title={`Live until ledger #${liveUntilLedgerSeq.toLocaleString()} (${ledgersRemaining.toLocaleString()} ledgers left)`}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span>
            {ledgersRemaining.toLocaleString()} ledgers ({estimatedTimeRemaining})
          </span>
        </span>
        {showDetails && (
          <span className="text-[10px] text-red-400/80 font-mono mt-0.5">
            Expires #{liveUntilLedgerSeq.toLocaleString()}
          </span>
        )}
      </div>
    );
  }

  if (status === "expiring") {
    return (
      <div className={`inline-flex flex-col ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-950/40 text-amber-300 border border-amber-800/50"
          title={`Live until ledger #${liveUntilLedgerSeq.toLocaleString()} (${ledgersRemaining.toLocaleString()} ledgers left)`}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span>
            {ledgersRemaining.toLocaleString()} ledgers ({estimatedTimeRemaining})
          </span>
        </span>
        {showDetails && (
          <span className="text-[10px] text-amber-400/80 font-mono mt-0.5">
            Expires #{liveUntilLedgerSeq.toLocaleString()}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-950/30 text-emerald-300 border border-emerald-800/40"
        title={`Live until ledger #${liveUntilLedgerSeq.toLocaleString()} (${ledgersRemaining.toLocaleString()} ledgers left)`}
      >
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        <span>
          {ledgersRemaining.toLocaleString()} ledgers ({estimatedTimeRemaining})
        </span>
      </span>
      {showDetails && (
        <span className="text-[10px] text-gray-500 font-mono mt-0.5">
          Expires #{liveUntilLedgerSeq.toLocaleString()}
        </span>
      )}
    </div>
  );
};

export default TtlBadge;
