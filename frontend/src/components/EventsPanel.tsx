"use client";

/**
 * EventsPanel
 *
 * Displays real-time on-chain events from the indexer's /ws/events endpoint.
 * Uses the useEventStream hook for WebSocket push delivery with automatic
 * reconnection and REST polling fallback.
 *
 * Drop into any page that needs live event visibility:
 *
 *   <EventsPanel
 *     contractId={contractId}         // optional filter
 *     wsUrl="ws://localhost:3001/ws/events"
 *     restUrl="http://localhost:3001/events"
 *   />
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Trash2 } from "lucide-react";
import { useEventStream } from "@/hooks/useEventStream";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import type { WsEvent } from "@/workers/eventStream.worker";

// ── Props ─────────────────────────────────────────────────────────────────────

interface EventsPanelProps {
  wsUrl?: string;
  restUrl?: string;
  contractId?: string;
  eventType?: string;
  /** Maximum visible events (default 200) */
  maxEvents?: number;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:3001/ws/events`
    : "ws://localhost:3001/ws/events";

function formatLedger(n: number): string {
  return `#${n.toLocaleString()}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString();
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  transfer:    "bg-blue-500/20 text-blue-300 border-blue-700/40",
  mint:        "bg-green-500/20 text-green-300 border-green-700/40",
  burn:        "bg-red-500/20 text-red-300 border-red-700/40",
  swap:        "bg-purple-500/20 text-purple-300 border-purple-700/40",
  invoke:      "bg-amber-500/20 text-amber-300 border-amber-700/40",
  deploy:      "bg-cyan-500/20 text-cyan-300 border-cyan-700/40",
};

function eventTypeClass(type: string): string {
  return EVENT_TYPE_COLORS[type.toLowerCase()] ??
    "bg-slate-700/40 text-slate-300 border-slate-600/40";
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: WsEvent }) {
  const [expanded, setExpanded] = useState(false);

  const parsedData = useMemo(() => {
    try { return JSON.stringify(JSON.parse(event.data), null, 2); }
    catch { return event.data; }
  }, [event.data]);

  return (
    <div
      className="group border-b border-white/5 px-4 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
      onClick={() => setExpanded((p) => !p)}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Event type badge */}
        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${eventTypeClass(event.event_type)}`}>
          {event.event_type}
        </span>

        {/* Contract ID (truncated) */}
        <span className="font-mono text-[11px] text-slate-400 truncate max-w-[130px]">
          {event.contract_id.slice(0, 8)}…{event.contract_id.slice(-4)}
        </span>

        {/* Ledger */}
        <span className="text-[11px] text-slate-500 flex-shrink-0">
          {formatLedger(event.ledger)}
        </span>

        {/* Timestamp */}
        <span className="ml-auto flex-shrink-0 text-[10px] text-slate-600">
          {relativeTime(event.ledger_closed_at)}
        </span>

        {/* Expand indicator */}
        <span className="flex-shrink-0 text-slate-600 text-[10px]">
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded data */}
      {expanded && (
        <pre className="mt-2 rounded-lg bg-slate-900 p-3 text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
          {parsedData}
        </pre>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function EventsPanel({
  wsUrl = DEFAULT_WS_URL,
  restUrl,
  contractId,
  eventType,
  maxEvents = 200,
  className = "",
}: EventsPanelProps) {
  const { events, status, droppedCount, clearEvents, reconnect } = useEventStream({
    url: wsUrl,
    contractId,
    eventType,
    fallbackRestUrl: restUrl,
    pollIntervalMs: 5000,
  });

  // Keep the list capped at maxEvents.
  const capped = useMemo(
    () => (events.length > maxEvents ? events.slice(-maxEvents) : events),
    [events, maxEvents],
  );

  // Auto-scroll to bottom on new events.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [capped.length, autoScroll]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    setAutoScroll(atBottom);
  }, []);

  return (
    <div className={`flex flex-col rounded-xl border border-white/10 bg-slate-950 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 bg-slate-900">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300 uppercase tracking-wider">
          <Activity size={13} />
          <span>Live Events</span>
          {capped.length > 0 && (
            <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
              {capped.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ConnectionBadge
            status={status}
            droppedCount={droppedCount}
            onReconnect={reconnect}
          />
          <button
            onClick={clearEvents}
            title="Clear events"
            className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition"
            type="button"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Event list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-[200px] max-h-[360px]"
      >
        {capped.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-600 italic">
            {status === "connecting" || status === "reconnecting"
              ? "Connecting to event stream…"
              : "No events yet. Waiting for on-chain activity."}
          </p>
        ) : (
          capped.map((event) => <EventRow key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}
