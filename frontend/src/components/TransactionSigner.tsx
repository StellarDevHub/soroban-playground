"use client";

import React from "react";
import {
  Shield,
  Info,
  AlertTriangle,
  CheckCircle2,
  X,
  Usb,
  Loader2,
} from "lucide-react";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { useWallet } from "./providers/WalletProvider";

interface StagedTransaction {
  fee?: string;
  operations?: StagedOperation[];
  innerTransaction?: StagedTransaction;
}

interface StagedOperation {
  type?: string;
  source?: string;
  destination?: string;
  amount?: string;
  asset?: string | { code?: string };
}

function inspectTransaction(xdr: string, networkPassphrase: string) {
  try {
    const parsed = TransactionBuilder.fromXDR(
      xdr,
      networkPassphrase,
    ) as unknown as StagedTransaction;
    const transaction = parsed.innerTransaction ?? parsed;
    if (!Array.isArray(transaction.operations) || !parsed.fee) return null;

    const fee = Number(parsed.fee);
    const feeXlm = Number.isSafeInteger(fee)
      ? `${(fee / 10_000_000).toFixed(7)} XLM`
      : "Unavailable";

    return {
      operationCount: transaction.operations.length,
      feeStroops: parsed.fee,
      feeXlm,
      operations: transaction.operations,
    };
  } catch {
    return null;
  }
}

interface TransactionSignerProps {
  xdr?: string;
  onSign?: (signedXdr: string) => void;
  onCancel?: () => void;
  isOpen: boolean;
}

export default function TransactionSigner({
  xdr,
  onSign,
  onCancel,
  isOpen,
}: TransactionSignerProps) {
  const {
    signTransaction,
    status,
    error,
    network,
    networkPassphrase,
    activeWallet,
  } = useWallet();
  const [isSigning, setIsSigning] = React.useState(false);
  const [hasReviewed, setHasReviewed] = React.useState(false);
  const [stage, setStage] = React.useState<"review" | "device" | "signed" | "error">("review");
  const transaction = React.useMemo(
    () => (xdr ? inspectTransaction(xdr, networkPassphrase) : null),
    [xdr, networkPassphrase],
  );

  React.useEffect(() => {
    setHasReviewed(false);
    setStage("review");
  }, [isOpen, xdr]);

  if (!isOpen || !xdr) return null;

  const handleSign = async () => {
    if (!transaction || !hasReviewed) return;
    setIsSigning(true);
    setStage(activeWallet === "ledger" ? "device" : "review");
    try {
      const signedXdr = await signTransaction(xdr);
      if (signedXdr) {
        setStage("signed");
        onSign?.(signedXdr);
      } else {
        setStage("error");
      }
    } catch (err) {
      setStage("error");
      console.error("Signing failed", err);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Shield size={20} />
            </div>
            <h2 className="text-xl font-semibold text-white">
              Sign Transaction
            </h2>
          </div>
          <button
            onClick={onCancel}
            disabled={isSigning}
            aria-label="Close transaction signer"
            className="p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6 space-y-5">
          <div className="border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Transaction Details
              </span>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold uppercase">
                {network ?? "TESTNET"}
              </span>
            </div>

            {transaction ? (
              <dl className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Operations</span>
                  <dd className="text-white font-medium">
                    {transaction.operationCount}
                  </dd>
              </div>
              <div className="flex justify-between text-sm">
                  <dt className="text-slate-400">Transaction Fee</dt>
                  <dd className="text-white font-medium text-right">
                    {transaction.feeStroops} stroops ({transaction.feeXlm})
                  </dd>
              </div>
              {transaction.operations.map((operation, index) => (
                <div
                  key={`${operation.type ?? "operation"}-${index}`}
                  className="border-t border-white/10 pt-3 text-sm"
                >
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Operation {index + 1}</dt>
                    <dd className="text-right font-medium text-white">
                      {operation.type ?? "Unknown operation"}
                    </dd>
                  </div>
                  {operation.destination && (
                    <div className="mt-1 flex justify-between gap-4">
                      <dt className="text-slate-500">Destination</dt>
                      <dd className="max-w-[70%] break-all text-right font-mono text-xs text-slate-200">
                        {operation.destination}
                      </dd>
                    </div>
                  )}
                  {operation.amount && (
                    <div className="mt-1 flex justify-between gap-4">
                      <dt className="text-slate-500">Amount</dt>
                      <dd className="text-right text-slate-200">
                        {operation.amount}{" "}
                        {typeof operation.asset === "string"
                          ? operation.asset
                          : operation.asset?.code ?? ""}
                      </dd>
                    </div>
                  )}
                </div>
              ))}
              </dl>
            ) : (
              <div className="flex items-start gap-2 text-sm text-rose-300" role="alert">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>This transaction XDR is invalid for the selected network and cannot be signed.</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Raw XDR
            </label>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-white/5 font-mono text-[10px] text-slate-400 break-all max-h-24 overflow-y-auto">
              {xdr}
            </div>
          </div>

          {activeWallet === "ledger" ? (
            <section className="border border-cyan-400/20 bg-cyan-400/5 p-4" aria-labelledby="ledger-confirmation-title">
              <h3 id="ledger-confirmation-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-100">
                <Usb size={16} className="text-cyan-300" />
                Ledger device confirmation
              </h3>
              <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-slate-300">
                <li>Keep the Ledger connected and unlocked; open the Stellar app.</li>
                <li>Start signing, then review each transaction field displayed on the device.</li>
                <li>Confirm on the Ledger only if the network, fee, and operation details match this review.</li>
              </ol>
              <p className="mt-3 text-xs text-cyan-100" role="status" aria-live="polite">
                {stage === "device"
                  ? "Waiting for Ledger APDU confirmation. Do not unplug the device."
                  : stage === "signed"
                    ? "Ledger signature received."
                    : "Ledger signing times out after 120 seconds; reconnect to retry."}
              </p>
            </section>
          ) : (
            <div className="flex items-start gap-3 border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-200/80">
              <Info className="mt-0.5 shrink-0 text-amber-400" size={16} />
              <p>Review the decoded transaction details and verify the signing request in your wallet before confirming.</p>
            </div>
          )}

          <label className="flex items-start gap-3 border border-white/10 px-4 py-3 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={hasReviewed}
              onChange={(event) => setHasReviewed(event.target.checked)}
              className="mt-0.5 accent-cyan-400"
            />
            <span>I reviewed the transaction summary and will verify the wallet prompt.</span>
          </label>

          {error && (
            <div className="border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 bg-white/5 flex gap-3">
          <button
            onClick={onCancel}
            disabled={isSigning}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white font-semibold hover:bg-white/5 transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSign}
            disabled={isSigning || status !== "connected" || !hasReviewed || !transaction}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSigning ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                {activeWallet === "ledger" ? "Waiting for Ledger..." : "Check Wallet..."}
              </span>
            ) : stage === "signed" ? (
              <span className="inline-flex items-center justify-center gap-2">
                <CheckCircle2 size={16} />
                Signed
              </span>
            ) : (
              activeWallet === "ledger" ? "Review & Send to Ledger" : "Review & Sign"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
