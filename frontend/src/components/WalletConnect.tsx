"use client";

import React from "react";
import { Wallet, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useWallet } from "./providers/WalletProvider";
import WalletModal from "./WalletModal";

export default function WalletConnect() {
  const { status, address, network, activeWallet, openWalletModal } = useWallet();

  const shortAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-6)}`;

  return (
    <>
      <div className="flex flex-col space-y-4 p-5 bg-white/5 border border-white/8 rounded-2xl shadow-xl backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
            <Wallet size={14} className="text-cyan-400" />
            Wallet Status
          </h3>
          {status === "connected" && (
            <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider">
              <CheckCircle2 size={10} />
              Live
            </span>
          )}
        </div>

        {status === "connected" && address ? (
          <div className="space-y-4">
            <div className="bg-slate-950/50 border border-white/5 rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest capitalize">
                  {activeWallet} Account
                </p>
                <p className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
                  {network ?? "TESTNET"}
                </p>
              </div>
              <p className="font-mono text-xs text-slate-200 truncate">
                {shortAddress(address)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={openWalletModal}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-all border border-white/5"
              >
                Switch
              </button>
              <Link
                href="/wallet-management"
                className="group flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold transition-all border border-cyan-500/20"
              >
                Manage
                <ArrowRight
                  size={13}
                  className="transition-transform group-hover:translate-x-1"
                />
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Connect your Stellar wallet to interact with smart contracts on the
              Testnet.
            </p>
            <button
              onClick={openWalletModal}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-[0.98] transition-all"
            >
              <Wallet size={16} />
              Connect Wallet
            </button>
          </div>
        )}
      </div>

      <WalletModal />
    </>
  );
}
