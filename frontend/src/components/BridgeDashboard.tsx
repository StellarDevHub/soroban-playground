"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  ExternalLink,
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

export type BridgeStage =
  | "source_confirmed"
  | "relayer_picked_up"
  | "proof_generated"
  | "destination_minted";

export const BRIDGE_STAGES: BridgeStage[] = [
  "source_confirmed",
  "relayer_picked_up",
  "proof_generated",
  "destination_minted",
];

export const BRIDGE_STAGE_LABELS: Record<BridgeStage, string> = {
  source_confirmed: "Source Transaction Confirmed",
  relayer_picked_up: "Relayer Picked Up",
  proof_generated: "Proof Generated",
  destination_minted: "Destination Minted",
};

export interface BridgeTrackingSession {
  depositId: number;
  stage: BridgeStage | null;
  sourceTxHash?: string;
  destinationTxHash?: string;
  sourceNetwork: "stellar";
  destinationNetwork: "ethereum";
  startedAt: number;
  updatedAt: number;
}

export interface BridgeEvent {
  depositId: number;
  type: "source_confirmed" | "relayer_picked_up" | "proof_generated" | "destination_minted";
  sourceTxHash?: string;
  destinationTxHash?: string;
  timestamp: number;
}

export const BRIDGE_SESSIONS_STORAGE_KEY = "bridge-tracking-sessions";

export function stageIndex(stage: BridgeStage | null): number {
  return stage === null ? -1 : BRIDGE_STAGES.indexOf(stage);
}

/**
 * Applies a streamed bridge event to a session. Stages only move forward;
 * out-of-order or duplicate events never regress the stepper.
 */
export function applyBridgeEvent(
  session: BridgeTrackingSession,
  event: BridgeEvent,
): BridgeTrackingSession {
  if (event.depositId !== session.depositId) return session;
  const nextStage = event.type as BridgeStage;
  const advance = stageIndex(nextStage) > stageIndex(session.stage);
  return {
    ...session,
    stage: advance ? nextStage : session.stage,
    sourceTxHash: event.sourceTxHash ?? session.sourceTxHash,
    destinationTxHash: event.destinationTxHash ?? session.destinationTxHash,
    updatedAt: event.timestamp,
  };
}

export function loadBridgeSessions(): Record<number, BridgeTrackingSession> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(BRIDGE_SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveBridgeSessions(
  sessions: Record<number, BridgeTrackingSession>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BRIDGE_SESSIONS_STORAGE_KEY,
      JSON.stringify(sessions),
    );
  } catch {
    // Storage may be full or disabled; tracking remains in memory.
  }
}

export function sourceExplorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

export function destinationExplorerUrl(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
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

export function BridgeProgressStepper({
  session,
}: {
  session: BridgeTrackingSession;
}) {
  const current = stageIndex(session.stage);
  return (
    <div className="mt-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
      <ol className="space-y-2" aria-label="Bridge transfer progress">
        {BRIDGE_STAGES.map((stage, idx) => {
          const done = idx <= current;
          const active = idx === current + 1;
          return (
            <li
              key={stage}
              data-stage={stage}
              data-state={done ? "complete" : active ? "active" : "pending"}
              className="flex items-center gap-2 text-xs"
            >
              {done ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : active ? (
                <Clock size={12} className="animate-pulse text-amber-300" />
              ) : (
                <span className="h-3 w-3 rounded-full border border-gray-600" />
              )}
              <span
                className={
                  done
                    ? "text-emerald-300"
                    : active
                      ? "text-amber-300"
                      : "text-gray-500"
                }
              >
                {BRIDGE_STAGE_LABELS[stage]}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 space-y-1 text-[10px]">
        {session.sourceTxHash && (
          <a
            href={sourceExplorerUrl(session.sourceTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-cyan-400 hover:text-cyan-300"
          >
            <ExternalLink size={10} />
            Source (Stellar): {session.sourceTxHash}
          </a>
        )}
        {session.destinationTxHash && (
          <a
            href={destinationExplorerUrl(session.destinationTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-cyan-400 hover:text-cyan-300"
          >
            <ExternalLink size={10} />
            Destination (Ethereum): {session.destinationTxHash}
          </a>
        )}
      </div>
    </div>
  );
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
  /** Live bridge event stream (e.g. a WebSocket subscription), if available. */
  bridgeEvents?: BridgeEvent[];
}

export default function BridgeDashboard({
  contractId,
  walletAddress,
  deposits,
  stats,
  isLoading,
  onLock,
  onConfirmMint,
  onRefund,
  bridgeEvents,
}: BridgeDashboardProps) {
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [ethDest, setEthDest] = useState("");
  const [mintDepositId, setMintDepositId] = useState("");
  const [mintTxHash, setMintTxHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<
    Record<number, BridgeTrackingSession>
  >({});
  const hydrated = useRef(false);

  // Restore persisted tracking sessions after mount (avoids SSR mismatch).
  useEffect(() => {
    setSessions(loadBridgeSessions());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (hydrated.current) saveBridgeSessions(sessions);
  }, [sessions]);

  // Apply streamed events to the matching sessions.
  useEffect(() => {
    if (!bridgeEvents || bridgeEvents.length === 0) return;
    setSessions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const event of bridgeEvents) {
        const existing = next[event.depositId];
        if (!existing) continue;
        const updated = applyBridgeEvent(existing, event);
        if (updated !== existing) {
          next[event.depositId] = updated;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [bridgeEvents]);

  // Start tracking a deposit once it is locked (pending) and not yet tracked.
  useEffect(() => {
    setSessions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const d of deposits) {
        if (d.status === "Pending" && !next[d.id]) {
          const now = Date.now();
          next[d.id] = {
            depositId: d.id,
            stage: null,
            sourceNetwork: "stellar",
            destinationNetwork: "ethereum",
            startedAt: d.createdAt || now,
            updatedAt: now,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [deposits]);

  const trackedSessions = useMemo(
    () =>
      deposits
        .filter((d) => sessions[d.id])
        .map((d) => ({ deposit: d, session: sessions[d.id] })),
    [deposits, sessions],
  );

  const handleLock = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return setError("Amount must be greater than 0.");
    if (!ethDest.startsWith("0x"))
      return setError("ETH destination must start with 0x.");
    if (!contractId) return setError("Deploy a contract first.");
    try {
      await onLock({
        token,
        amount: Math.floor(amt * 1e7),
        ethDestination: ethDest,
      });
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
      setSessions((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return {
          ...prev,
          [id]: {
            ...existing,
            destinationTxHash: mintTxHash,
            updatedAt: Date.now(),
          },
        };
      });
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
          {
            label: "Total Refunded",
            value: stats.totalRefunded.toLocaleString(),
          },
          { label: "Active Deposits", value: stats.activeDeposits },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-lg border border-gray-800 bg-gray-900 p-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              {label}
            </p>
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

      {/* Active transfer tracker */}
      {trackedSessions.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-300">
            Transfer Progress
          </h4>
          <div className="space-y-3">
            {trackedSessions.map(({ deposit, session }) => (
              <div key={deposit.id}>
                <p className="font-mono text-xs text-gray-400">
                  Deposit #{deposit.id}
                </p>
                <BridgeProgressStepper session={session} />
              </div>
            ))}
          </div>
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
                  <span className="font-mono text-xs text-gray-400">
                    #{d.id}
                  </span>
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
                  <span className="truncate font-mono text-[10px]">
                    {d.ethDestination}
                  </span>
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
