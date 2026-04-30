"use client";

import React from "react";
import { AlertCircle, ExternalLink, LoaderCircle, Wallet, WifiOff } from "lucide-react";
import { WalletState } from "@/hooks/useFreighterWallet";

interface WalletConnectProps {
  wallet: WalletState;
}

export default function WalletConnect({ wallet }: WalletConnectProps) {
  const { status, address, network, error, connect, disconnect } = wallet;

  return (
    <div className="flex flex-col space-y-3 p-4 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Wallet size={14} className="text-cyan-400" />
          Freighter Wallet
        </h3>
        {network && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/30 border border-cyan-800/50 text-cyan-300 font-medium">
            {network}
          </span>
        )}
      </div>

      {status === "connected" && address ? (
        <div className="space-y-2">
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 mb-0.5 uppercase tracking-wider">
              Connected Address
            </p>
            <p className="font-mono text-xs text-emerald-300 break-all">{address}</p>
          </div>
          <button
            onClick={disconnect}
            className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-700 rounded-lg transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : status === "connecting" ? (
        <div className="flex items-center gap-2 text-xs text-amber-300 py-1">
          <LoaderCircle size={14} className="animate-spin" />
          Connecting to Freighter…
        </div>
      ) : status === "unavailable" ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-rose-300">
            <WifiOff size={14} className="shrink-0 mt-0.5" />
            <span>Freighter extension not detected.</span>
          </div>
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <ExternalLink size={12} />
            Install Freighter
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={connect}
            className="w-full flex items-center justify-center gap-2 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 hover:border-cyan-500/50 text-cyan-300 text-xs font-medium rounded-lg transition-colors"
          >
            <Wallet size={14} />
            Connect Freighter
          </button>
        </div>
      )}
    </div>
  );
}
