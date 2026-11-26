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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Trash2 } from "lucide-react";
import {
  List,
  type RowComponentProps,
  useListRef,
} from "react-window";
import { useEventStream } from "@/hooks/useEventStream";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import type { WsEvent } from "@/workers/eventStream.worker";

// ── Props ─────────────────────────────────────────────────────────────────────

interface EventsPanelProps {
  wsUrl?: string;
  restUrl?: string;
  contractId?: string;
  eventType?: string;
  /** Maximum retained visible events (default 10,000) */
  maxEvents?: number;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the event stream endpoint lazily.
 *
 * #1369 — reading `window.location` at module scope is evaluated once, when the
 * module is first imported. On the server that happens before any request context
 * exists, so the resolved value (`localhost`) would be baked into the client bundle
 * and a user served from any other host would try to connect to their own machine.
 * Resolving per render keeps the server and the client in agreement and lets the
 * real hostname win in the browser.
 */
function resolveDefaultWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001/ws/events";
  return `ws://${window.location.hostname}:3001/ws/events`;
}

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
  transfer: "bg-blue-500/20 text-blue-300 border-blue-700/40",
  mint: "bg-green-500/20 text-green-300 border-green-700/40",
  burn: "bg-red-500/20 text-red-300 border-red-700/40",
  swap: "bg-purple-500/20 text-purple-300 border-purple-700/40",
  invoke: "bg-amber-500/20 text-amber-300 border-amber-700/40",
  deploy: "bg-cyan-500/20 text-cyan-300 border-cyan-700/40",
};

