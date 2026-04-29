"use client";

import React, { useState, useCallback } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Users,
  Award,
  BarChart2,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Search,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tier = "Bronze" | "Silver" | "Gold";

interface MembershipNft {
  owner: string;
  tier: Tier;
  issued_at: number;
  metadata_uri: string;
}

interface MemberStats {
  access_count: number;
  last_access: number;
}

interface CommunityInfo {
  total_members: number;
  is_paused: boolean;
}

interface Props {
  contractId?: string;
  adminAddress?: string;
  walletAddress?: string;
  apiBase?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_COLOR: Record<Tier, string> = {
  Bronze: "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
  Silver: "text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-300",
  Gold: "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400",
};

const TIERS: Tier[] = ["Bronze", "Silver", "Gold"];

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function tsToDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TokenGatedAccessDashboard({
  contractId = "",
  adminAddress = "",
  walletAddress = "",
  apiBase = "/api/token-gated",
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────

  const [community, setCommunity] = useState<CommunityInfo | null>(null);
  const [membership, setMembership] = useState<MembershipNft | null | undefined>(undefined);
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [accessResult, setAccessResult] = useState<boolean | null>(null);

  const [mintRecipient, setMintRecipient] = useState("");
  const [mintTier, setMintTier] = useState<Tier>("Bronze");
  const [mintUri, setMintUri] = useState("");

  const [lookupAddress, setLookupAddress] = useState("");
  const [checkTier, setCheckTier] = useState<Tier>("Bronze");

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────

  const clearMessages = () => { setError(null); setSuccessMsg(null); };

  const post = useCallback(
    async (path: string, body: object) => {
      const res = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_id: contractId, network: "testnet", ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Request failed");
      return data;
    },
    [apiBase, contractId]
  );

  const get = useCallback(
    async (path: string, params: Record<string, string> = {}) => {
      const qs = new URLSearchParams({ contract_id: contractId, network: "testnet", ...params });
      const res = await fetch(`${apiBase}${path}?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Request failed");
      return data;
    },
    [apiBase, contractId]
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      clearMessages();
      setLoading(key);
      try {
        await fn();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(null);
      }
    },
    []
  );

  // ── Actions ────────────────────────────────────────────────────────────

  const loadCommunity = () =>
    run("community", async () => {
      const data = await get("/community");
      setCommunity(data.community);
    });

  const handleMint = () =>
    run("mint", async () => {
      if (!mintRecipient || !mintUri) throw new Error("Recipient and metadata URI are required");
      const data = await post("/mint", {
        admin: adminAddress,
        recipient: mintRecipient,
        tier: mintTier,
        metadata_uri: mintUri,
      });
      setSuccessMsg(`NFT minted — token #${data.token_id}`);
      setMintRecipient("");
      setMintUri("");
      loadCommunity();
    });

  const handleRevoke = (recipient: string) =>
    run("revoke", async () => {
      await post("/revoke", { admin: adminAddress, recipient });
      setSuccessMsg(`Membership revoked for ${short(recipient)}`);
      if (lookupAddress === recipient) setMembership(null);
      loadCommunity();
    });

  const handleCheckAccess = () =>
    run("check", async () => {
      if (!walletAddress) throw new Error("Connect your wallet first");
      const data = await post("/check-access", { caller: walletAddress, required_tier: checkTier });
      setAccessResult(data.has_access);
    });

  const handleLookup = () =>
    run("lookup", async () => {
      if (!lookupAddress) throw new Error("Enter an address to look up");
      const [memData, statsData] = await Promise.all([
        get(`/membership/${lookupAddress}`),
        get(`/stats/${lookupAddress}`),
      ]);
      setMembership(memData.membership);
      setStats(statsData.stats);
    });

  const handlePause = (pause: boolean) =>
    run("pause", async () => {
      await post(pause ? "/pause" : "/unpause", { admin: adminAddress });
      setSuccessMsg(pause ? "Contract paused" : "Contract unpaused");
      loadCommunity();
    });

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <Shield className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Token-Gated Access</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Membership NFTs &amp; Community Analytics</p>
          </div>
        </div>
        <button
          onClick={loadCommunity}
          disabled={!contractId || loading === "community"}
          className="text-sm px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-50 transition-colors"
          aria-label="Refresh community stats"
        >
          {loading === "community" ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div role="status" className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm">
          {successMsg}
        </div>
      )}

      {/* Community Stats */}
      {community && (
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-indigo-500" />
              <span className="text-sm text-slate-500 dark:text-slate-400">Total Members</span>
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{community.total_members}</div>
          </div>
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              {community.is_paused ? (
                <ShieldOff className="w-4 h-4 text-red-500" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              )}
              <span className="text-sm text-slate-500 dark:text-slate-400">Contract Status</span>
            </div>
            <div className={`text-xl font-semibold ${community.is_paused ? "text-red-500" : "text-emerald-500"}`}>
              {community.is_paused ? "Paused" : "Active"}
            </div>
            {adminAddress && (
              <button
                onClick={() => handlePause(!community.is_paused)}
                disabled={!!loading}
                className="mt-2 flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 disabled:opacity-50 transition-colors"
                aria-label={community.is_paused ? "Unpause contract" : "Pause contract"}
              >
                {community.is_paused ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {community.is_paused ? "Unpause" : "Pause"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Access Check */}
      <section aria-labelledby="access-check-heading">
        <h3 id="access-check-heading" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white mb-3">
          <ShieldCheck className="w-4 h-4 text-indigo-500" /> Check My Access
        </h3>
        <div className="flex gap-2 flex-wrap">
          <select
            value={checkTier}
            onChange={(e) => setCheckTier(e.target.value as Tier)}
            className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Required tier"
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={handleCheckAccess}
            disabled={!walletAddress || !!loading}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading === "check" ? "Checking…" : "Check Access"}
          </button>
        </div>
        {accessResult !== null && (
          <div className={`mt-2 flex items-center gap-2 text-sm font-medium ${accessResult ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {accessResult ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            {accessResult ? "Access granted" : "Access denied"}
          </div>
        )}
      </section>

      {/* Mint NFT (admin) */}
      {adminAddress && (
        <section aria-labelledby="mint-heading">
          <h3 id="mint-heading" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white mb-3">
            <Plus className="w-4 h-4 text-emerald-500" /> Mint Membership NFT
          </h3>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Recipient address (G…)"
              value={mintRecipient}
              onChange={(e) => setMintRecipient(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-label="Recipient address"
            />
            <div className="flex gap-2">
              <select
                value={mintTier}
                onChange={(e) => setMintTier(e.target.value as Tier)}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Membership tier"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Metadata URI (ipfs://…)"
                value={mintUri}
                onChange={(e) => setMintUri(e.target.value)}
                className="flex-[2] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Metadata URI"
              />
            </div>
            <button
              onClick={handleMint}
              disabled={!!loading}
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading === "mint" ? "Minting…" : "Mint NFT"}
            </button>
          </div>
        </section>
      )}

      {/* Member Lookup */}
      <section aria-labelledby="lookup-heading">
        <h3 id="lookup-heading" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white mb-3">
          <Search className="w-4 h-4 text-slate-500" /> Member Lookup
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Address (G…)"
            value={lookupAddress}
            onChange={(e) => setLookupAddress(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Address to look up"
          />
          <button
            onClick={handleLookup}
            disabled={!!loading}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading === "lookup" ? "…" : "Look Up"}
          </button>
        </div>

        {membership !== undefined && (
          <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
            {membership === null ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No membership found.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-indigo-500" />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{short(membership.owner)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TIER_COLOR[membership.tier]}`}>
                      {membership.tier}
                    </span>
                  </div>
                  {adminAddress && (
                    <button
                      onClick={() => handleRevoke(membership.owner)}
                      disabled={!!loading}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                      aria-label={`Revoke membership for ${short(membership.owner)}`}
                    >
                      <Trash2 className="w-3 h-3" /> Revoke
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Issued: {tsToDate(membership.issued_at)} · URI: {membership.metadata_uri}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Analytics */}
        {stats && (
          <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white mb-2">
              <BarChart2 className="w-4 h-4 text-indigo-500" /> Access Analytics
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Total Accesses</span>
                <div className="text-xl font-bold text-slate-900 dark:text-white">{stats.access_count}</div>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Last Access</span>
                <div className="text-xl font-bold text-slate-900 dark:text-white">
                  {stats.last_access ? tsToDate(stats.last_access) : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
