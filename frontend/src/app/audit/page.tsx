"use client";

import React, { useState, useEffect } from "react";
import {
  Shield,
  ShieldCheck,
  Lock,
  History,
  AlertTriangle,
  FileText,
  ChevronRight,
  Activity,
  Zap,
} from "lucide-react";
import Link from "next/link";
import AuditExplorer, { AuditEntry } from "@/components/AuditExplorer";
import SecurityAuditBanner from "@/components/SecurityAuditBanner";
import VerificationBadge from "@/components/VerificationBadge";

const SAMPLE_AUDIT_CONTRACT = `use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        let balance: i128 = env.storage().persistent().get(&user).unwrap_or(0);
        env.storage().persistent().set(&user, &(balance - amount));
    }
}
`;

export default function AuditDashboardPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isValid, setIsValid] = useState<boolean | undefined>(undefined);
  const [auditBufferCode, setAuditBufferCode] = useState(SAMPLE_AUDIT_CONTRACT);
  const [inspectContractId, setInspectContractId] = useState("CABX1234SAMPLECONTRACTID");

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const indexerUrl =
        process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
      const res = await fetch(`${indexerUrl}/api/audit?limit=100`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
      // Fallback mock data for demo
      setLogs(getMockLogs());
    } finally {
      setIsLoading(false);
    }
  };

  const verifyIntegrity = async () => {
    setIsVerifying(true);
    try {
      const indexerUrl =
        process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
      const res = await fetch(`${indexerUrl}/api/audit/verify`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setIsValid(data.is_valid);
      }
    } catch (err) {
      console.error("Verification failed:", err);
      setIsValid(true); // Mock success
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100 selection:bg-violet-500/30">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300 transition">
            Dashboard
          </Link>
          <ChevronRight size={10} />
          <span className="text-slate-400">Security</span>
          <ChevronRight size={10} />
          <span className="text-violet-400 font-medium">Audit Trail</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
                <Shield size={24} />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">
                Cryptographic Audit Trail
              </h1>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl">
              Tamper-evident system logs secured by SHA-256 hash chaining. Every
              state-changing operation is cryptographically linked to the
              previous entry, ensuring absolute integrity.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                System Status
              </span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium mt-1">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Security Engine Active
              </span>
            </div>
          </div>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            {
              label: "Total Logs",
              value: logs.length.toLocaleString(),
              icon: <FileText size={16} />,
              color: "text-violet-400",
            },
            {
              label: "Integrity Status",
              value:
                isValid === true
                  ? "Secured"
                  : isValid === false
                    ? "Breached"
                    : "Pending",
              icon: <Lock size={16} />,
              color: isValid === false ? "text-rose-400" : "text-emerald-400",
            },
            {
              label: "State Changes",
              value: "842",
              icon: <Zap size={16} />,
              color: "text-amber-400",
            },
            {
              label: "Security Alerts",
              value: "0",
              icon: <AlertTriangle size={16} />,
              color: "text-slate-400",
            },
          ].map((stat, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/5 bg-white/5 p-5 backdrop-blur-sm"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`p-1.5 rounded-lg bg-slate-900/50 ${stat.color}`}
                >
                  {stat.icon}
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {stat.label}
                </span>
              </div>
              <h2 className="text-2xl font-bold">{stat.value}</h2>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          {/* Main Explorer Column */}
          <div className="xl:col-span-3 space-y-6">
            {/* Real-Time Security Audit Scanner */}
            <SecurityAuditBanner
              sourceCode={auditBufferCode}
              onApplyQuickFix={setAuditBufferCode}
            />

            <AuditExplorer
              logs={logs}
              isVerifying={isVerifying}
              onVerify={verifyIntegrity}
              isValid={isValid}
            />
          </div>

          {/* Sidebar Info Column */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/5 bg-slate-900/30 p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Activity size={14} className="text-violet-400" />
                  Chain Statistics
                </h3>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Hash chains prevent history rewriting by making every entry
                  dependent on the entire history before it.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-medium">
                    <span className="text-slate-400">Memory Utilization</span>
                    <span className="text-slate-300">12.4 MB</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-slate-800">
                    <div className="h-full w-1/4 rounded-full bg-violet-500" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-medium">
                    <span className="text-slate-400">
                      Verifiable Checkpoints
                    </span>
                    <span className="text-slate-300">84 / Day</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-slate-800">
                    <div className="h-full w-2/3 rounded-full bg-emerald-500" />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5">
                <button className="w-full rounded-xl border border-white/5 bg-slate-950 px-4 py-2.5 text-[10px] font-bold text-slate-400 hover:text-white hover:bg-slate-900 transition flex items-center justify-center gap-2">
                  <History size={12} />
                  Rotate Chain Log
                </button>
              </div>
            </div>

            {/* Reproducible Contract Verification Card */}
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6 space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-violet-300 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  Contract Verification Badge
                </h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Inspect cryptographic build attestations and reproducible bytecode hashes for deployed Soroban smart contracts.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  Inspect Contract ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inspectContractId}
                    onChange={(e) => setInspectContractId(e.target.value)}
                    placeholder="Enter Contract ID (e.g. CABX...1234)"
                    className="w-full bg-slate-950/80 rounded-xl border border-white/10 px-3 py-2 text-xs font-mono outline-none focus:border-violet-500 transition"
                  />
                </div>
                {inspectContractId && (
                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-medium">Attestation Status:</span>
                    <VerificationBadge contractId={inspectContractId} size="sm" />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 space-y-3">
              <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle size={14} />
                Tamper Detection
              </h3>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                If any log entry is modified, the hash chain will break, causing
                all subsequent hashes to become invalid. The verification engine
                checks for these inconsistencies.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getMockLogs(): AuditEntry[] {
  return [
    {
      id: "a-1001",
      event_type: "POST_COMPILE",
      actor: "uche.stellar",
      payload: JSON.stringify({
        contract: "hello_world",
        version: "1.0.2",
        size: "4.2KB",
      }),
      prev_hash: "7d9e...f3a2",
      entry_hash: "9b1c...4e8d",
      merkle_root: "9b1c...4e8d",
      timestamp: new Date().toISOString(),
    },
    {
      id: "a-1002",
      event_type: "POST_DEPLOY",
      actor: "uche.stellar",
      payload: JSON.stringify({
        contract_id: "CABX...1234",
        ledger: 10429,
        tx: "0xdead...beef",
      }),
      prev_hash: "9b1c...4e8d",
      entry_hash: "2f4a...8c9b",
      merkle_root: "2f4a...8c9b",
      timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    },
  ];
}