function eventTypeClass(type: string): string {
  return (
    EVENT_TYPE_COLORS[type.toLowerCase()] ??
    "bg-slate-700/40 text-slate-300 border-slate-600/40"
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

interface EventRowProps {
  events: WsEvent[];
  expandedEventId: string | null;
  onToggle: (eventId: string) => void;
}

function EventRow({
  index,
  style,
  events,
  expandedEventId,
  onToggle,
}: RowComponentProps<EventRowProps>) {
  const event = events[index];
  const parsedData = useMemo(() => {
    if (!event) return "";
    if (event.type === "quorum_update") {
      return JSON.stringify(event, null, 2);
    }
    let data: unknown;
    try {
      data = JSON.parse(event.data || "{}");
    } catch {
      data = event.data || "";
    }
    return JSON.stringify(
      event.topics ? { topics: event.topics, data } : data,
      null,
      2,
    );
  }, [event]);
  if (!event) return null;
  const expanded = event.id === expandedEventId;

  const eventType =
    event.type === "event"
      ? event.event_type || "unknown"
      : event.type || "unknown";
  const contractId =
    event.type === "event" ? event.contract_id || "" : event.id || "";
  const ledger = event.type === "event" ? event.ledger || 0 : 0;
  const timestamp =
    event.type === "event"
      ? event.ledger_closed_at || new Date().toISOString()
      : event.created_at || new Date().toISOString();

  return (
    <div
      style={style}
      className="group border-b border-white/5 px-4 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
      onClick={() => onToggle(event.id)}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Event type badge */}
        <span
          className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${eventTypeClass(eventType)}`}
        >
          {eventType}
        </span>

        {/* Contract ID (truncated) */}
        <span className="font-mono text-[11px] text-slate-400 truncate max-w-[130px]">
          {contractId.slice(0, 8)}…{contractId.slice(-4)}
        </span>

        {/* Ledger */}
        <span className="text-[11px] text-slate-500 flex-shrink-0">
          {ledger > 0 ? formatLedger(ledger) : "System"}
        </span>

        {/* Timestamp */}
        <span className="ml-auto flex-shrink-0 text-[10px] text-slate-600">
          {relativeTime(timestamp)}
        </span>

        {/* Expand indicator */}
        <span className="flex-shrink-0 text-slate-600 text-[10px]">
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded data */}
      {expanded && (
        <pre className="mt-2 max-h-[108px] rounded-lg bg-slate-900 p-3 text-[11px] text-slate-300 overflow-auto whitespace-pre-wrap break-all">
          {parsedData}
        </pre>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function EventsPanel({
  wsUrl,
  restUrl,
  contractId,
  eventType,
  maxEvents = 10_000,
  className = "",
}: EventsPanelProps) {
  // Resolved once per render, but only ever *read* inside the stream hook's
  // effect, so the browser hostname is used and the server render stays inert.
  const resolvedWsUrl = useMemo(() => wsUrl ?? resolveDefaultWsUrl(), [wsUrl]);

  const { events, status, droppedCount, clearEvents, reconnect } =
    useEventStream({
      url: resolvedWsUrl,
      fallbackRestUrl: restUrl,
      pollIntervalMs: 5000,
    });

  const [contractFilter, setContractFilter] = useState(contractId ?? "");
  const [topicFilter, setTopicFilter] = useState("");
  const [startLedger, setStartLedger] = useState("");
  const [endLedger, setEndLedger] = useState("");
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  useEffect(() => {
    setContractFilter(contractId ?? "");
  }, [contractId]);

  const capped = useMemo(
    () => (events.length > maxEvents ? events.slice(-maxEvents) : events),
    [events, maxEvents],
  );

  const filteredEvents = useMemo(() => {
    const contract = contractFilter.trim().toLowerCase();
    const topic = topicFilter.trim().toLowerCase();
    const from = startLedger === "" ? undefined : Number(startLedger);
    const to = endLedger === "" ? undefined : Number(endLedger);

    return capped.filter((event) => {
      if (event.type !== "event") return true;
      if (contract && !event.contract_id.toLowerCase().includes(contract)) {
        return false;
      }
      if (eventType && event.event_type !== eventType) return false;
      if (
        topic &&
        !(
          Array.isArray(event.topics) &&
          event.topics.some(
            (value) =>
              typeof value === "string" && value.toLowerCase() === topic,
          )
        )
      ) {
        return false;
      }
      const ledger = event.ledger_sequence ?? event.ledger;
      if (from !== undefined && Number.isFinite(from) && ledger < from) {
        return false;
      }
      if (to !== undefined && Number.isFinite(to) && ledger > to) {
        return false;
      }
      return true;
    });
  }, [capped, contractFilter, endLedger, eventType, startLedger, topicFilter]);

  const listRef = useListRef();
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll || filteredEvents.length === 0) return;
    listRef.current?.scrollToRow({
      index: filteredEvents.length - 1,
      align: "end",
    });
  }, [autoScroll, filteredEvents.length]);

  const handleRowsRendered = useCallback(
    ({ stopIndex }: { stopIndex: number }) => {
      setAutoScroll(stopIndex >= filteredEvents.length - 1);
    },
    [filteredEvents.length],
  );

  const eventRowProps = useMemo(
    () => ({
      events: filteredEvents,
      expandedEventId,
      onToggle: (eventId: string) =>
        setExpandedEventId((current) =>
          current === eventId ? null : eventId,
        ),
    }),
    [expandedEventId, filteredEvents],
  );

  const rowHeight = useCallback(
    (index: number) =>
      filteredEvents[index]?.id === expandedEventId ? 184 : 48,
    [expandedEventId, filteredEvents],
  );

  return (
    <div
      className={`flex flex-col rounded-xl border border-white/10 bg-slate-950 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 bg-slate-900">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300 uppercase tracking-wider">
          <Activity size={13} />
          <span>Live Events</span>
          {filteredEvents.length > 0 && (
            <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
              {filteredEvents.length.toLocaleString()}
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

      <div className="grid grid-cols-2 gap-2 border-b border-white/5 bg-slate-950 px-3 py-2 sm:grid-cols-4">
        <input
          aria-label="Filter by contract ID"
          className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600"
          onChange={(event) => setContractFilter(event.target.value)}
          placeholder="Contract ID"
          value={contractFilter}
        />
        <input
          aria-label="Filter by event topic"
          className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600"
          onChange={(event) => setTopicFilter(event.target.value)}
          placeholder="Topic symbol"
          value={topicFilter}
        />
        <input
          aria-label="Filter from ledger"
          className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600"
          min="0"
          onChange={(event) => setStartLedger(event.target.value)}
          placeholder="From ledger"
          type="number"
          value={startLedger}
        />
        <input
          aria-label="Filter to ledger"
          className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600"
          min="0"
          onChange={(event) => setEndLedger(event.target.value)}
          placeholder="To ledger"
          type="number"
          value={endLedger}
        />
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-[200px] max-h-[360px]">
        {status === "error" ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-[13px] text-rose-400 mb-2">
              Failed to connect to the event stream.
            </p>
            <button
              onClick={reconnect}
              className="px-3 py-1 text-xs font-semibold rounded bg-rose-500/20 text-rose-300 border border-rose-700/40 hover:bg-rose-500/30 transition-colors"
              type="button"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredEvents.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-600 italic">
            {status === "connecting" || status === "reconnecting"
              ? "Connecting to event stream…"
              : status === "fallback"
                ? "WebSocket disconnected. Polling for events…"
                : "No events yet. Waiting for on-chain activity."}
          </p>
        ) : (
          <div className="h-[360px] min-h-[200px]">
            {status === "fallback" && (
              <div className="px-4 py-1.5 text-[10px] text-center text-blue-300 bg-blue-500/10 border-b border-white/5">
                WebSocket disconnected. Falling back to REST polling.
              </div>
            )}
            <List
              listRef={listRef}
              onRowsRendered={handleRowsRendered}
              defaultHeight={360}
              overscanCount={5}
              rowComponent={EventRow}
              rowCount={filteredEvents.length}
              rowHeight={rowHeight}
              rowProps={eventRowProps}
              style={{ height: 360 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
