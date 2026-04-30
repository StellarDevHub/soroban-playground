"use client";

import React, { useState } from 'react';
import Link from 'next/link';

export default function SubmitBugReport() {
  const [title, setTitle] = useState('');
  const [targetAddress, setTargetAddress] = useState('');
  const [severity, setSeverity] = useState('Medium');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Implementation for submitting the bug report
    console.log({ title, targetAddress, severity, description });
  };

  return (
    <div className="min-h-screen bg-[#131314] text-[#e5e2e3] font-inter p-6 md:p-12 relative overflow-hidden">
      {/* Abstract Background Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#0070FF]/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="max-w-3xl mx-auto relative z-10">
        <Link href="/bug-bounty" className="text-[#c2c6d8] hover:text-[#00FFFF] text-sm tracking-widest uppercase mb-8 inline-block transition-colors">
          ← Back to Dashboard
        </Link>
        
        <header className="mb-10 border-b border-white/10 pb-6">
          <h1 className="font-space-grotesk text-3xl md:text-4xl font-bold tracking-tight mb-2">
            SUBMIT_REPORT <span className="text-[#00FFFF] font-normal">// NEW_VULNERABILITY</span>
          </h1>
          <p className="text-[#c2c6d8] text-sm">Provide detailed information about the vulnerability. All submissions are encrypted and verified on-chain.</p>
        </header>

        <form onSubmit={handleSubmit} className="bg-[#1c1b1c]/80 backdrop-blur-xl border border-white/10 rounded-xl p-8 shadow-2xl">
          
          <div className="mb-6">
            <label className="block text-xs font-bold tracking-widest uppercase text-[#c2c6d8] mb-2">Bug Title</label>
            <input 
              type="text" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Re-entrancy in Staking Contract"
              className="w-full bg-[#0e0e0f]/50 border border-white/10 rounded-md p-4 text-white focus:outline-none focus:border-[#00FFFF] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)] transition-all"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold tracking-widest uppercase text-[#c2c6d8] mb-2">Target Smart Contract Address</label>
            <input 
              type="text" 
              value={targetAddress}
              onChange={(e) => setTargetAddress(e.target.value)}
              placeholder="C... (Soroban Contract ID)"
              className="w-full bg-[#0e0e0f]/50 border border-white/10 rounded-md p-4 text-[#00FFFF] font-space-grotesk tracking-wider focus:outline-none focus:border-[#00FFFF] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)] transition-all"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold tracking-widest uppercase text-[#c2c6d8] mb-2">Severity Level</label>
            <select 
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full bg-[#0e0e0f]/50 border border-white/10 rounded-md p-4 text-white focus:outline-none focus:border-[#00FFFF] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)] transition-all appearance-none cursor-pointer"
            >
              <option value="Critical">Critical (System compromise / Fund loss)</option>
              <option value="High">High (Significant impact)</option>
              <option value="Medium">Medium (Moderate impact)</option>
              <option value="Low">Low (Minor issue / Best practice)</option>
            </select>
          </div>

          <div className="mb-8">
            <div className="flex justify-between items-end mb-2">
              <label className="block text-xs font-bold tracking-widest uppercase text-[#c2c6d8]">Description & Proof of Concept</label>
              <span className="text-xs text-[#00FFFF] bg-[#00FFFF]/10 px-2 py-1 rounded">Markdown Supported</span>
            </div>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide a detailed description of the vulnerability, steps to reproduce, and the potential impact..."
              rows={8}
              className="w-full bg-[#0e0e0f]/50 border border-white/10 rounded-md p-4 text-white font-inter leading-relaxed focus:outline-none focus:border-[#00FFFF] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)] transition-all resize-y"
              required
            ></textarea>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-6 border-t border-white/10">
            <button type="button" className="w-full md:w-auto px-6 py-3 rounded-md bg-transparent text-[#c2c6d8] border border-white/20 hover:border-[#00FFFF] hover:text-[#00FFFF] transition-all flex items-center justify-center gap-2 text-sm font-semibold tracking-wider uppercase">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload Evidence
            </button>
            
            <button type="submit" className="w-full md:w-auto px-8 py-3 rounded-md bg-[#0070FF] text-white font-bold tracking-widest uppercase text-sm border border-[#568dff] shadow-[0_0_20px_rgba(0,112,255,0.4)] hover:shadow-[0_0_30px_rgba(0,112,255,0.6)] hover:-translate-y-0.5 transition-all">
              Submit Bug Report
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
