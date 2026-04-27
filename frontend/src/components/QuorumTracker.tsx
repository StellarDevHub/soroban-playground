"use client";

import React, { useMemo } from "react";
import { Vote, Shield, CheckCircle2, XCircle, Clock, AlertCircle, TrendingUp } from "lucide-react";

export type QuorumState = "collecting" | "threshold_reached" | "consensus_achieved" | "failed";

export interface Quorum {
  id: string;
  quorum_type: string;
  state: QuorumState;
  strategy: string;
  threshold: number;
  target_id?: string;
  created_at: string;
  expires_at: string;
}

export interface OracleVote {
  oracle_id: string;
  oracle_name: string;
  choice: string;
  timestamp: string;
}

interface Props {
  quorum: Quorum;
  votes: OracleVote[];
  totalOracles: number;
}

const STATE_CONFIG: Record<QuorumState, { color: string; label: string; icon: React.ReactNode }> = {
  collecting: { 
    color: "text-amber-400", 
    label: "Collecting Votes", 
    icon: <Clock className="animate-pulse" size={14} /> 
  },
  threshold_reached: { 
    color: "text-cyan-400", 
    label: "Threshold Reached", 
    icon: <TrendingUp size={14} /> 
  },
  consensus_achieved: { 
    color: "text-emerald-400", 
    label: "Consensus Achieved", 
    icon: <CheckCircle2 size={14} /> 
  },
  failed: { 
    color: "text-rose-400", 
    label: "Consensus Failed", 
    icon: <XCircle size={14} /> 
  },
};

export default function QuorumTracker({ quorum, votes, totalOracles }: Props) {
  const { color, label, icon } = STATE_CONFIG[quorum.state];
  
  const progress = Math.min(100, (votes.length / quorum.threshold) * 100);
  const consensusProgress = Math.min(100, (votes.length / totalOracles) * 100);

  // Group votes by choice
  const voteStats = useMemo(() => {
    const counts: Record<string, number> = {};
    votes.forEach(v => {
      counts[v.choice] = (counts[v.choice] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [votes]);

  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-5 backdrop-blur-xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={18} className="text-violet-400" />
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              {quorum.quorum_type} Quorum
            </h3>
          </div>
          <p className="text-[10px] font-mono text-slate-500">ID: {quorum.id}</p>
        </div>
        <div className={`flex items-center gap-1.5 rounded-full bg-slate-900/50 px-3 py-1 text-[10px] font-bold border border-white/5 ${color}`}>
          {icon}
          {label}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Column: Metrics */}
        <div className="space-y-6">
          {/* Participation Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] font-medium">
              <span className="text-slate-400">Oracle Participation</span>
              <span className="text-slate-200">{votes.length} / {totalOracles}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/50">
              <div 
                className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-400 transition-all duration-1000 ease-out" 
                style={{ width: `${consensusProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-slate-500">
              <span>Threshold: {quorum.threshold}</span>
              <span>{Math.round(consensusProgress)}% Active</span>
            </div>
          </div>

          {/* Consensus Distribution */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Consensus Distribution</h4>
            <div className="space-y-2">
              {voteStats.length === 0 ? (
                <div className="flex items-center gap-2 py-4 justify-center text-slate-600 italic text-xs">
                  <AlertCircle size={12} />
                  Waiting for first oracle...
                </div>
              ) : (
                voteStats.map(([choice, count]) => {
                  const pct = (count / votes.length) * 100;
                  return (
                    <div key={choice} className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-300 font-medium">{choice}</span>
                        <span className="text-slate-400">{count} votes ({Math.round(pct)}%)</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/30">
                        <div 
                          className="h-full rounded-full bg-violet-400/60" 
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Vote Timeline */}
        <div className="rounded-xl border border-white/5 bg-slate-900/30 p-4">
          <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Vote size={12} /> Recent Activity
          </h4>
          <div className="space-y-4 max-h-[180px] overflow-y-auto pr-2 custom-scrollbar">
            {votes.length === 0 ? (
              <p className="text-center text-[10px] text-slate-600 py-8">No activity yet.</p>
            ) : (
              votes.map((vote, idx) => (
                <div key={idx} className="relative pl-4 border-l border-white/10 last:border-0 pb-4 last:pb-0">
                  <div className="absolute -left-1.5 top-0 h-3 w-3 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center">
                    <div className="h-1 w-1 rounded-full bg-violet-400" />
                  </div>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] font-bold text-slate-200">{vote.oracle_name}</p>
                      <p className="text-[9px] text-slate-500">Oracle ID: {vote.oracle_id.slice(0, 8)}...</p>
                    </div>
                    <span className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[8px] font-bold text-violet-300 border border-violet-400/20 uppercase">
                      {vote.choice}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-4 text-[9px] text-slate-500 italic">
        <span>Strategy: <span className="text-slate-300 font-medium">{quorum.strategy.replace('_', ' ')}</span></span>
        <span>Expires: <span className="text-slate-300 font-medium">{new Date(quorum.expires_at).toLocaleString()}</span></span>
        <span className="ml-auto">Target: <span className="text-slate-300 font-mono">{quorum.target_id || "None"}</span></span>
      </div>
    </div>
  );
}
