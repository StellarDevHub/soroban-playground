"use client";

import React, { useState } from "react";
import {
  Zap,
  X,
  Clock,
  ArrowRight,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import type { StorageBrowserEntry, BumpTtlResult } from "@/types/storageBrowser";
import { executeBumpTtl, LEDGER_TIME_SECONDS } from "@/services/storageBrowserService";

interface BumpTtlModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: StorageBrowserEntry | null;
  currentLedger: number;
  onSuccess: (entryId: string, newLiveUntil: number) => void;
}

const EXTENSION_PRESETS = [
  { label: "+10,000", ledgers: 10000, desc: "~14 hours" },
  { label: "+50,000", ledgers: 50000, desc: "~3 days" },
  { label: "+120,000", ledgers: 120000, desc: "~7 days" },
  { label: "+500,000", ledgers: 500000, desc: "~29 days" },
];

export const BumpTtlModal: React.FC<BumpTtlModalProps> = ({
  isOpen,
  onClose,
  entry,
  currentLedger,
  onSuccess,
}) => {
  const [selectedLedgers, setSelectedLedgers] = useState<number>(50000);
  const [customLedgers, setCustomLedgers] = useState<string>("");
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<BumpTtlResult | null>(null);

  if (!isOpen || !entry) return null;

  const effectiveExtension = isCustom
    ? Math.max(1, parseInt(customLedgers || "0", 10))
    : selectedLedgers;

  const currentLiveUntil = entry.ttl?.liveUntilLedgerSeq ?? currentLedger;
  const newLiveUntil = currentLedger + effectiveExtension;
  const newDays = ((effectiveExtension * LEDGER_TIME_SECONDS) / 86400).toFixed(1);

  const handlePresetClick = (ledgers: number) => {
    setIsCustom(false);
    setSelectedLedgers(ledgers);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsCustom(true);
    setCustomLedgers(e.target.value.replace(/[^0-9]/g, ""));
  };

  const handleInvoke = async () => {
    setIsSubmitting(true);
    setResult(null);

    const res = await executeBumpTtl(
      {
        contractId: entry.contractId,
        keyXdr: entry.keyRaw,
        durability: entry.durability,
        extendToLedgers: effectiveExtension,
      },
      currentLedger
    );

    setIsSubmitting(false);
    setResult(res);

    if (res.success && res.newLiveUntil) {
      onSuccess(entry.id, res.newLiveUntil);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bump-ttl-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden text-gray-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/60">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 id="bump-ttl-title" className="text-base font-semibold">
                Bump Storage Entry TTL
              </h2>
              <p className="text-xs text-gray-400">
                Extend archival deadline on Stellar ledger
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {result?.success ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-emerald-300">
                  TTL Successfully Extended!
                </h3>
                <p className="text-xs text-gray-300 mt-1">
                  Storage entry extended by{" "}
                  <span className="font-semibold text-white">
                    {effectiveExtension.toLocaleString()} ledgers
                  </span>
                  .
                </p>
              </div>

              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs font-mono text-left space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-400">New Expiration:</span>
                  <span className="text-emerald-300 font-semibold">
                    Ledger #{result.newLiveUntil?.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Transaction Hash:</span>
                  <span className="text-cyan-400 truncate max-w-[200px]" title={result.txHash}>
                    {result.txHash}
                  </span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 font-medium text-sm rounded-lg text-white transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Target Entry Preview */}
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Target Key:</span>
                  <span className="font-mono text-cyan-300 font-medium truncate max-w-[260px]">
                    {entry.keyDecoded.displayValue}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Key Type:</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800/40">
                    {entry.keyDecoded.type}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Durability:</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-950/60 text-purple-300 border border-purple-800/40 uppercase">
                    {entry.durability}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-800">
                  <span className="text-gray-400">Current Expiration:</span>
                  <span className="font-mono text-amber-300">
                    Ledger #{currentLiveUntil.toLocaleString()} ({entry.ttl?.estimatedTimeRemaining || "Expiring"})
                  </span>
                </div>
              </div>

              {/* Extension Preset Buttons */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">
                  Select TTL Extension:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {EXTENSION_PRESETS.map((preset) => {
                    const isSelected = !isCustom && selectedLedgers === preset.ledgers;
                    return (
                      <button
                        key={preset.ledgers}
                        type="button"
                        onClick={() => handlePresetClick(preset.ledgers)}
                        className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "bg-cyan-950/40 border-cyan-500 text-white shadow-sm shadow-cyan-900/30"
                            : "bg-gray-950/60 border-gray-800 text-gray-300 hover:border-gray-700"
                        }`}
                      >
                        <span className="text-xs font-semibold font-mono">
                          {preset.label} ledgers
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {preset.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Ledgers Input */}
              <div>
                <label
                  htmlFor="custom-ledgers-input"
                  className="block text-xs text-gray-400 mb-1"
                >
                  Or Custom Ledger Count:
                </label>
                <input
                  id="custom-ledgers-input"
                  type="text"
                  placeholder="e.g. 75000"
                  value={customLedgers}
                  onChange={handleCustomChange}
                  className={`w-full px-3 py-2 text-xs bg-gray-950 border rounded-lg font-mono outline-none transition-colors ${
                    isCustom
                      ? "border-cyan-500 ring-1 ring-cyan-500 text-white"
                      : "border-gray-800 text-gray-300 focus:border-gray-700"
                  }`}
                />
              </div>

              {/* Countdown & Projection Delta */}
              <div className="p-3 bg-gray-950/80 border border-gray-800 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    Ledger Projection:
                  </span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-gray-400">#{currentLedger.toLocaleString()}</span>
                    <ArrowRight className="w-3 h-3 text-cyan-400" />
                    <span className="text-emerald-400 font-bold">
                      #{newLiveUntil.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>Additional Lifespan:</span>
                  <span className="text-cyan-300 font-medium font-mono">
                    +{effectiveExtension.toLocaleString()} ledgers (~{newDays} days)
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-800/80">
                  <span>Estimated Network Fee:</span>
                  <span className="text-gray-300 font-mono">~0.0000100 XLM</span>
                </div>
              </div>

              {/* Error Banner */}
              {result?.error && (
                <div className="flex items-start gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{result.error}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 py-2 px-4 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInvoke}
                  disabled={isSubmitting || effectiveExtension <= 0}
                  className="flex-1 py-2 px-4 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/30 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Broadcasting...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Invoke Bump TTL</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BumpTtlModal;
