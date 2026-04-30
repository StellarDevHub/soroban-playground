"use client";

import React from 'react';
import { Dashboard } from '../../components/treasury/Dashboard';
import { TransactionList } from '../../components/treasury/TransactionList';
import { ProposalForm } from '../../components/treasury/ProposalForm';
import { Wallet } from 'lucide-react';

export default function TreasuryPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-blue-500/30">
      {/* Dynamic Grid Background */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
      <div className="fixed inset-0 bg-slate-950 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-white/70">
              AutonoDAO Treasury
            </h1>
            <p className="mt-2 text-lg text-slate-400">Manage assets, proposals, and governance seamlessly.</p>
          </div>
          
          <button className="flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-all font-medium text-white backdrop-blur-md">
            <Wallet size={18} />
            Connect Freighter
          </button>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column - TVL and Transaction List */}
          <div className="lg:col-span-2 space-y-8">
            <Dashboard />
            <TransactionList />
          </div>

          {/* Right Column - Proposal Form */}
          <div className="lg:col-span-1">
            <div className="sticky top-8">
              <ProposalForm />
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}
