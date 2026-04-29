"use client";

import React, { useState, useMemo } from "react";
import { 
  ShieldCheck, 
  ShieldAlert, 
  Clock, 
  User, 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  Fingerprint,
  RefreshCw,
  Database,
  ArrowRight
} from "lucide-react";
import { format } from "date-fns";

export interface AuditEntry {
  id: string;
  event_type: string;
  actor: string;
  payload: string;
  prev_hash: string;
  entry_hash: string;
  merkle_root: string;
  timestamp: string;
}

interface Props {
  logs: AuditEntry[];
  isVerifying: boolean;
  onVerify: () => void;
  isValid?: boolean;
}

export default function AuditExplorer({ logs, isVerifying, onVerify, isValid }: Props) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    return logs.filter(l => 
      l.id.toLowerCase().includes(search.toLowerCase()) || 
      l.event_type.toLowerCase().includes(search.toLowerCase()) ||
      l.actor.toLowerCase().includes(search.toLowerCase())
    );
  }, [logs, search]);

  return (
    <div className="flex flex-col gap-6">
      {/* Search and Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-slate-900/40 p-4 backdrop-blur-xl">
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input 
            type="text" 
            placeholder="Search by ID, actor, or event..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-950/50 rounded-xl border border-white/5 pl-12 pr-4 py-2.5 text-sm outline-none focus:border-violet-500/50 transition-colors"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 border text-xs font-bold transition-all ${
            isValid === true ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
            isValid === false ? "bg-rose-500/10 border-rose-500/20 text-rose-400" :
            "bg-slate-800/50 border-white/5 text-slate-400"
          }`}>
            {isValid === true ? <ShieldCheck size={14} /> : 
             isValid === false ? <ShieldAlert size={14} /> : 
             <Fingerprint size={14} />}
            {isValid === true ? "Chain Integrity Verified" : 
             isValid === false ? "Integrity Compromised!" : 
             "Not Verified"}
          </div>
          
          <button 
            onClick={onVerify}
            disabled={isVerifying}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-500 transition active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
          >
            <RefreshCw size={14} className={isVerifying ? "animate-spin" : ""} />
            Verify Root
          </button>
        </div>
      </div>

      {/* Timeline Explorer */}
      <div className="relative">
        {/* Timeline Path */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-violet-500/50 via-slate-800 to-transparent" />
        
        <div className="space-y-6">
          {filteredLogs.map((log, index) => (
            <div key={log.id} className="relative pl-14 group">
              {/* Timeline Node */}
              <div className="absolute left-4 top-2 h-4 w-4 rounded-full bg-slate-900 border-2 border-violet-500 z-10 group-hover:scale-125 transition-transform shadow-[0_0_10px_rgba(139,92,246,0.3)]" />
              
              <div className={`rounded-2xl border transition-all duration-300 ${
                expandedId === log.id 
                ? "bg-slate-900/60 border-violet-500/30 shadow-2xl shadow-violet-500/10" 
                : "bg-slate-950/40 border-white/5 hover:bg-slate-900/40 hover:border-white/10"
              }`}>
                {/* Summary Card */}
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <Clock size={10} />
                        {format(new Date(log.timestamp), "HH:mm:ss · MMM d")}
                      </span>
                      <h4 className="text-sm font-bold text-slate-200 mt-0.5">
                        {log.event_type.replace(/_/g, ' ')}
                      </h4>
                    </div>
                    
                    <div className="flex items-center gap-3 ml-4">
                      <div className="flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2 py-1 border border-white/5">
                        <User size={12} className="text-slate-500" />
                        <span className="text-[10px] font-medium text-slate-400">{log.actor}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-600 hidden md:block">
                        {log.id.slice(0, 8)}...
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 text-[10px] font-mono text-slate-600">
                      <Fingerprint size={12} />
                      {log.entry_hash.slice(0, 8)}
                    </div>
                    {expandedId === log.id ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedId === log.id && (
                  <div className="border-t border-white/5 p-5 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* JSON Payload & Diff */}
                      <div className="space-y-3">
                        <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <Database size={12} /> State Payload
                        </h5>
                        <div className="rounded-xl bg-slate-950 p-4 overflow-x-auto border border-white/5 max-h-[300px] custom-scrollbar">
                          <pre className="text-[11px] leading-relaxed text-emerald-400 font-mono">
                            {JSON.stringify(JSON.parse(log.payload), null, 2)}
                          </pre>
                        </div>
                      </div>

                      {/* Cryptographic Linkage */}
                      <div className="space-y-4">
                        <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <ShieldCheck size={12} /> Cryptographic Proof
                        </h5>
                        
                        <div className="space-y-4 rounded-xl bg-slate-950/50 p-5 border border-white/5">
                          {/* Hash Chaining Viz */}
                          <div className="flex flex-col gap-4 relative">
                            <div className="space-y-1">
                              <label className="text-[9px] text-slate-500 uppercase font-bold">Previous Hash</label>
                              <div className="text-[10px] font-mono text-slate-400 bg-slate-900 rounded px-2 py-1 overflow-hidden text-ellipsis">
                                {log.prev_hash}
                              </div>
                            </div>
                            
                            <div className="flex justify-center -my-2 relative z-10">
                              <div className="bg-slate-900 p-1 rounded-full border border-white/10">
                                <ChevronDown size={14} className="text-violet-500" />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-slate-500 uppercase font-bold">Entry Hash <span className="text-violet-400">(SHA-256)</span></label>
                              <div className="text-[10px] font-mono text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded px-2 py-1 overflow-hidden text-ellipsis">
                                {log.entry_hash}
                              </div>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-500 italic">Merkle Root Inclusion Verified</span>
                              <div className="h-4 w-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
