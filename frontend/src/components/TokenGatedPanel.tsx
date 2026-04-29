"use client";

import React, { useState, useEffect } from "react";
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  Unlock, 
  RefreshCcw, 
  Search, 
  Settings, 
  Activity,
  BarChart3,
  ExternalLink
} from "lucide-react";
import { WalletState } from "@/hooks/useFreighterWallet";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";

interface GatedResource {
  resource: string;
  token: string;
  min_balance: number;
}

interface AccessStatus {
  resource: string;
  hasAccess: boolean | null;
  loading: boolean;
}

interface TokenGatedPanelProps {
  wallet: WalletState;
}

// Mock data for analytics
const analyticsData = [
  { time: "00:00", attempts: 120, granted: 85 },
  { time: "04:00", attempts: 80, granted: 50 },
  { time: "08:00", attempts: 250, granted: 180 },
  { time: "12:00", attempts: 450, granted: 320 },
  { time: "16:00", attempts: 380, granted: 290 },
  { time: "20:00", attempts: 210, granted: 160 },
  { time: "23:59", attempts: 150, granted: 110 },
];

export default function TokenGatedPanel({ wallet }: TokenGatedPanelProps) {
  const [rules, setRules] = useState<GatedResource[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [accessStatuses, setAccessStatuses] = useState<Record<string, AccessStatus>>({});
  const [activeTab, setActiveTab] = useState<"explorer" | "admin" | "analytics">("explorer");

  useEffect(() => {
    fetchRules();

    // Setup WebSocket for real-time updates
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "token-gated-progress") {
          if (message.type === "access_checked") {
            // Update local state if the check was for the current user
            if (message.user === wallet.address) {
              setAccessStatuses(prev => ({
                ...prev,
                [message.resource]: { 
                  resource: message.resource, 
                  hasAccess: message.hasAccess, 
                  loading: false 
                }
              }));
            }
          }
        }
      } catch (err) {
        console.error("WS Message Error:", err);
      }
    };

    return () => socket.close();
  }, [wallet.address]);

  const fetchRules = async () => {
    setLoadingRules(true);
    try {
      const response = await fetch("/api/token-gated/rules");
      const result = await response.json();
      if (result.success) {
        setRules(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch rules:", error);
    } finally {
      setLoadingRules(false);
    }
  };

  const checkAccess = async (resource: string) => {
    if (!wallet.address) return;

    setAccessStatuses(prev => ({
      ...prev,
      [resource]: { resource, hasAccess: null, loading: true }
    }));

    try {
      const response = await fetch("/api/token-gated/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: wallet.address, resource })
      });
      const result = await response.json();
      if (result.success) {
        setAccessStatuses(prev => ({
          ...prev,
          [resource]: { resource, hasAccess: result.data.hasAccess, loading: false }
        }));
      }
    } catch (error) {
      console.error("Access check failed:", error);
      setAccessStatuses(prev => ({
        ...prev,
        [resource]: { resource, hasAccess: false, loading: false }
      }));
    }
  };

  return (
    <div className="flex flex-col space-y-6 w-full max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header section with Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-6 bg-gray-900/50 backdrop-blur-md border border-gray-800 rounded-2xl shadow-xl hover:border-cyan-500/30 transition-all group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/10 rounded-xl group-hover:bg-cyan-500/20 transition-colors">
              <ShieldCheck className="text-cyan-400" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">Active Rules</p>
              <h3 className="text-2xl font-bold text-gray-100">{rules.length}</h3>
            </div>
          </div>
        </div>
        <div className="p-6 bg-gray-900/50 backdrop-blur-md border border-gray-800 rounded-2xl shadow-xl hover:border-emerald-500/30 transition-all group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 rounded-xl group-hover:bg-emerald-500/20 transition-colors">
              <Activity className="text-emerald-400" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">Uptime</p>
              <h3 className="text-2xl font-bold text-gray-100">99.9%</h3>
            </div>
          </div>
        </div>
        <div className="p-6 bg-gray-900/50 backdrop-blur-md border border-gray-800 rounded-2xl shadow-xl hover:border-purple-500/30 transition-all group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 rounded-xl group-hover:bg-purple-500/20 transition-colors">
              <BarChart3 className="text-purple-400" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest">Access Denied</p>
              <h3 className="text-2xl font-bold text-gray-100">12%</h3>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col min-h-[600px]">
        {/* Sub-nav */}
        <div className="flex items-center gap-1 p-2 bg-gray-950/50 border-b border-gray-800">
          <button 
            onClick={() => setActiveTab("explorer")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-medium transition-all ${
              activeTab === "explorer" 
              ? "bg-gray-800 text-cyan-400 shadow-inner" 
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-900"
            }`}
          >
            <Search size={18} />
            Explorer
          </button>
          <button 
            onClick={() => setActiveTab("analytics")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-medium transition-all ${
              activeTab === "analytics" 
              ? "bg-gray-800 text-purple-400 shadow-inner" 
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-900"
            }`}
          >
            <BarChart3 size={18} />
            Analytics
          </button>
          <button 
            onClick={() => setActiveTab("admin")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-medium transition-all ${
              activeTab === "admin" 
              ? "bg-gray-800 text-amber-400 shadow-inner" 
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-900"
            }`}
          >
            <Settings size={18} />
            Admin Panel
          </button>
        </div>

        <div className="p-8 flex-1">
          {activeTab === "explorer" && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-100">Gated Resources</h2>
                  <p className="text-sm text-gray-500">Verify your access to premium content on-chain.</p>
                </div>
                <button 
                  onClick={fetchRules}
                  className="p-2 text-gray-400 hover:text-cyan-400 transition-colors"
                >
                  <RefreshCcw size={20} className={loadingRules ? "animate-spin" : ""} />
                </button>
              </div>

              {loadingRules ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
                  <p className="text-gray-500 animate-pulse">Scanning blockchain for gating rules...</p>
                </div>
              ) : rules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-gray-950/50 rounded-3xl border border-dashed border-gray-800">
                  <ShieldAlert className="text-gray-700 mb-4" size={48} />
                  <p className="text-gray-500">No gating rules found in the current contract.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {rules.map((rule) => {
                    const status = accessStatuses[rule.resource];
                    return (
                      <div key={rule.resource} className="p-6 bg-gray-950/50 border border-gray-800 rounded-2xl hover:scale-[1.02] transition-all group">
                        <div className="flex justify-between items-start mb-6">
                          <div className={`p-3 rounded-xl ${status?.hasAccess ? "bg-emerald-500/10" : "bg-rose-500/10"} transition-colors`}>
                            {status?.hasAccess ? <Unlock className="text-emerald-400" size={24} /> : <Lock className="text-rose-400" size={24} />}
                          </div>
                          {status?.hasAccess && (
                            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded uppercase">Granted</span>
                          )}
                        </div>
                        <h4 className="text-lg font-bold text-gray-100 mb-2 truncate uppercase tracking-tight">{rule.resource.replace('_', ' ')}</h4>
                        <div className="space-y-3 mb-6">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Token</span>
                            <span className="text-gray-300 font-mono truncate ml-4 max-w-[120px]">{rule.token}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Min. Balance</span>
                            <span className="text-gray-300">{rule.min_balance} XLM</span>
                          </div>
                        </div>
                        <button 
                          disabled={!wallet.address || status?.loading}
                          onClick={() => checkAccess(rule.resource)}
                          className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            !wallet.address 
                            ? "bg-gray-800 text-gray-500 cursor-not-allowed" 
                            : status?.loading
                            ? "bg-cyan-500/20 text-cyan-400"
                            : status?.hasAccess
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20"
                          }`}
                        >
                          {status?.loading ? (
                            <RefreshCcw size={14} className="animate-spin" />
                          ) : (
                            <ShieldCheck size={14} />
                          )}
                          {!wallet.address ? "Connect Wallet" : status?.loading ? "Verifying..." : status?.hasAccess ? "Access Granted" : "Check Access"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="space-y-8 animate-in fade-in duration-500 h-full">
              <div>
                <h2 className="text-xl font-bold text-gray-100">Live Analytics</h2>
                <p className="text-sm text-gray-500">Real-time tracking of gating attempts and successes.</p>
              </div>

              <div className="bg-gray-950/50 p-6 rounded-3xl border border-gray-800 h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analyticsData}>
                    <defs>
                      <linearGradient id="colorAttempts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorGranted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="time" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "#030712", borderColor: "#1f2937", borderRadius: "12px" }}
                      itemStyle={{ fontSize: "12px" }}
                    />
                    <Area type="monotone" dataKey="attempts" stroke="#22d3ee" fillOpacity={1} fill="url(#colorAttempts)" strokeWidth={3} />
                    <Area type="monotone" dataKey="granted" stroke="#10b981" fillOpacity={1} fill="url(#colorGranted)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === "admin" && (
            <div className="flex flex-col items-center justify-center py-20 animate-in fade-in duration-500">
              <Settings className="text-amber-500/20 mb-6" size={80} />
              <h2 className="text-2xl font-bold text-gray-100 mb-2">Admin Configuration</h2>
              <p className="text-gray-500 text-center max-w-md mb-8">
                Gating rules can only be modified by the contract administrator. Connect as admin to manage resources.
              </p>
              <div className="p-1 px-4 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center gap-2 text-amber-400 text-xs font-medium">
                <ShieldAlert size={14} />
                Requires Administrative Signature
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-4 px-8 bg-gray-950/50 border-t border-gray-800 flex justify-between items-center">
          <div className="flex gap-4 text-[10px] text-gray-600 font-medium uppercase tracking-widest">
            <span>Server: Stellar Testnet</span>
            <span>Latency: 120ms</span>
          </div>
          <a href="#" className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
            View Smart Contract <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}
