"use client";

import React, { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ExternalLink, Trash2, Check, Loader2, Circle } from "lucide-react";

export type BridgeStageId =
  | "source_confirmed"
  | "relayer_picked_up"
  | "proof_generated"
  | "destination_minted";

export const BRIDGE_STAGES: { id: BridgeStageId; label: string }[] = [
  { id: "source_confirmed", label: "Source Transaction Confirmed" },
  { id: "relayer_picked_up", label: "Relayer Picked Up" },
  { id: "proof_generated", label: "Proof Generated" },
  { id: "destination_minted", label: "Destination Minted" },
];

export type BridgeTransferStatus = "pending" | "completed" | "failed";

export interface BridgeTransfer {
  transferId: string;
  sourceChain: string;
  destinationChain: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
  /** Highest completed stage index (-1 = none). */
  currentStageIndex: number;
  status: BridgeTransferStatus;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface BridgeEvent {
  type: "bridge_event";
  transferId: string;
  stage: BridgeStageId;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
  timestamp?: number;
}

export const BRIDGE_STORAGE_KEY = "bridge_transfer_sessions";

// ---------- Explorer link helpers ----------

const EXPLORER_BASE: Record<string, string> = {
  stellar: "https://stellar.expert/explorer/testnet/tx/",
  ethereum: "https://etherscan.io/tx/",
  sepolia: "https://sepolia.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  base: "https://basescan.org/tx/",
};

export function explorerTxUrl(chain: string, hash: string): string | null {
  const base = EXPLORER_BASE[chain.toLowerCase()];
  return base ? `${base}${hash}` : null;
}

// ---------- Pure state transitions ----------

export function applyBridgeEvent(
  transfer: BridgeTransfer,
  event: BridgeEvent,
  now: number = Date.now(),
): BridgeTransfer {
  const stageIndex = BRIDGE_STAGES.findIndex((s) => s.id === event.stage);
  if (stageIndex === -1) return transfer;

  const isFinal = stageIndex === BRIDGE_STAGES.length - 1;
  const hasError = Boolean(event.error);

  return {
    ...transfer,
    sourceTxHash: event.sourceTxHash ?? transfer.sourceTxHash,
    destinationTxHash: event.destinationTxHash ?? transfer.destinationTxHash,
    currentStageIndex: hasError
      ? transfer.currentStageIndex
      : Math.max(transfer.currentStageIndex, stageIndex),
    status: hasError ? "failed" : isFinal ? "completed" : "pending",
    error: event.error,
    updatedAt: event.timestamp ?? now,
  };
}

export function createBridgeTransfer(
  init: Pick<BridgeTransfer, "transferId" | "sourceChain" | "destinationChain"> &
    Partial<Pick<BridgeTransfer, "sourceTxHash">>,
  now: number = Date.now(),
): BridgeTransfer {
  return {
    transferId: init.transferId,
    sourceChain: init.sourceChain,
    destinationChain: init.destinationChain,
    sourceTxHash: init.sourceTxHash,
    currentStageIndex: -1,
    status: "pending",
    startedAt: now,
    updatedAt: now,
  };
}

// ---------- localStorage persistence ----------

export function loadBridgeSessions(storage: Storage | undefined): BridgeTransfer[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(BRIDGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BridgeTransfer[]) : [];
  } catch {
    return [];
  }
}

export function saveBridgeSessions(
  storage: Storage | undefined,
  transfers: BridgeTransfer[],
): void {
  if (!storage) return;
  try {
    storage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(transfers));
  } catch {
    // Quota exceeded or storage disabled; tracking continues in memory.
  }
}

// ---------- Reducer ----------

type Action =
  | { type: "hydrate"; transfers: BridgeTransfer[] }
  | { type: "track"; transfer: BridgeTransfer }
  | { type: "event"; event: BridgeEvent; now: number }
  | { type: "clear" };

function reducer(state: BridgeTransfer[], action: Action): BridgeTransfer[] {
  switch (action.type) {
    case "hydrate":
      return action.transfers;
    case "track": {
      const others = state.filter((t) => t.transferId !== action.transfer.transferId);
      return [action.transfer, ...others];
    }
    case "event":
      return state.map((t) =>
        t.transferId === action.event.transferId
          ? applyBridgeEvent(t, action.event, action.now)
          : t,
      );
    case "clear":
      return [];
    default:
      return state;
  }
}

// ---------- Stepper ----------

function StageIcon({ state }: { state: "done" | "active" | "todo" | "failed" }) {
  if (state === "done") return <Check size={12} className="text-emerald-400" />;
  if (state === "active")
    return <Loader2 size={12} className="text-cyan-400 animate-spin" />;
  if (state === "failed") return <Circle size={12} className="text-rose-400" />;
  return <Circle size={12} className="text-gray-600" />;
}

