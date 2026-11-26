"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  X,
  RefreshCw,
  Cpu,
  GitCommit,
  Sliders,
  Hash,
  Terminal,
  AlertTriangle,
} from "lucide-react";
import {
  fetchContractVerification,
  reverifyContract,
  VerificationAttestation,
  VerificationStatus,
} from "@/services/contractVerificationService";

export interface VerificationBadgeProps {
  contractId: string;
  network?: string;
  initialAttestation?: VerificationAttestation;
  size?: "sm" | "md" | "lg";
  showDetailsButton?: boolean;
  className?: string;
  onVerificationChange?: (attestation: VerificationAttestation) => void;
}

export default function VerificationBadge({
  contractId,
  network = "testnet",
  initialAttestation,
  size = "md",
  showDetailsButton = true,
  className = "",
  onVerificationChange,
}: VerificationBadgeProps) {
  const [attestation, setAttestation] = useState<VerificationAttestation | null>(
    initialAttestation || null
  );
  const [isLoading, setIsLoading] = useState(!initialAttestation);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isReverifying, setIsReverifying] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadVerification = useCallback(
    async (refresh = false) => {
      if (!contractId) return;
      if (refresh) {
        setIsReverifying(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result = refresh
          ? await reverifyContract(contractId, network)
          : await fetchContractVerification(contractId, network);

        setAttestation(result);
        onVerificationChange?.(result);
      } catch {
        const fallback: VerificationAttestation = {
          contractId,
          status: "unverified",
          verified: false,
          errorMessage: "Failed to connect to verification API",
        };
        setAttestation(fallback);
        onVerificationChange?.(fallback);
      } finally {
        setIsLoading(false);
        setIsReverifying(false);
      }
    },
    [contractId, network, onVerificationChange]
  );

  useEffect(() => {
    if (initialAttestation) {
      setAttestation(initialAttestation);
      setIsLoading(false);
    } else {
      loadVerification(false);
    }
  }, [contractId, initialAttestation, loadVerification]);

  // Handle escape key to close drawer
  useEffect(() => {
    if (!isDrawerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen]);

  const copyToClipboard = (text: string, key: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const status: VerificationStatus = attestation?.status || "unverified";

  // Size variant mappings
  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5",
    lg: "px-3.5 py-1.5 text-sm gap-2",
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  };

  const currentIconSize = iconSizes[size];

  // Render badge style based on verified / unverified / mismatch
  let badgeStyle = "bg-amber-500/10 border-amber-500/20 text-amber-300 hover:bg-amber-500/20";
  let badgeLabel = "Unverified Contract";
  let badgeIcon = <HelpCircle size={currentIconSize} className="text-amber-400" />;

  if (isLoading) {
    badgeStyle = "bg-slate-800/60 border-slate-700/50 text-slate-400";
    badgeLabel = "Verifying Bytecode...";
    badgeIcon = <Loader2 size={currentIconSize} className="animate-spin text-slate-400" />;
  } else if (status === "verified") {
    // Only cryptographically matching builds get the green checkmark
    badgeStyle = "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 shadow-sm shadow-emerald-500/5";
    badgeLabel = "Bytecode Verified";
    badgeIcon = <ShieldCheck size={currentIconSize} className="text-emerald-400" />;
  } else if (status === "mismatch") {
    badgeStyle = "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 shadow-sm shadow-rose-500/5";
    badgeLabel = "Bytecode Mismatch";
    badgeIcon = <ShieldAlert size={currentIconSize} className="text-rose-400" />;
  }

  const build = attestation?.buildDetails;
  const isMatch =
    build &&
    build.compiledWasmHash &&
    build.onChainWasmHash &&
    build.compiledWasmHash.toLowerCase() === build.onChainWasmHash.toLowerCase();

  return (
    <>
      {/* Interactive Badge Button */}
      <button
        type="button"
        data-testid={isLoading ? "verification-badge-loading" : `verification-badge-${status}`}
        aria-label={`Contract verification status: ${badgeLabel}`}
        title={`Click to open Reproducible Build Inspector (${badgeLabel})`}
        onClick={() => setIsDrawerOpen(true)}
        className={`inline-flex items-center rounded-xl border font-semibold transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-violet-500/50 cursor-pointer ${sizeClasses[size]} ${badgeStyle} ${className}`}
      >
        {badgeIcon}
        <span>{badgeLabel}</span>
        {showDetailsButton && !isLoading && (
          <span className="opacity-60 hover:opacity-100 text-[10px] ml-0.5">▾</span>
        )}
      </button>

      {/* Reproducible Build Inspector Drawer */}
      {isDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="build-inspector-title"
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsDrawerOpen(false);
          }}
        >
          <div
            ref={drawerRef}
            className="relative w-full max-w-xl h-full bg-slate-950 border-l border-white/10 shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg border ${
                      status === "verified"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : status === "mismatch"
                        ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    }`}
                  >
                    {status === "verified" ? (
                      <ShieldCheck size={20} />
                    ) : status === "mismatch" ? (
                      <ShieldAlert size={20} />
                    ) : (
                      <HelpCircle size={20} />
                    )}
                  </div>
                  <h2
                    id="build-inspector-title"
                    className="text-lg font-bold text-white tracking-tight"
                  >
                    Reproducible Build Inspector
                  </h2>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  Contract: {contractId}
                </p>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                data-testid="close-build-inspector"
                aria-label="Close reproducible build inspector"
                onClick={() => setIsDrawerOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="p-6 space-y-6 flex-1">
              {/* Cryptographic Attestation Status Banner */}
              <div
                data-testid="attestation-status-banner"
                className={`p-4 rounded-2xl border ${
                  status === "verified"
                    ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-200"
                    : status === "mismatch"
                    ? "bg-rose-500/5 border-rose-500/20 text-rose-200"
                    : "bg-amber-500/5 border-amber-500/20 text-amber-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {status === "verified" ? (
                      <Check className="text-emerald-400" size={18} />
                    ) : status === "mismatch" ? (
                      <AlertTriangle className="text-rose-400" size={18} />
                    ) : (
                      <HelpCircle className="text-amber-400" size={18} />
                    )}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold">
                      {status === "verified"
                        ? "Cryptographic Build Attestation Verified"
                        : status === "mismatch"
                        ? "Cryptographic Bytecode Mismatch Detected"
                        : "Unverified Contract Artifact"}
                    </h3>
                    <p className="text-xs opacity-80 leading-relaxed">
                      {status === "verified"
                        ? "The on-chain WASM bytecode matches the compiled source artifact bit-for-bit using reproducible compiler toolchains."
                        : status === "mismatch"
                        ? "Security Warning: The on-chain deployed WASM hash does not match the source compilation output. This contract bytecode is altered or unverified."
                        : "No reproducible build attestation exists for this contract. Verify source code before executing high-value transactions."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Build Specification Grid */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu size={14} className="text-violet-400" />
                  Build Environment & Toolchain
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Compiler Version */}
                  <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3.5 space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                      <Terminal size={10} /> Compiler Version
                    </div>
                    <div
                      data-testid="compiler-version"
                      className="text-xs font-mono font-medium text-slate-200"
                    >
                      {build?.compilerVersion || "Not Attested"}
                    </div>
                  </div>

                  {/* Optimization Level */}
                  <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3.5 space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                      <Sliders size={10} /> Optimization Level
                    </div>
                    <div
                      data-testid="optimization-level"
                      className="text-xs font-mono font-medium text-slate-200"
                    >
                      {build?.optimizationLevel || "Not Attested"}
                    </div>
                  </div>
                </div>

                {/* Source Commit SHA */}
                <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                      <GitCommit size={10} /> Source Commit SHA
                    </div>
                    {build?.commitSha && (
                      <button
                        type="button"
                        aria-label="Copy commit SHA"
                        onClick={() => copyToClipboard(build.commitSha, "commit")}
                        className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedKey === "commit" ? (
                          <>
                            <Check size={10} className="text-emerald-400" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={10} /> Copy
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  <div
                    data-testid="source-commit-sha"
                    className="text-xs font-mono text-violet-300 break-all select-all bg-slate-950/70 p-2 rounded-lg border border-white/5"
                  >
                    {build?.commitSha || "No Git Commit Attached"}
                  </div>
                </div>
              </div>

              {/* Bytecode Hash Comparison */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash size={14} className="text-violet-400" />
                  Bytecode Hash Verification (SHA-256)
                </h3>

                <div className="space-y-3 rounded-2xl bg-slate-900/40 border border-white/5 p-4">
                  {/* Compiled WASM Hash */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-slate-400">
                        Submitted Compiled WASM Hash
                      </span>
                      {build?.compiledWasmHash && (
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(build.compiledWasmHash, "compiled")
                          }
                          className="text-slate-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedKey === "compiled" ? (
                            <Check size={10} className="text-emerald-400" />
                          ) : (
                            <Copy size={10} />
                          )}
                        </button>
                      )}
                    </div>
                    <div
                      data-testid="compiled-wasm-hash"
                      className="font-mono text-[11px] text-slate-300 bg-slate-950 p-2 rounded-lg border border-white/5 break-all select-all"
                    >
                      {build?.compiledWasmHash || "No compiled artifact hash"}
                    </div>
                  </div>

                  {/* On-Chain Deployed WASM Hash */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-slate-400">
                        On-Chain Deployed WASM Hash
                      </span>
                      {build?.onChainWasmHash && (
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(build.onChainWasmHash, "onchain")
                          }
                          className="text-slate-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedKey === "onchain" ? (
                            <Check size={10} className="text-emerald-400" />
                          ) : (
                            <Copy size={10} />
                          )}
                        </button>
                      )}
                    </div>
                    <div
                      data-testid="onchain-wasm-hash"
                      className={`font-mono text-[11px] p-2 rounded-lg border break-all select-all ${
                        isMatch
                          ? "bg-emerald-950/20 text-emerald-300 border-emerald-500/20"
                          : "bg-rose-950/20 text-rose-300 border-rose-500/20"
                      }`}
                    >
                      {build?.onChainWasmHash || "No on-chain bytecode fetched"}
                    </div>
                  </div>

                  {/* Match status */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">
                      Cryptographic Match:
                    </span>
                    <span
                      data-testid="match-indicator"
                      className={`font-bold flex items-center gap-1.5 ${
                        isMatch ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {isMatch ? (
                        <>
                          <Check size={14} /> Bit-for-bit Identical
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={14} /> Mismatch / Unverified
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-white/10 bg-slate-900/60 flex items-center justify-between gap-3">
              <button
                type="button"
                data-testid="reverify-button"
                disabled={isReverifying}
                onClick={() => loadVerification(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={isReverifying ? "animate-spin" : ""}
                />
                {isReverifying ? "Re-verifying..." : "Re-verify On-Chain"}
              </button>

              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="px-4 py-2 rounded-xl border border-white/10 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
