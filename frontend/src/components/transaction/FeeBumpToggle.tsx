// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

"use client";

import React from "react";
import { Sparkles, Shield, AlertTriangle, Info, Check, Copy } from "lucide-react";
import type { FeeBreakdown } from "../../services/stellar/feeBumpService";

export interface FeeBumpToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  feeBreakdown?: FeeBreakdown | null;
  sponsorAddress?: string;
  maxFeeStroops?: string | number;
  maxFeeXlm?: string;
  innerFeeStroops?: string | number;
  innerFeeXlm?: string;
  studentFeeStroops?: string | number;
  studentFeeXlm?: string;
  isBudgetExhausted?: boolean;
  fallbackMessage?: string | null;
  disabled?: boolean;
  className?: string;
  showBreakdown?: boolean;
}

export default function FeeBumpToggle({
  enabled,
  onChange,
  feeBreakdown,
  sponsorAddress: customSponsorAddress,
  maxFeeStroops: customMaxFeeStroops,
  maxFeeXlm: customMaxFeeXlm,
  innerFeeStroops: customInnerFeeStroops,
  innerFeeXlm: customInnerFeeXlm,
  studentFeeStroops: customStudentFeeStroops,
  studentFeeXlm: customStudentFeeXlm,
  isBudgetExhausted = false,
  fallbackMessage,
  disabled = false,
  className = "",
  showBreakdown = true,
}: FeeBumpToggleProps) {
  const [copied, setCopied] = React.useState(false);

  // Derived values from feeBreakdown or explicit props
  const sponsorAddress =
    feeBreakdown?.sponsorAddress ?? customSponsorAddress ?? "GC3XPWNDCVYHFGKN3LQF3AHOQNTH52Q2Z2VSHJIIPSPSRGYEFESGBFOK";
  const maxFeeStroops = feeBreakdown?.maxFeeStroops ?? customMaxFeeStroops ?? "400";
  const maxFeeXlm = feeBreakdown?.maxFeeXlm ?? customMaxFeeXlm ?? "0.0000400 XLM";
  const innerFeeStroops = feeBreakdown?.innerFeeStroops ?? customInnerFeeStroops ?? "100";
  const innerFeeXlm = feeBreakdown?.innerFeeXlm ?? customInnerFeeXlm ?? "0.0000100 XLM";
  const studentFeeStroops = enabled
    ? (feeBreakdown?.studentFeeStroops ?? customStudentFeeStroops ?? "0")
    : (feeBreakdown?.studentFeeStroops ?? customStudentFeeStroops ?? innerFeeStroops);
  const studentFeeXlm = enabled
    ? (feeBreakdown?.studentFeeXlm ?? customStudentFeeXlm ?? "0.0000000 XLM")
    : (feeBreakdown?.studentFeeXlm ?? customStudentFeeXlm ?? innerFeeXlm);

  const handleCopySponsor = () => {
    if (typeof navigator !== "undefined" && sponsorAddress) {
      navigator.clipboard.writeText(sponsorAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggle = () => {
    if (disabled || (isBudgetExhausted && !enabled)) return;
    onChange(!enabled);
  };

  return (
    <div
      className={`rounded-2xl border transition-all ${
        enabled
          ? "border-emerald-500/30 bg-emerald-950/10 shadow-lg shadow-emerald-500/5"
          : "border-slate-800 bg-slate-900/60"
      } p-4 text-xs ${className}`}
      data-testid="fee-bump-toggle-container"
    >
      {/* Header and Toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 rounded-lg p-2 ${
              enabled
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-slate-800 text-slate-400"
            }`}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-100">
                Transaction Sponsorship
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  enabled
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {enabled ? "Lab Sponsored" : "Self-Pay"}
              </span>
            </div>
            <p className="mt-0.5 text-slate-400 text-[11px]">
              {enabled
                ? "Zero-XLM student accounts can submit verification transactions without paying network fees."
                : "Student account pays initial network fees directly."}
            </p>
          </div>
        </div>

        {/* Accessible Switch Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle transaction sponsorship"
          onClick={handleToggle}
          disabled={disabled || (isBudgetExhausted && !enabled)}
          data-testid="fee-bump-toggle"
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-emerald-500" : "bg-slate-700"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Relayer Budget Exhausted Alert Banner */}
      {(isBudgetExhausted || fallbackMessage) && (
        <div
          role="alert"
          data-testid="relayer-budget-alert"
          className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium text-amber-300">
              Relayer Sponsor Budget Exhausted
            </p>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              {fallbackMessage ??
                "The lab sponsor key has exhausted its fee budget for this period. Falling back to self-pay."}
            </p>
          </div>
        </div>
      )}

      {/* Fee Breakdown Display */}
      {showBreakdown && (
        <section
          aria-label="Fee breakdown"
          data-testid="fee-breakdown"
          className="mt-3 divide-y divide-white/5 rounded-xl border border-white/5 bg-slate-950/40 p-3"
        >
          <div className="flex items-center justify-between pb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Fee Breakdown
            </span>
            <span className="text-[10px] text-slate-400">
              {enabled ? "Stellar Fee Bump (SEP-0015)" : "Standard Envelope"}
            </span>
          </div>

          {enabled && sponsorAddress && (
            <div
              data-testid="sponsor-address-row"
              className="flex items-center justify-between py-2 text-slate-300"
            >
              <div className="flex items-center gap-1.5 text-slate-400">
                <Shield size={12} className="text-emerald-400" />
                <span>Sponsor Address</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  data-testid="sponsor-address"
                  className="font-mono text-[11px] text-slate-200"
                  title={sponsorAddress}
                >
                  {sponsorAddress.slice(0, 4)}…{sponsorAddress.slice(-4)}
                </span>
                <button
                  type="button"
                  onClick={handleCopySponsor}
                  title="Copy sponsor public key"
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  {copied ? (
                    <Check size={12} className="text-emerald-400" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            </div>
          )}

          {enabled && (
            <div
              data-testid="max-fee-limit-row"
              className="flex items-center justify-between py-2 text-slate-300"
            >
              <div className="flex items-center gap-1.5 text-slate-400">
                <Info size={12} className="text-cyan-400" />
                <span>Sponsor Max Fee Limit</span>
              </div>
              <div
                data-testid="max-fee-limit"
                className="font-medium text-slate-200 text-right"
              >
                <span>{maxFeeStroops} stroops</span>
                <span className="ml-1 text-slate-400 text-[10px]">
                  ({maxFeeXlm})
                </span>
              </div>
            </div>
          )}

          <div
            data-testid="student-fee-row"
            className="flex items-center justify-between py-2"
          >
            <span className="text-slate-400">Student Fee</span>
            <div
              data-testid="student-fee"
              className={`font-semibold text-right ${
                enabled ? "text-emerald-300" : "text-slate-200"
              }`}
            >
              <span>{studentFeeStroops} stroops</span>
              <span className="ml-1 text-[10px]">
                ({studentFeeXlm})
              </span>
              {enabled && (
                <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                  Free
                </span>
              )}
            </div>
          </div>

          <div
            data-testid="inner-fee-row"
            className="flex items-center justify-between pt-2 text-slate-400 text-[11px]"
          >
            <span>Inner Transaction Base Fee</span>
            <span data-testid="inner-fee">
              {innerFeeStroops} stroops ({innerFeeXlm})
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
