"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Coins,
  Copy,
  Database,
  Gift,
  Sparkles,
  Waves,
} from "lucide-react";

import { ConnectionBadge } from "@/components/ConnectionBadge";
import WalletConnect from "@/components/WalletConnect";
import { useFreighterWallet } from "@/hooks/useFreighterWallet";
import type { EventStreamStatus } from "@/hooks/useEventStream";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:5000";

const ADDRESS_PATTERN = /^G[A-Z0-9]{55}$/;

type TokenInfo = {
  symbol?: string;
  decimals?: number;
  address?: string;
};

type TopAllocation = {
  address: string;
  amount: string;
};

type AirdropConfig = {
  root: string;
  count: number;
  totalAmount: string;
  token: TokenInfo | null;
  topAllocations: TopAllocation[];
  updatedAt: string;
};

type ProofNode = {
  hash: string;
  is_left: boolean;
};

type EligibilityPayload = {
  eligible: boolean;
  address?: string;
  amount?: string;
  leaf?: string;
  proof?: ProofNode[];
  root?: string;
  token?: TokenInfo | null;
};

type ClaimEvent = {
  address: string;
  amount: string;
  root: string;
  timestamp: string;
};

function formatAmount(value: string | undefined) {
  if (!value) return "0";
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString();
}

function shortAddress(value: string, size = 6) {
  if (!value) return "";
  if (value.length <= size * 2) return value;
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

export default function AirdropDashboard() {
  const wallet = useFreighterWallet();
  const [config, setConfig] = useState<AirdropConfig | null>(null);
  const [status, setStatus] = useState<EventStreamStatus>("idle");
  const [address, setAddress] = useState("");
  const [eligibility, setEligibility] = useState<EligibilityPayload | null>(null);
  const [claimResult, setClaimResult] = useState<EligibilityPayload | null>(null);
  const [recentClaims, setRecentClaims] = useState<ClaimEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tokenLabel = useMemo(() => {
    if (!config?.token?.symbol) return "Token";
    return `${config.token.symbol} token`;
  }, [config]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/airdrop/config`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load airdrop config");
      }
      setConfig(json.data as AirdropConfig);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const id = setInterval(fetchConfig, 15000);
    return () => clearInterval(id);
  }, [fetchConfig]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let socket: WebSocket | null = null;
    setStatus("connecting");

    try {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket.onopen = () => setStatus("connected");
      socket.onclose = () => setStatus("reconnecting");
      socket.onerror = () => setStatus("error");
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type !== "airdrop-claim") return;
          setRecentClaims((prev) => {
            const next = [payload, ...prev];
            return next.slice(0, 6);
          });
        } catch {
          // ignore non-JSON frames
        }
      };
    } catch {
      setStatus("error");
    }

    return () => {
      socket?.close();
    };
  }, []);

  const onCheckEligibility = async () => {
    const normalized = address.trim().toUpperCase();
    if (!ADDRESS_PATTERN.test(normalized)) {
      setError("Enter a valid Stellar account address");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/airdrop/eligibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: normalized }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Eligibility check failed");
      }
      setEligibility(json.data as EligibilityPayload);
      setClaimResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eligibility check failed");
    } finally {
      setLoading(false);
    }
  };

  const onPrepareClaim = async () => {
    if (!eligibility?.eligible || !eligibility.address) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/airdrop/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: eligibility.address,
          amount: eligibility.amount,
          proof: eligibility.proof,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Claim preparation failed");
      }
      setClaimResult(json.data?.claim || eligibility);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim preparation failed");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const claimSnippet = useMemo(() => {
    if (!claimResult?.address || !claimResult.amount || !claimResult.proof) return "";
    return `soroban contract invoke --id <CONTRACT_ID> --source-account <SOURCE> --network testnet -- claim --claimant ${claimResult.address} --amount ${claimResult.amount} --proof ${JSON.stringify(claimResult.proof)}`;
  }, [claimResult]);

  return (
    <div
      className="min-h-screen"
      style={
        {
          "--airdrop-bg": "#0b1424",
          "--airdrop-panel": "rgba(11, 20, 36, 0.82)",
          "--airdrop-border": "rgba(148, 163, 184, 0.18)",
          "--airdrop-accent": "#38bdf8",
          "--airdrop-accent-2": "#f59e0b",
          "--airdrop-grid": "rgba(148, 163, 184, 0.1)",
        } as React.CSSProperties
      }
    >
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(245,158,11,0.18),_transparent_42%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,_var(--airdrop-bg)_0%,_#0f1d34_100%)]" />

        <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
          <header className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-sky-500/20 p-3 text-sky-200">
                  <Gift className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Merkle Airdrop Console
                  </p>
                  <h1 className="text-3xl font-semibold text-white">
                    Token Distribution Command Center
                  </h1>
                </div>
              </div>
              <ConnectionBadge status={status} />
            </div>
            <p className="max-w-2xl text-sm text-slate-300">
              Verify eligibility, preview Merkle proofs, and prepare claim payloads for the
              on-chain airdrop contract.
            </p>
          </header>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
                <Coins className="h-4 w-4 text-sky-300" />
                Total Distribution
              </div>
              <p className="mt-2 text-2xl font-semibold text-white">
                {formatAmount(config?.totalAmount)}
              </p>
              <p className="text-xs text-slate-400">{tokenLabel}</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
                <Database className="h-4 w-4 text-amber-300" />
                Eligible wallets
              </div>
              <p className="mt-2 text-2xl font-semibold text-white">{config?.count ?? 0}</p>
              <p className="text-xs text-slate-400">Merkle root synced</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
                <Sparkles className="h-4 w-4 text-sky-300" />
                Root hash
              </div>
              <p className="mt-2 text-sm text-slate-200">
                {config?.root ? shortAddress(config.root, 10) : "loading"}
              </p>
              <p className="text-xs text-slate-400">Updated {config?.updatedAt || "--"}</p>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="rounded-3xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-white">Eligibility check</h2>
                  <p className="text-sm text-slate-400">
                    Provide a Stellar account to retrieve its allocation and proof.
                  </p>
                </div>
                {wallet.address && (
                  <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
                    {shortAddress(wallet.address, 5)}
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="sr-only" htmlFor="airdrop-address">
                  Stellar address
                </label>
                <input
                  id="airdrop-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="G..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none"
                />
                <button
                  onClick={onCheckEligibility}
                  disabled={loading}
                  className="rounded-xl bg-sky-500/20 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Checking" : "Check"}
                </button>
              </div>

              {error && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  <CircleAlert className="h-4 w-4" />
                  {error}
                </div>
              )}

              {eligibility && (
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Allocation
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {eligibility.eligible ? formatAmount(eligibility.amount) : "0"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {eligibility.eligible ? "Eligible" : "Not eligible"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Proof depth
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {eligibility.proof?.length ?? 0}
                    </p>
                    <p className="text-xs text-slate-400">Sibling hashes</p>
                  </div>
                  <div className="md:col-span-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Leaf hash
                      </div>
                      {eligibility.leaf && (
                        <button
                          onClick={() => copyToClipboard(eligibility.leaf || "")}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                        >
                          <Copy className="h-3 w-3" />
                          Copy
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-300 break-all">
                      {eligibility.leaf || "--"}
                    </p>
                  </div>
                </div>
              )}

              {eligibility?.eligible && (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    onClick={onPrepareClaim}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Prepare claim
                  </button>
                  <p className="text-xs text-slate-400">
                    This does not submit the transaction, it validates the proof.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-6">
              <div className="rounded-3xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-6">
                <h3 className="text-lg font-semibold text-white">Wallet control</h3>
                <p className="text-sm text-slate-400">Connect Freighter to align claims.</p>
                <div className="mt-4">
                  <WalletConnect wallet={wallet} />
                </div>
              </div>

              <div className="rounded-3xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Recent claims</h3>
                  <Waves className="h-5 w-5 text-sky-300" />
                </div>
                <div className="mt-4 space-y-3">
                  {recentClaims.length === 0 ? (
                    <p className="text-sm text-slate-500">Waiting for claim activity...</p>
                  ) : (
                    recentClaims.map((claim, index) => (
                      <div
                        key={`${claim.address}-${index}`}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                      >
                        <p className="text-xs text-slate-400">
                          {shortAddress(claim.address, 6)}
                        </p>
                        <p className="text-sm text-white">
                          {formatAmount(claim.amount)} claimed
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {new Date(claim.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-3xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-6">
              <h3 className="text-lg font-semibold text-white">Distribution preview</h3>
              <p className="text-sm text-slate-400">Top allocations by amount.</p>
              <div className="mt-5 space-y-3">
                {(config?.topAllocations || []).map((entry) => (
                  <div key={entry.address} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{shortAddress(entry.address, 6)}</span>
                      <span>{formatAmount(entry.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-900">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400"
                        style={{
                          width: config?.totalAmount
                            ? `${(Number(entry.amount) / Number(config.totalAmount || 1)) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-[color:var(--airdrop-border)] bg-[color:var(--airdrop-panel)] p-6">
              <h3 className="text-lg font-semibold text-white">Claim payload</h3>
              <p className="text-sm text-slate-400">
                Use this snippet after preparing a claim to invoke the contract.
              </p>
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-200">
                {claimSnippet ? (
                  <pre className="whitespace-pre-wrap break-words">{claimSnippet}</pre>
                ) : (
                  <span className="text-slate-500">Prepare a claim to generate the snippet.</span>
                )}
              </div>
              {claimSnippet && (
                <button
                  onClick={() => copyToClipboard(claimSnippet)}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
                >
                  <Copy className="h-3 w-3" />
                  Copy snippet
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
