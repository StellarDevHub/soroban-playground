"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Link2,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";

export interface BridgeDeposit {
  id: number;
  depositor: string;
  token: string;
  amount: number;
  fee: number;
  ethDestination: string;
  createdAt: number;
  expiresAt: number;
  status: "Pending" | "Minted" | "Refunded";
  ethTxHash?: string;
}

export interface BridgeStats {
  totalLocked: number;
  totalMinted: number;
  totalRefunded: number;
  depositCount: number;
  activeDeposits: number;
}

interface BridgeDashboardProps {
  contractId?: string;
  walletAddress?: string;
  deposits: BridgeDeposit[];
  stats: BridgeStats;
  isLoading: boolean;
  onLock: (params: {
    token: string;
    amount: number;
    ethDestination: string;
  }) => Promise<void>;
  onConfirmMint: (depositId: number, ethTxHash: string) => Promise<void>;
  onRefund: (depositId: number) => Promise<void>;
}

const STATUS_STYLES: Record<BridgeDeposit["status"], string> = {
  Pending: "bg-amber-900/30 text-amber-300 border-amber-700/40",
  Minted: "bg-emerald-900/30 text-emerald-300 border-emerald-700/40",
  Refunded: "bg-gray-800 text-gray-400 border-gray-700/40",
};

const STATUS_ICONS: Record<BridgeDeposit["status"], React.ReactNode> = {
  Pending: <Clock size={12} />,
  Minted: <CheckCircle2 size={12} />,
  Refunded: <RefreshCw size={12} />,
};

export default function BridgeDashboard({
  contractId,
  walletAddress,
  deposits,
  stats,
  isLoading,
  onLock,
  onConfirmMint,
  onRefund,
}: BridgeDashboardProps) {
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [ethDest, setEthDest] = useState("");
  const [mintDepositId, setMintDepositId] = useState("");
  const [mintTxHash, setMintTxHash] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLock = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return setError("Amount must be greater than 0.");
    if (!ethDest.startsWith("0x")) return setError("ETH destination must start with 0x.");
    if (!contractId) return setError("Deploy a contract first.");
    try {
      await onLock({ token, amount: Math.floor(amt * 1e7), ethDestination: ethDest });
      setAmount("");
      setEthDest("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lock failed.");
    }
  };

  const handleConfirmMint = async () => {
    setError(null);
    const id = parseInt(mintDepositId);
    if (!id) return setError("Enter a valid deposit ID.");
    if (!mintTxHash) return setError("Enter the ETH transaction hash.");
    try {
      await onConfirmMint(id, mintTxHash);
      setMintDepositId("");
      setMintTxHash("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm mint failed.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Total Locked", value: stats.totalLocked.toLocaleString() },
          { label: "Total Minted", value: stats.totalMinted.toLocaleString() },
          { label: "Total Refunded", value: stats.totalRefunded.toLocaleString() },
          { label: "Active Deposits", value: stats.activeDeposits },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-lg border border-gray-800 bg-gray-900 p-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className="mt-1 font-mono text-sm text-cyan-300">{value}</p>
          </div>
        ))}
      </div>

      {/* Lock form */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-300">
          <Link2 size={14} className="text-cyan-400" />
          Lock Tokens (Stellar → Ethereum)
        </h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Token
            </label>
            <select
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-cyan-500 focus:outline-none"
            >
              {["USDC", "XLM", "USDT", "ETH"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Amount
            </label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              ETH Destination
            </label>
            <input
              type="text"
              value={ethDest}
              onChange={(e) => setEthDest(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-200 placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleLock}
          disabled={isLoading || !contractId}
          className="mt-3 flex items-center gap-2 rounded-lg bg-cyan-600/20 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-50 border border-cyan-500/30"
        >
          {isLoading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-cyan-400" />
          ) : (
            <ArrowLeftRight size={14} />
          )}
          Lock & Bridge
        </button>
      </div>

      {/* Relayer: confirm mint */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-300">
          <Shield size={14} className="text-emerald-400" />
          Confirm Mint (Relayer)
        </h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              Deposit ID
            </label>
            <input
              type="number"
              min="1"
              value={mintDepositId}
              onChange={(e) => setMintDepositId(e.target.value)}
              placeholder="1"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
              ETH Tx Hash
            </label>
            <input
              type="text"
              value={mintTxHash}
              onChange={(e) => setMintTxHash(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-200 placeholder-gray-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleConfirmMint}
          disabled={isLoading || !contractId}
          className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-50 border border-emerald-500/30"
        >
          <CheckCircle2 size={14} />
          Confirm Mint
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Deposit list */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-300">
          Deposits ({deposits.length})
        </h4>
        {deposits.length === 0 ? (
          <p className="text-xs text-gray-600">No deposits yet.</p>
        ) : (
          <div className="space-y-2">
            {deposits.map((d) => (
              <div
                key={d.id}
                className="rounded-lg border border-gray-800 bg-gray-950 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-400">#{d.id}</span>
                  <span
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[d.status]}`}
                  >
                    {STATUS_ICONS[d.status]}
                    {d.status}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-gray-400">
                  <span>
                    {d.token}: {d.amount.toLocaleString()}
                  </span>
                  <span className="truncate font-mono text-[10px]">{d.ethDestination}</span>
                </div>
                {d.status === "Pending" && (
                  <button
                    onClick={() => onRefund(d.id)}
                    disabled={isLoading}
                    className="mt-2 flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300 disabled:opacity-50"
                  >
                    <XCircle size={11} />
                    Refund (after expiry)
                  </button>
                )}
                {d.ethTxHash && (
                  <p className="mt-1 truncate font-mono text-[10px] text-emerald-400">
                    ETH: {d.ethTxHash}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
