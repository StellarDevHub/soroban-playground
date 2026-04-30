"use client";

import React from 'react';
import Link from 'next/link';

export default function MusicLicensingDashboard() {
  return (
    <div className="min-h-screen bg-[#0A0A10] text-[#efddeb] font-inter p-6 md:p-12 relative overflow-hidden">
      {/* Abstract Background Glows */}
      <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] bg-[#D946EF]/20 rounded-full blur-[150px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#06B6D4]/15 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto relative z-10 pb-32">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-center justify-between mb-12 gap-6">
          <div className="flex items-center gap-4">
            <h1 className="font-epilogue text-4xl font-extrabold tracking-tighter">SOUND_CHAIN</h1>
            <span className="bg-[#06B6D4]/10 text-[#06B6D4] text-xs font-bold px-2 py-1 rounded tracking-widest uppercase">Beta</span>
          </div>
          <div className="flex-1 max-w-md mx-6 hidden md:block">
            <input 
              type="text" 
              placeholder="Search tracks, artists, genres..." 
              className="w-full bg-[#12121A] border border-white/10 rounded-full py-2 px-6 text-sm text-white focus:outline-none focus:border-[#06B6D4] transition-colors"
            />
          </div>
          <div className="flex items-center gap-4">
            <Link href="/music-licensing/upload">
              <button className="px-6 py-2 rounded-full bg-[#12121A] text-[#efddeb] border border-white/20 hover:border-[#D946EF] hover:text-[#D946EF] transition-all font-inter text-sm font-semibold tracking-wider uppercase">
                Mint License
              </button>
            </Link>
            <button className="px-6 py-2 rounded-full bg-[#D946EF] text-white font-bold tracking-widest uppercase text-sm shadow-[0_0_20px_rgba(217,70,239,0.4)] hover:shadow-[0_0_30px_rgba(217,70,239,0.6)] hover:-translate-y-0.5 transition-all">
              Connect Wallet
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="flex items-center gap-8 mb-12 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-[#d6c0d3] mb-1">Total Volume</p>
            <p className="font-epilogue text-2xl font-bold text-[#06B6D4]">1.2M USDC</p>
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-[#d6c0d3] mb-1">Active Tracks</p>
            <p className="font-epilogue text-2xl font-bold text-[#06B6D4]">4,204</p>
          </div>
        </div>

        {/* Trending Licenses */}
        <section className="mb-16">
          <h2 className="font-epilogue text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[#D946EF] animate-pulse"></span>
            Trending Licenses
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Trending Card 1 */}
            <div className="bg-[#12121A]/70 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col group hover:bg-[#12121A] transition-all">
              <div className="w-full h-48 bg-gradient-to-br from-[#D946EF]/40 to-[#06B6D4]/40 rounded-xl mb-4 relative overflow-hidden">
                 <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                   <button className="w-12 h-12 rounded-full bg-[#D946EF] flex items-center justify-center shadow-[0_0_20px_rgba(217,70,239,0.5)]">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                   </button>
                 </div>
              </div>
              <h3 className="font-epilogue text-xl font-bold text-white mb-1">Neon Genesis</h3>
              <p className="text-[#d6c0d3] text-sm mb-4">Cyber_Punk_99</p>
              <div className="mt-auto flex items-center justify-between">
                <span className="bg-[#D946EF]/20 text-[#D946EF] text-xs font-bold px-2 py-1 rounded">Exclusive</span>
                <button className="px-4 py-2 rounded-md bg-[#D946EF] text-white text-sm font-bold shadow-[0_0_15px_rgba(217,70,239,0.4)] hover:shadow-[0_0_25px_rgba(217,70,239,0.6)] transition-shadow">
                  250 USDC
                </button>
              </div>
            </div>
            
            {/* Trending Card 2 */}
            <div className="bg-[#12121A]/70 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col group hover:bg-[#12121A] transition-all">
              <div className="w-full h-48 bg-gradient-to-br from-[#06B6D4]/40 to-[#fbabff]/40 rounded-xl mb-4 relative overflow-hidden">
                 <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                   <button className="w-12 h-12 rounded-full bg-[#D946EF] flex items-center justify-center shadow-[0_0_20px_rgba(217,70,239,0.5)]">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                   </button>
                 </div>
              </div>
              <h3 className="font-epilogue text-xl font-bold text-white mb-1">Midnight Drive</h3>
              <p className="text-[#d6c0d3] text-sm mb-4">Synth_Wave_Collective</p>
              <div className="mt-auto flex items-center justify-between">
                <span className="bg-[#06B6D4]/20 text-[#06B6D4] text-xs font-bold px-2 py-1 rounded">Non-Exclusive</span>
                <button className="px-4 py-2 rounded-md bg-[#D946EF] text-white text-sm font-bold shadow-[0_0_15px_rgba(217,70,239,0.4)] hover:shadow-[0_0_25px_rgba(217,70,239,0.6)] transition-shadow">
                  50 USDC
                </button>
              </div>
            </div>

            {/* Trending Card 3 */}
            <div className="bg-[#12121A]/70 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col group hover:bg-[#12121A] transition-all">
              <div className="w-full h-48 bg-gradient-to-br from-[#fbabff]/40 to-[#D946EF]/40 rounded-xl mb-4 relative overflow-hidden">
                 <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                   <button className="w-12 h-12 rounded-full bg-[#D946EF] flex items-center justify-center shadow-[0_0_20px_rgba(217,70,239,0.5)]">
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                   </button>
                 </div>
              </div>
              <h3 className="font-epilogue text-xl font-bold text-white mb-1">Quantum Flow</h3>
              <p className="text-[#d6c0d3] text-sm mb-4">AI_Generated_001</p>
              <div className="mt-auto flex items-center justify-between">
                <span className="bg-[#06B6D4]/20 text-[#06B6D4] text-xs font-bold px-2 py-1 rounded">Non-Exclusive</span>
                <button className="px-4 py-2 rounded-md bg-[#D946EF] text-white text-sm font-bold shadow-[0_0_15px_rgba(217,70,239,0.4)] hover:shadow-[0_0_25px_rgba(217,70,239,0.6)] transition-shadow">
                  25 USDC
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Recent Drops List */}
        <section>
          <h2 className="font-epilogue text-2xl font-bold mb-6">Recent Drops</h2>
          <div className="flex flex-col gap-4">
            {/* List Item 1 */}
            <div className="flex items-center justify-between bg-[#12121A]/50 backdrop-blur-md border border-white/5 rounded-xl p-4 hover:bg-[#12121A] transition-colors group">
              <div className="flex items-center gap-4">
                <button className="w-10 h-10 rounded-full bg-[#D946EF]/20 text-[#D946EF] flex items-center justify-center group-hover:bg-[#D946EF] group-hover:text-white transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <div>
                  <h4 className="font-bold text-white">Digital Pulse</h4>
                  <p className="text-sm text-[#d6c0d3]">Cyber_Punk_99 • 128 BPM • Techno</p>
                </div>
              </div>
              <button className="px-4 py-2 rounded-full border border-[#D946EF] text-[#D946EF] text-sm font-bold hover:bg-[#D946EF] hover:text-white transition-all">
                License: 50 USDC
              </button>
            </div>

            {/* List Item 2 */}
            <div className="flex items-center justify-between bg-[#12121A]/50 backdrop-blur-md border border-white/5 rounded-xl p-4 hover:bg-[#12121A] transition-colors group">
              <div className="flex items-center gap-4">
                <button className="w-10 h-10 rounded-full bg-[#D946EF]/20 text-[#D946EF] flex items-center justify-center group-hover:bg-[#D946EF] group-hover:text-white transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <div>
                  <h4 className="font-bold text-white">Bassline Theory</h4>
                  <p className="text-sm text-[#d6c0d3]">Producer_X • 140 BPM • Dubstep</p>
                </div>
              </div>
              <button className="px-4 py-2 rounded-full border border-[#D946EF] text-[#D946EF] text-sm font-bold hover:bg-[#D946EF] hover:text-white transition-all">
                License: 30 USDC
              </button>
            </div>
          </div>
        </section>

      </div>

      {/* Floating Music Player */}
      <div className="fixed bottom-0 left-0 w-full bg-[#1a101a]/90 backdrop-blur-xl border-t border-white/10 p-4 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-4 w-1/4">
            <div className="w-12 h-12 bg-gradient-to-br from-[#D946EF] to-[#06B6D4] rounded-md"></div>
            <div className="hidden md:block">
              <h4 className="font-bold text-white text-sm">Neon Genesis</h4>
              <p className="text-xs text-[#d6c0d3]">Cyber_Punk_99</p>
            </div>
          </div>
          
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="flex items-center gap-4">
              <button className="text-[#d6c0d3] hover:text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg></button>
              <button className="w-10 h-10 rounded-full bg-white text-[#0A0A10] flex items-center justify-center hover:scale-105 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
              </button>
              <button className="text-[#d6c0d3] hover:text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg></button>
            </div>
            <div className="w-full flex items-center gap-3 max-w-md">
              <span className="text-xs text-[#d6c0d3]">1:24</span>
              <div className="flex-1 h-1 bg-white/10 rounded-full relative">
                <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#D946EF] to-[#06B6D4] rounded-full" style={{width: '45%'}}></div>
              </div>
              <span className="text-xs text-[#d6c0d3]">3:42</span>
            </div>
          </div>

          <div className="w-1/4 flex justify-end">
            <div className="flex items-center gap-2 w-24">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d6c0d3" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
              <div className="flex-1 h-1 bg-white/10 rounded-full relative">
                <div className="absolute top-0 left-0 h-full bg-[#06B6D4] rounded-full" style={{width: '70%'}}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
