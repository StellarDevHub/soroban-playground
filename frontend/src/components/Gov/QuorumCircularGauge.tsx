"use client";

import React from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";

export interface QuorumCircularGaugeProps {
  progressPct: number;
  totalTokensVoted: number;
  quorumThresholdTokens: number;
  reached: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function QuorumCircularGauge({
  progressPct,
  totalTokensVoted,
  quorumThresholdTokens,
  reached,
  size = 130,
  strokeWidth = 10,
  className = "",
}: QuorumCircularGaugeProps) {
  const radius = (size - strokeWidth * 2) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(100, Math.max(0, progressPct));
  const strokeDashoffset = circumference - (clampedPct / 100) * circumference;

  return (
    <div
      data-testid="quorum-circular-gauge"
      className={`flex flex-col items-center justify-center p-3 rounded-xl bg-slate-950/70 border border-slate-800 ${className}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
          aria-label={`Quorum gauge: ${progressPct}% reached`}
        >
          <defs>
            <linearGradient id="quorumGradActive" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#14b8a6" />
            </linearGradient>
            <linearGradient id="quorumGradPending" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>

          {/* Background Track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#1e293b"
            strokeWidth={strokeWidth}
          />

          {/* Progress Arc */}
          <circle
            data-testid="quorum-gauge-arc"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={reached ? "url(#quorumGradActive)" : "url(#quorumGradPending)"}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>

        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span
            data-testid="quorum-gauge-pct"
            className={`text-lg font-bold font-mono ${
              reached ? "text-emerald-400" : "text-indigo-300"
            }`}
          >
            {progressPct}%
          </span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            {reached ? "Met" : "Quorum"}
          </span>
        </div>
      </div>

      {/* Status Pill & Stats */}
      <div className="mt-2.5 flex flex-col items-center text-center">
        <span
          data-testid="quorum-status-badge"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
            reached
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
          }`}
        >
          {reached ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-3 h-3 text-amber-400" />
          )}
          {reached ? "Quorum Floor Reached" : "Quorum Floor Pending"}
        </span>

        <div className="mt-1 text-[11px] text-slate-400 font-mono">
          <span className="text-white font-semibold">{totalTokensVoted.toLocaleString()}</span> /{" "}
          <span>{quorumThresholdTokens.toLocaleString()} Tokens</span>
        </div>
      </div>
    </div>
  );
}

export default QuorumCircularGauge;
