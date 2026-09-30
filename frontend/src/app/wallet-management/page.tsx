"use client";

import React from "react";
import { Wallet, Shield, History, Settings, ArrowLeft } from "lucide-react";
import Link from "next/link";
import WalletConnectionWizard from "@/components/WalletConnectionWizard";
import AccountSwitcher from "@/components/AccountSwitcher";
import { useWallet } from "@/components/providers/WalletProvider";
import AssetBalancesPanel from "@/components/AssetBalancesPanel";

export default function WalletManagementPage() {
  const { status, activeWallet } = useWallet();

  return (
    <div className="min-h-screen bg-[#060c18] text-slate-100 p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Header */}
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/playground"
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-400 transition-colors mb-4"
            >
              <ArrowLeft size={16} />
              Back to Playground
            </Link>
            <h1 className="text-4xl font-bold text-white tracking-tight">
              Wallet Management
            </h1>
            <p className="mt-2 text-slate-400 max-w-2xl">
              Connect, manage, and switch between multiple Stellar wallets.
              Monitor connection status and review account details for your
              Soroban development.
            </p>
          </div>

          <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/5 border border-white/8">
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                status === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-slate-600"
              }`}
            />
            <span className="text-sm font-medium text-slate-300 capitalize">
              {status === "connected" ? `Connected to ${activeWallet}` : status}
            </span>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-8">
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Wallet size={20} />
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Connect Wallets
                </h2>
              </div>
              <WalletConnectionWizard />
            </section>

            <AssetBalancesPanel />

            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <History size={20} />
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Recent Activity
                </h2>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 p-10 flex flex-col items-center justify-center text-center">
                <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center text-slate-600 mb-4">
                  <History size={32} />
                </div>
                <h3 className="text-slate-300 font-medium">
                  No recent transactions
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Your wallet transaction history will appear here once you
                  start invoking contracts.
                </p>
              </div>
            </section>
          </div>

          {/* Sidebar Area */}
          <aside className="space-y-8">
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                  <Shield size={20} />
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Active Account
                </h2>
              </div>
              <AccountSwitcher />
            </section>

            <section className="rounded-2xl border border-white/8 bg-gradient-to-br from-cyan-500/10 to-blue-600/10 p-6 space-y-4">
              <div className="flex items-center gap-2 text-cyan-400">
                <Settings size={18} />
                <h3 className="font-semibold">Wallet Security</h3>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Your private keys are never stored on our servers. All
                transactions are signed locally in your browser through your
                chosen wallet extension.
              </p>
              <div className="pt-2">
                <Link
                  href="/docs/security"
                  className="text-xs font-bold uppercase tracking-widest text-white hover:text-cyan-400 transition-colors"
                >
                  Learn More
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
