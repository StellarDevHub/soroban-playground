"use client";

import React, { useEffect } from "react";
import {
  Wallet,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  Layers,
  Radio,
  X,
} from "lucide-react";
import { useWallet, WalletType, WalletAdapter } from "./providers/WalletProvider";

interface WalletModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const getWalletIcon = (iconName: string, size = 20) => {
  switch (iconName) {
    case "freighter":
      return <Wallet className="text-cyan-400" size={size} />;
    case "xbull":
      return <KeyRound className="text-emerald-400" size={size} />;
    case "albedo":
      return <ShieldCheck className="text-purple-400" size={size} />;
    case "hana":
      return <Layers className="text-pink-400" size={size} />;
    case "walletconnect":
      return <Radio className="text-blue-400" size={size} />;
    case "rango":
      return <RefreshCw className="text-amber-400" size={size} />;
    case "soroban-wallet":
      return <Wallet className="text-orange-400" size={size} />;
    default:
      return <Wallet className="text-cyan-400" size={size} />;
  }
};

export default function WalletModal({
  isOpen: propsIsOpen,
  onClose: propsOnClose,
}: WalletModalProps) {
  const {
    connect,
    disconnect,
    activeWallet,
    activeAccount,
    status,
    error,
    isWalletDetected,
    retry,
    lastAttemptedWallet,
    adapters,
    isModalOpen: contextIsOpen,
    closeWalletModal,
  } = useWallet();

  const isOpen = propsIsOpen !== undefined ? propsIsOpen : contextIsOpen;
  const onClose = propsOnClose || closeWalletModal;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#090f1d] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Wallet size={22} />
            </div>
            <div>
              <h2
                id="wallet-modal-title"
                className="text-lg font-bold text-white tracking-wide"
              >
                Connect Stellar Wallet
              </h2>
              <p className="text-xs text-slate-400">
                Choose your preferred wallet to interact with Soroban contracts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-4">
          {status === "connected" && activeAccount && (
            <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Connected with {activeWallet}
                </span>
                <p className="font-mono text-xs text-slate-200 truncate max-w-xs sm:max-w-sm mt-0.5">
                  {activeAccount}
                </p>
              </div>
              <button
                onClick={disconnect}
                className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-all"
              >
                Disconnect
              </button>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs"
              role="alert"
            >
              <AlertCircle className="shrink-0 mt-0.5" size={16} />
              <div className="flex-1">
                <p>{error}</p>
                {lastAttemptedWallet && status === "error" && (
                  <button
                    onClick={retry}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-200 hover:text-rose-100 transition-colors underline"
                  >
                    <RefreshCw size={12} />
                    Retry {lastAttemptedWallet}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            {adapters.map((adapter: WalletAdapter) => {
              const isDetected = isWalletDetected(adapter.id);
              const isActive =
                activeWallet === adapter.id && status === "connected";
              const isConnecting =
                activeWallet === adapter.id && status === "connecting";

              return (
                <div
                  key={adapter.id}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                    isActive
                      ? "bg-cyan-500/10 border-cyan-500/50 ring-1 ring-cyan-500/20"
                      : "bg-white/[0.03] border-white/8 hover:border-white/20 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 ${
                        isActive ? "bg-cyan-500/20" : "bg-white/5"
                      }`}
                    >
                      {getWalletIcon(adapter.iconName, 20)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">
                          {adapter.name}
                        </span>
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-white/5 shrink-0">
                          {adapter.typeBadge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate max-w-[280px] sm:max-w-xs">
                        {adapter.description}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 ml-3">
                    {!isDetected ? (
                      <a
                        href={adapter.installUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
                      >
                        <ExternalLink size={13} />
                        Get
                      </a>
                    ) : (
                      <button
                        onClick={async () => {
                          await connect(adapter.id);
                          if (status !== "error") {
                            onClose();
                          }
                        }}
                        disabled={status === "connecting"}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                          isActive
                            ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 cursor-default"
                            : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110 active:scale-95 shadow-md shadow-cyan-500/20"
                        }`}
                      >
                        {isActive && <CheckCircle2 size={13} />}
                        {isConnecting && (
                          <Loader2 size={13} className="animate-spin" />
                        )}
                        {isActive
                          ? "Connected"
                          : isConnecting
                            ? "Connecting"
                            : "Connect"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-white/8 bg-white/[0.01] flex items-center justify-between text-xs text-slate-400">
          <span>Stellar & Soroban Ecosystem</span>
          <span className="text-[11px] font-mono text-slate-500">SEP-0043 Ready</span>
        </div>
      </div>
    </div>
  );
}
