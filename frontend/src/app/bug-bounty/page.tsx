"use client";

import React from 'react';
import Link from 'next/link';
import BountyCard from '@/components/bug-bounty/BountyCard';

export default function BugBountyDashboard() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e5e2e3] font-inter p-6 md:p-12 relative overflow-hidden">
      {/* Abstract Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#0070FF]/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-[#00FFFF]/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto relative z-10">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-12 gap-6">
          <div>
            <h1 className="font-space-grotesk text-4xl md:text-5xl font-bold tracking-tight mb-2 flex items-center gap-4">
              <span className="text-[#0070FF]">CYBER_WATCH</span> 
              <span className="text-[#c2c6d8] text-2xl font-normal">// BOUNTY_HUB</span>
            </h1>
            <p className="text-[#c2c6d8] text-sm tracking-widest uppercase">Decentralized Threat Intelligence</p>
          </div>
          <Link href="/bug-bounty/submit">
            <button className="px-8 py-3 rounded-md bg-[#0070FF] text-white font-bold tracking-widest uppercase text-sm border border-[#568dff] shadow-[0_0_20px_rgba(0,112,255,0.4)] hover:shadow-[0_0_30px_rgba(0,112,255,0.6)] hover:-translate-y-0.5 transition-all">
              Submit New Bug
            </button>
          </Link>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Metrics Cards */}
          <div className="bg-[#1c1b1c]/80 backdrop-blur-xl border border-white/5 rounded-xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#0070FF] to-transparent opacity-50 group-hover:opacity-100 transition-opacity"></div>
            <h3 className="text-[#c2c6d8] text-xs font-semibold tracking-widest uppercase mb-4">Total Bounties Paid</h3>
            <p className="font-space-grotesk text-4xl font-bold text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">$2.4M <span className="text-xl text-[#0070FF]">USDC</span></p>
          </div>
          
          <div className="bg-[#1c1b1c]/80 backdrop-blur-xl border border-white/5 rounded-xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#00FFFF] to-transparent opacity-50 group-hover:opacity-100 transition-opacity"></div>
            <h3 className="text-[#c2c6d8] text-xs font-semibold tracking-widest uppercase mb-4">Active Bugs</h3>
            <p className="font-space-grotesk text-4xl font-bold text-[#00FFFF] drop-shadow-[0_0_15px_rgba(0,255,255,0.3)]">156</p>
          </div>

          <div className="bg-[#1c1b1c]/80 backdrop-blur-xl border border-white/5 rounded-xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#00fbfb] to-transparent opacity-50 group-hover:opacity-100 transition-opacity"></div>
            <h3 className="text-[#c2c6d8] text-xs font-semibold tracking-widest uppercase mb-4">Resolved</h3>
            <p className="font-space-grotesk text-4xl font-bold text-white">1,204</p>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
            <h2 className="font-space-grotesk text-2xl font-semibold tracking-tight">ACTIVE_BUG_BOUNTIES</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00FFFF] animate-pulse"></span>
              <span className="text-[#00FFFF] text-xs tracking-widest uppercase font-semibold">Live Updates</span>
            </div>
          </div>
          
          <div className="flex flex-col gap-4">
            <BountyCard title="Smart Contract Re-entrancy" severity="Critical" reward="50,000 USDC" status="Open" />
            <BountyCard title="Cross-Site Scripting (XSS)" severity="High" reward="12,500 USDC" status="Open" />
            <BountyCard title="Information Disclosure in API" severity="Medium" reward="5,000 USDC" status="Open" />
            <BountyCard title="Rate Limiting Bypass" severity="Low" reward="1,000 USDC" status="Open" />
          </div>
        </section>
      </div>
    </div>
  );
}
