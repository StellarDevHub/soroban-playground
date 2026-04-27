"use client";

import React, { useState, useEffect } from "react";
import { History, Search, Download, Filter, ChevronRight, Hash, Calendar, Zap } from "lucide-react";
import Link from "next/link";

interface QuorumHistoryItem {
  id: string;
  quorum_type: string;
  state: string;
  strategy: string;
  votes: number;
  threshold: number;
  created_at: string;
}

export default function QuorumHistoryPage() {
  const [items, setItems] = useState<QuorumHistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Mock fetching data - in production this would call the indexer API
    setTimeout(() => {
      setItems([
        { id: "q-1029", quorum_type: "bridge", state: "consensus_achieved", strategy: "super_majority", votes: 8, threshold: 6, created_at: "2026-04-26T14:30:00Z" },
        { id: "q-1028", quorum_type: "oracle", state: "consensus_achieved", strategy: "simple_majority", votes: 5, threshold: 4, created_at: "2026-04-26T12:00:00Z" },
        { id: "q-1027", quorum_type: "bridge", state: "failed", strategy: "unanimous", votes: 3, threshold: 5, created_at: "2026-04-25T18:45:00Z" },
        { id: "q-1026", quorum_type: "governance", state: "consensus_achieved", strategy: "simple_majority", votes: 12, threshold: 7, created_at: "2026-04-25T09:15:00Z" },
        { id: "q-1025", quorum_type: "bridge", state: "consensus_achieved", strategy: "super_majority", votes: 7, threshold: 6, created_at: "2026-04-24T22:30:00Z" },
      ]);
      setIsLoading(false);
    }, 1000);
  }, []);

  const filtered = items.filter(i => 
    i.id.toLowerCase().includes(search.toLowerCase()) || 
    i.quorum_type.toLowerCase().includes(search.toLowerCase())
  );

  const exportToCSV = () => {
    const headers = "ID,Type,State,Strategy,Votes,Threshold,Date\n";
    const rows = filtered.map(i => `${i.id},${i.quorum_type},${i.state},${i.strategy},${i.votes},${i.threshold},${i.created_at}`).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `quorum-history-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100 selection:bg-violet-500/30">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300 transition">Dashboard</Link>
          <ChevronRight size={10} />
          <span className="text-slate-400">Governance</span>
          <ChevronRight size={10} />
          <span className="text-violet-400 font-medium">Quorum History</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Quorum Audit Log
            </h1>
            <p className="mt-2 text-slate-400 text-sm max-w-xl">
              Audit the lifecycle of past distributed consensus attempts. Track oracle participation, strategies used, and final consensus results.
            </p>
          </div>
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 rounded-full bg-slate-900 border border-white/5 px-5 py-2.5 text-xs font-semibold hover:bg-slate-800 transition active:scale-95"
          >
            <Download size={14} /> Export Audit Data
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Total Quorums", value: "1,284", icon: <Hash className="text-violet-400" />, change: "+12.5%" },
            { label: "Consensus Rate", value: "94.2%", icon: <Zap className="text-emerald-400" />, change: "+2.1%" },
            { label: "Avg Participants", value: "8.4", icon: <History className="text-cyan-400" />, change: "-0.5%" },
          ].map((stat, i) => (
            <div key={i} className="rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded-xl bg-slate-900/50">{stat.icon}</div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${stat.change.startsWith('+') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                  {stat.change}
                </span>
              </div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">{stat.label}</p>
              <h3 className="text-2xl font-bold mt-1">{stat.value}</h3>
            </div>
          ))}
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-4 bg-slate-900/30 p-2 rounded-2xl border border-white/5">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              type="text" 
              placeholder="Search by ID or type..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent pl-12 pr-4 py-3 text-sm outline-none placeholder:text-slate-600"
            />
          </div>
          <button className="p-3 rounded-xl hover:bg-slate-800 text-slate-400 transition">
            <Filter size={18} />
          </button>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/5 bg-slate-950/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-slate-900/30 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                  <th className="px-6 py-4">Consensus ID</th>
                  <th className="px-6 py-4">Domain</th>
                  <th className="px-6 py-4">Strategy</th>
                  <th className="px-6 py-4">Votes</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Date Executed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={6} className="px-6 py-4 h-16 bg-white/5" />
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500 italic">No history matching your search.</td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-white/5 transition-colors group cursor-pointer">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 font-mono text-[10px]">
                            {item.id.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-mono text-xs font-bold text-slate-200">{item.id}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-slate-400 ring-1 ring-inset ring-white/10 uppercase">
                          {item.quorum_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {item.strategy.replace('_', ' ')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-slate-800">
                            <div 
                              className={`h-full rounded-full ${item.state === 'failed' ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                              style={{ width: `${(item.votes / item.threshold) * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-medium text-slate-300">{item.votes}/{item.threshold}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${
                          item.state === 'consensus_achieved' ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          <div className={`h-1 w-1 rounded-full ${item.state === 'consensus_achieved' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                          {item.state.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 text-slate-500 text-xs">
                          <Calendar size={12} />
                          {new Date(item.created_at).toLocaleDateString()}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
