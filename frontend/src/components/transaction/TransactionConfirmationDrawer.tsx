// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

"use client";

import React, { useState, useMemo } from "react";
import {
  Shield,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Code2,
} from "lucide-react";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { useWallet } from "../providers/WalletProvider";
import { useFeeBump } from "../../hooks/useFeeBump";
import FeeBumpToggle from "./FeeBumpToggle";

export interface TransactionConfirmationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  xdr?: string;
  title?: string;
  description?: string;
  networkPassphrase?: string;
  sponsorKeypair?: Keypair | string;
  maxBaseFee?: number | string;
  onConfirm?: (finalXdr: string, isSponsored: boolean) => Promise<void> | void;
  initialSponsored?: boolean;
}

export default function TransactionConfirmationDrawer({
  isOpen,
  onClose,
  xdr,
  title = "Confirm Transaction",
  description = "Review your exercise verification transaction and sponsorship details before submitting.",
  networkPassphrase,
  sponsorKeypair,
  maxBaseFee,
  onConfirm,
  initialSponsored = true,
}: TransactionConfirmationDrawerProps) {
  const {
    signTransaction,
    status: walletStatus,
    network,
    networkPassphrase: walletNetworkPassphrase,
  } = useWallet();

  const netPassphrase = networkPassphrase ?? walletNetworkPassphrase;

  const {
    isSponsored,
    setIsSponsored,
    sponsorAddress,
    isBudgetExhausted,
    fallbackOccurred,
    fallbackReason,
    getFeeBreakdown,
    wrapTransaction,
  } = useFeeBump({
    initialSponsored,
    networkPassphrase: netPassphrase,
    sponsorKeypair,
    maxBaseFee,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setHasReviewed(false);
      setSubmissionSuccess(false);
      setErrorMessage(null);
    }
  }, [isOpen, xdr]);

  const feeBreakdown = useMemo(() => {
    if (!xdr) return null;
    return getFeeBreakdown(xdr);
  }, [xdr, getFeeBreakdown]);

  const parsedTx = useMemo(() => {
    if (!xdr) return null;
    try {
      const parsed = TransactionBuilder.fromXDR(xdr, netPassphrase) as unknown as {
        fee?: string;
        operations?: Array<{ type?: string }>;
        innerTransaction?: { operations?: Array<{ type?: string }> };
      };
      const tx = parsed.innerTransaction ?? parsed;
      return {
        fee: parsed.fee ?? "100",
        operationsCount: Array.isArray(tx.operations) ? tx.operations.length : 1,
        operations: tx.operations ?? [],
      };
    } catch {
      return null;
    }
  }, [xdr, netPassphrase]);

  if (!isOpen) return null;

  const handleConfirmAndSubmit = async () => {
    if (!xdr || !hasReviewed) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Sign inner transaction with the user/student wallet
      const signedInnerXdr = await signTransaction(xdr);
      if (!signedInnerXdr) {
        throw new Error("Transaction signing was rejected or cancelled by wallet.");
      }

      // 2. Wrap in Fee Bump transaction if sponsorship enabled
      const finalXdr = await wrapTransaction(signedInnerXdr);

      // 3. Dispatch onConfirm callback
      if (onConfirm) {
        await onConfirm(finalXdr, isSponsored && !fallbackOccurred);
      }

      setSubmissionSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit transaction";
      setErrorMessage(msg);
      console.error("Submission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-drawer-title"
      data-testid="transaction-confirmation-drawer"
      className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/80 backdrop-blur-sm transition-opacity"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/20 p-2 text-cyan-400">
              <Shield size={20} />
            </div>
            <div>
              <h2
                id="confirmation-drawer-title"
                className="text-lg font-semibold text-white"
              >
                {title}
              </h2>
              <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                {network ?? "TESTNET"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close transaction drawer"
            className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-sm">
          <p className="text-xs text-slate-400 leading-relaxed">
            {description}
          </p>

          {/* Transaction Summary Card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-slate-500 text-[10px]">
                Operation Summary
              </span>
              <span>{parsedTx?.operationsCount ?? 1} operation(s)</span>
            </div>

            {parsedTx ? (
              <div className="space-y-2 text-xs">
                {parsedTx.operations.map((op, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-2 text-slate-300 font-mono text-[11px]"
                  >
                    <span>Op #{idx + 1}</span>
                    <span className="font-semibold text-cyan-300">
                      {op.type ?? "invokeHostFunction"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-300">
                <AlertTriangle size={14} />
                <span>Could not decode operations from XDR.</span>
              </div>
            )}
          </div>

          {/* Transaction Sponsorship Toggle & Fee Breakdown */}
          <FeeBumpToggle
            enabled={isSponsored}
            onChange={setIsSponsored}
            feeBreakdown={feeBreakdown}
            sponsorAddress={sponsorAddress}
            isBudgetExhausted={isBudgetExhausted}
            fallbackMessage={fallbackReason}
            disabled={isSubmitting}
          />

          {/* Raw XDR Inspect */}
          {xdr && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <Code2 size={12} />
                <span>Raw Unsigned Envelope</span>
              </div>
              <div className="max-h-20 overflow-y-auto rounded-xl border border-white/5 bg-slate-950/60 p-3 font-mono text-[10px] text-slate-400 break-all">
                {xdr}
              </div>
            </div>
          )}

          {/* Review Checkbox */}
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300 cursor-pointer hover:bg-white/10 transition-colors">
            <input
              type="checkbox"
              checked={hasReviewed}
              onChange={(e) => setHasReviewed(e.target.checked)}
              disabled={isSubmitting}
              className="mt-0.5 accent-cyan-400"
            />
            <span>
              I have reviewed the transaction operations and {isSponsored ? "sponsored fee limit" : "self-pay fee"}.
            </span>
          </label>

          {/* Error Message */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-white/8 bg-white/5 p-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white hover:bg-white/5 disabled:opacity-50 transition-all text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmAndSubmit}
            disabled={isSubmitting || !hasReviewed || !xdr || walletStatus !== "connected"}
            className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3 font-semibold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
          >
            {isSubmitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Submitting…
              </span>
            ) : submissionSuccess ? (
              <span className="inline-flex items-center justify-center gap-2 text-emerald-300">
                <CheckCircle2 size={16} />
                Submitted
              </span>
            ) : isSponsored ? (
              "Sponsor & Submit"
            ) : (
              "Confirm & Submit"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