export function BridgeStepper({ transfer }: { transfer: BridgeTransfer }) {
  return (
    <ol className="space-y-1.5" aria-label="Bridge progress">
      {BRIDGE_STAGES.map((stage, idx) => {
        let state: "done" | "active" | "todo" | "failed";
        if (idx <= transfer.currentStageIndex) state = "done";
        else if (idx === transfer.currentStageIndex + 1)
          state = transfer.status === "failed" ? "failed" : "active";
        else state = "todo";

        return (
          <li
            key={stage.id}
            data-stage={stage.id}
            data-state={state}
            className="flex items-center gap-2 text-xs"
          >
            <StageIcon state={state} />
            <span
              className={
                state === "done"
                  ? "text-gray-200"
                  : state === "active"
                    ? "text-cyan-300"
                    : "text-gray-500"
              }
            >
              {stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ExplorerLink({ chain, hash, label }: { chain: string; hash?: string; label: string }) {
  if (!hash) return null;
  const url = explorerTxUrl(chain, hash);
  if (!url) return <span className="text-[10px] text-gray-500">{label}: {hash}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"
    >
      <ExternalLink size={10} />
      {label} ({chain})
    </a>
  );
}

// ---------- Main component ----------

interface BridgeTransferTrackerProps {
  /** WebSocket URL streaming BridgeEvent JSON messages. Optional. */
  wsUrl?: string;
  /** Externally supplied events (e.g. from a shared socket hook). */
  events?: BridgeEvent[];
  /** Newly started transfer to begin tracking. */
  newTransfer?: Pick<BridgeTransfer, "transferId" | "sourceChain" | "destinationChain"> &
    Partial<Pick<BridgeTransfer, "sourceTxHash">>;
}

export default function BridgeTransferTracker({
  wsUrl,
  events,
  newTransfer,
}: BridgeTransferTrackerProps) {
  const [transfers, dispatch] = useReducer(reducer, [] as BridgeTransfer[]);
  const hydrated = useRef(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.localStorage : undefined;
    dispatch({ type: "hydrate", transfers: loadBridgeSessions(storage) });
    hydrated.current = true;
  }, []);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!hydrated.current) return;
    const storage = typeof window !== "undefined" ? window.localStorage : undefined;
    saveBridgeSessions(storage, transfers);
  }, [transfers]);

  // Begin tracking a new transfer.
  useEffect(() => {
    if (!newTransfer) return;
    dispatch({
      type: "track",
      transfer: createBridgeTransfer(newTransfer),
    });
  }, [newTransfer?.transferId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply externally supplied events.
  useEffect(() => {
    if (!events || events.length === 0) return;
    const now = Date.now();
    events.forEach((event) => dispatch({ type: "event", event, now }));
  }, [events]);

  // Stream events from WebSocket.
  useEffect(() => {
    if (!wsUrl || typeof WebSocket === "undefined") return;
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as BridgeEvent;
        if (data?.type === "bridge_event") {
          dispatch({ type: "event", event: data, now: Date.now() });
        }
      } catch {
        // Ignore malformed frames.
      }
    };
    return () => socket.close();
  }, [wsUrl]);

  const handleClear = useCallback(() => dispatch({ type: "clear" }), []);

  const sorted = useMemo(
    () => [...transfers].sort((a, b) => b.startedAt - a.startedAt),
    [transfers],
  );

  if (sorted.length === 0) return null;

  return (
    <div
      className="flex flex-col space-y-3 p-4 bg-gray-900 border border-gray-800 rounded-xl shadow-lg"
      aria-label="Bridge transfers"
      role="region"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-widest">
          Bridge Transfers
        </h3>
        <button
          onClick={handleClear}
          className="text-gray-600 hover:text-gray-400 transition-colors"
          aria-label="Clear bridge transfers"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {sorted.map((t) => (
        <div
          key={t.transferId}
          data-testid={`bridge-transfer-${t.transferId}`}
          className="p-3 rounded-lg bg-gray-950 border border-gray-800 space-y-2"
        >
          <p className="text-[11px] text-gray-400">
            {t.sourceChain} → {t.destinationChain}
          </p>
          <BridgeStepper transfer={t} />
          {t.error && (
            <p className="text-[10px] text-rose-400" aria-live="assertive">
              {t.error}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <ExplorerLink chain={t.sourceChain} hash={t.sourceTxHash} label="Source tx" />
            <ExplorerLink
              chain={t.destinationChain}
              hash={t.destinationTxHash}
              label="Destination tx"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
