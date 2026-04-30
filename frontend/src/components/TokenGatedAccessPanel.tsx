"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState, useCallback } from "react";
import {
  Shield,
  Users,
  Key,
  BarChart3,
  CheckCircle,
  XCircle,
  Plus,
  Trash2,
  ArrowUpCircle,
  RefreshCw,
  Lock,
  Unlock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tier = "Basic" | "Premium" | "Elite";

export interface Membership {
  tokenId: number;
  owner: string;
  tier: Tier;
  issuedAt: string;
  expiresAt: string | null;
  metadataUri: string;
}

export interface Analytics {
  totalMembers: number;
  basicCount: number;
  premiumCount: number;
  eliteCount: number;
  totalAccessChecks: number;
  lastUpdated: string;
}

interface Props {
  apiBase?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIERS: Tier[] = ["Basic", "Premium", "Elite"];

const TIER_COLOR: Record<Tier, string> = {
  Basic: "text-sky-400 bg-sky-400/10 border-sky-400/20",
  Premium: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  Elite: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TIER_COLOR[tier]}`}
    >
      {tier}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TokenGatedAccessPanel({ apiBase = "http://localhost:5000" }: Props) {
  const base = `${apiBase}/api/token-gated`;

  // ── State ──────────────────────────────────────────────────────────────────

  const [members, setMembers] = useState<Membership[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Mint form
  const [mintForm, setMintForm] = useState({ recipient: "", tier: "Basic" as Tier, metadataUri: "" });
  const [minting, setMinting] = useState(false);

  // Access check
  const [checkForm, setCheckForm] = useState({ address: "", minTier: "Basic" as Tier });
  const [checkResult, setCheckResult] = useState<{ granted: boolean; tier?: Tier; reason: string } | null>(null);
  const [checking, setChecking] = useState(false);

  // Upgrade form
  const [upgradeForm, setUpgradeForm] = useState({ tokenId: "", newTier: "Premium" as Tier });

  // ── API helpers ────────────────────────────────────────────────────────────

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [membersRes, analyticsRes] = await Promise.all([
        fetch(`${base}/members`),
        fetch(`${base}/analytics`),
      ]);
      const membersData = await membersRes.json();
      const analyticsData = await analyticsRes.json();
      if (membersData.success) setMembers(membersData.data.items);
      if (analyticsData.success) setAnalytics(analyticsData.data);
    } catch {
      setError("Failed to fetch data. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [base]);

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mintForm.recipient.trim()) return;
    setMinting(true);
    setError(null);
    try {
      const res = await fetch(`${base}/mint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          admin: "ADMIN_ADDRESS",
          recipient: mintForm.recipient.trim(),
          tier: mintForm.tier,
          metadataUri: mintForm.metadataUri.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Mint failed");
      flash(`Minted token #${data.data.tokenId} to ${short(mintForm.recipient)}`);
      setMintForm({ recipient: "", tier: "Basic", metadataUri: "" });
      fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  const handleRevoke = async (tokenId: number) => {
    if (!confirm(`Revoke token #${tokenId}?`)) return;
    setError(null);
    try {
      const res = await fetch(`${base}/revoke/${tokenId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Revoke failed");
      flash(`Token #${tokenId} revoked`);
      fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradeForm.tokenId) return;
    setError(null);
    try {
      const res = await fetch(`${base}/upgrade/${upgradeForm.tokenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTier: upgradeForm.newTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upgrade failed");
      flash(`Token #${upgradeForm.tokenId} upgraded to ${upgradeForm.newTier}`);
      setUpgradeForm({ tokenId: "", newTier: "Premium" });
      fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upgrade failed");
    }
  };

  const handleCheckAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkForm.address.trim()) return;
    setChecking(true);
    setCheckResult(null);
    setError(null);
    try {
      const params = new URLSearchParams({ address: checkForm.address.trim(), minTier: checkForm.minTier });
      const res = await fetch(`${base}/check-access?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Check failed");
      setCheckResult(data.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Access check failed");
    } finally {
      setChecking(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <XCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle size={14} className="shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total Members", value: analytics.totalMembers, icon: <Users size={14} /> },
            { label: "Basic", value: analytics.basicCount, icon: <Shield size={14} />, color: "text-sky-400" },
            { label: "Premium", value: analytics.premiumCount, icon: <Shield size={14} />, color: "text-violet-400" },
            { label: "Elite", value: analytics.eliteCount, icon: <Shield size={14} />, color: "text-amber-400" },
            { label: "Access Checks", value: analytics.totalAccessChecks, icon: <BarChart3 size={14} /> },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border border-white/5 bg-white/5 p-4">
              <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 ${s.color ?? ""}`}>
                {s.icon}
                {s.label}
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Mint Form */}
        <section className="rounded-2xl border border-white/5 bg-white/5 p-6 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Plus size={14} className="text-emerald-400" />
            Mint Membership NFT
          </h2>
          <form onSubmit={handleMint} className="space-y-3" aria-label="Mint membership form">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="mint-recipient">
                Recipient Address
              </label>
              <input
                id="mint-recipient"
                type="text"
                required
                placeholder="G... or contract address"
                value={mintForm.recipient}
                onChange={(e) => setMintForm((f) => ({ ...f, recipient: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                aria-required="true"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="mint-tier">
                Tier
              </label>
              <select
                id="mint-tier"
                value={mintForm.tier}
                onChange={(e) => setMintForm((f) => ({ ...f, tier: e.target.value as Tier }))}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
              >
                {TIERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="mint-uri">
                Metadata URI (optional)
              </label>
              <input
                id="mint-uri"
                type="text"
                placeholder="ipfs://..."
                value={mintForm.metadataUri}
                onChange={(e) => setMintForm((f) => ({ ...f, metadataUri: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={minting}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              {minting ? "Minting…" : "Mint NFT"}
            </button>
          </form>
        </section>

        {/* Access Check */}
        <section className="rounded-2xl border border-white/5 bg-white/5 p-6 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Key size={14} className="text-violet-400" />
            Check Access
          </h2>
          <form onSubmit={handleCheckAccess} className="space-y-3" aria-label="Check access form">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="check-address">
                Address
              </label>
              <input
                id="check-address"
                type="text"
                required
                placeholder="G... address"
                value={checkForm.address}
                onChange={(e) => setCheckForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                aria-required="true"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="check-tier">
                Minimum Tier Required
              </label>
              <select
                id="check-tier"
                value={checkForm.minTier}
                onChange={(e) => setCheckForm((f) => ({ ...f, minTier: e.target.value as Tier }))}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
              >
                {TIERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={checking}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50 transition"
            >
              {checking ? "Checking…" : "Check Access"}
            </button>
          </form>

          {checkResult && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-3 rounded-xl border p-4 ${
                checkResult.granted
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-rose-500/30 bg-rose-500/10"
              }`}
            >
              {checkResult.granted ? (
                <Unlock size={18} className="text-emerald-400 shrink-0" />
              ) : (
                <Lock size={18} className="text-rose-400 shrink-0" />
              )}
              <div>
                <p className={`text-sm font-bold ${checkResult.granted ? "text-emerald-300" : "text-rose-300"}`}>
                  {checkResult.granted ? "Access Granted" : "Access Denied"}
                </p>
                <p className="text-[11px] text-slate-400">
                  {checkResult.tier ? `Tier: ${checkResult.tier} · ` : ""}
                  Reason: {checkResult.reason}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Upgrade Form */}
      <section className="rounded-2xl border border-white/5 bg-white/5 p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200 mb-4">
          <ArrowUpCircle size={14} className="text-amber-400" />
          Upgrade Membership
        </h2>
        <form onSubmit={handleUpgrade} className="flex flex-wrap gap-3 items-end" aria-label="Upgrade membership form">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="upgrade-token">
              Token ID
            </label>
            <input
              id="upgrade-token"
              type="number"
              min="1"
              required
              placeholder="1"
              value={upgradeForm.tokenId}
              onChange={(e) => setUpgradeForm((f) => ({ ...f, tokenId: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-amber-500 focus:outline-none"
              aria-required="true"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1" htmlFor="upgrade-tier">
              New Tier
            </label>
            <select
              id="upgrade-tier"
              value={upgradeForm.newTier}
              onChange={(e) => setUpgradeForm((f) => ({ ...f, newTier: e.target.value as Tier }))}
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              {TIERS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-bold text-white hover:bg-amber-500 transition"
          >
            Upgrade
          </button>
        </form>
      </section>

      {/* Members Table */}
      <section className="rounded-2xl border border-white/5 bg-white/5 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Users size={14} className="text-sky-400" />
            Members ({members.length})
          </h2>
          <button
            onClick={fetchMembers}
            disabled={loading}
            aria-label="Refresh members list"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {members.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">
            {loading ? "Loading…" : "No members yet. Mint the first NFT above."}
          </p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Members table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="pb-2 text-left">Token</th>
                  <th className="pb-2 text-left">Owner</th>
                  <th className="pb-2 text-left">Tier</th>
                  <th className="pb-2 text-left">Issued</th>
                  <th className="pb-2 text-left">Expires</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {members.map((m) => (
                  <tr key={m.tokenId} className="hover:bg-white/5 transition">
                    <td className="py-2.5 font-mono text-slate-300">#{m.tokenId}</td>
                    <td className="py-2.5 font-mono text-slate-400" title={m.owner}>{short(m.owner)}</td>
                    <td className="py-2.5"><TierBadge tier={m.tier} /></td>
                    <td className="py-2.5 text-slate-500 text-xs">{new Date(m.issuedAt).toLocaleDateString()}</td>
                    <td className="py-2.5 text-slate-500 text-xs">{m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : "Never"}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleRevoke(m.tokenId)}
                        aria-label={`Revoke token ${m.tokenId}`}
                        className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20 transition"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
