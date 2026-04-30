"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, ChevronRight, Activity } from "lucide-react";
import TokenGatedAccessPanel from "@/components/TokenGatedAccessPanel";

export default function TokenGatedAccessPage() {
  const [apiBase, setApiBase] = useState("http://localhost:5000");

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_API_URL) {
      setApiBase(process.env.NEXT_PUBLIC_API_URL);
    }
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100 selection:bg-violet-500/30">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300 transition">
            Dashboard
          </Link>
          <ChevronRight size={10} aria-hidden="true" />
          <span className="text-slate-400">Access Control</span>
          <ChevronRight size={10} aria-hidden="true" />
          <span className="text-violet-400 font-medium">Token-Gated Access</span>
        </nav>

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div
                className="p-2.5 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400"
                aria-hidden="true"
              >
                <Shield size={24} />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">
                Token-Gated Access Control
              </h1>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl">
              Issue membership NFTs (Basic / Premium / Elite) to gate access to
              community resources. Manage memberships and view real-time
              analytics — all backed by a Soroban smart contract on Stellar
              Testnet.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Contract Status
              </span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium mt-1">
                <Activity size={10} className="animate-pulse" aria-hidden="true" />
                Active on Testnet
              </span>
            </div>
          </div>
        </header>

        {/* Panel */}
        <TokenGatedAccessPanel apiBase={apiBase} />
      </div>
    </main>
  );
}
