"use client";

import React from "react";
import TokenGatedPanel from "@/components/TokenGatedPanel";
import WalletConnect from "@/components/WalletConnect";
import { useFreighterWallet } from "@/hooks/useFreighterWallet";
import { Shield } from "lucide-react";

export default function TokenGatedPage() {
  const wallet = useFreighterWallet();

  return (
    <main className="min-h-screen bg-gray-950 p-6 md:p-12 selection:bg-cyan-500/30">
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Navigation / Top Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl shadow-lg shadow-cyan-500/20">
              <Shield className="text-white" size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-100 tracking-tight">Token Gated Access</h1>
              <p className="text-sm text-gray-500">Secure resource management via Stellar/Soroban</p>
            </div>
          </div>
          
          <div className="md:w-72">
            <WalletConnect wallet={wallet} />
          </div>
        </div>

        {/* Introduction / Welcome */}
        <div className="p-8 md:p-12 bg-gradient-to-r from-cyan-900/20 to-purple-900/20 border border-cyan-500/10 rounded-[2.5rem] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 blur-[100px] -translate-y-1/2 translate-x-1/2 group-hover:bg-cyan-500/10 transition-all duration-1000"></div>
          <div className="relative z-10 space-y-4 max-w-2xl">
            <span className="px-3 py-1 bg-cyan-500/10 text-cyan-400 text-[10px] font-bold rounded-full uppercase tracking-widest border border-cyan-500/20">
              Enterprise Grade Security
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-100 leading-tight">
              Unlock Exclusive Content with <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">On-Chain Assets</span>
            </h2>
            <p className="text-gray-400 leading-relaxed">
              Our Token Gating system leverages Soroban smart contracts to provide cryptographically secure access control. Connect your wallet to automatically verify your holdings and unlock premium features.
            </p>
          </div>
        </div>

        {/* Main Panel */}
        <TokenGatedPanel wallet={wallet} />

        {/* Footer info */}
        <div className="pt-12 border-t border-gray-900 flex flex-col md:flex-row justify-between items-center gap-6 text-xs text-gray-600">
          <p>© 2026 Soroban Playground • Built with Stellar Technology</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gray-400 transition-colors">Documentation</a>
            <a href="#" className="hover:text-gray-400 transition-colors">Security Audit</a>
            <a href="#" className="hover:text-gray-400 transition-colors">Stellar Dev Hub</a>
          </div>
        </div>
      </div>
    </main>
  );
}
