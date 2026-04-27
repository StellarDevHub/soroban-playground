"use client";

/**
 * useEventStream
 *
 * React hook that maintains a WebSocket connection to the indexer's
 * /ws/events endpoint via a dedicated Web Worker (eventStream.worker.ts).
 *
 * Architecture mirrors useConsoleStream:
 *  - Worker owns the WebSocket and the ring buffer write side.
 *  - Hook drains the ring buffer on every animation frame (main thread).
 *  - Falls back to REST polling when the WebSocket is unavailable or
 *    after max reconnection attempts.
 *
 * Usage:
 *   const { events, status, clearEvents } = useEventStream({
 *     url: "ws://localhost:3001/ws/events",
 *     contractId: "CABC...",        // optional — filters in JS
 *     fallbackRestUrl: "/api/events",
 *   });
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsEvent } from "@/workers/eventStream.worker";

// ── Ring buffer constants — must match eventStream.worker.ts ──────────────────

const RING_CAPACITY = 1024 * 1024; // 1 MiB
const MESSAGE_HEADER_BYTES = 4;
const MAX_ENTRY_BYTES = 65_536;
const MAX_EVENTS_PER_FLUSH = 500;
const MAX_RENDERED_EVENTS = 2000;

const IDX_READ = 0;
const IDX_WRITE = 1;
const IDX_DROPPED = 2;

// ── Public API ────────────────────────────────────────────────────────────────

export type EventStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "fallback"
  | "error";

export interface EventStreamOptions {
  /** Full WebSocket URL, e.g. "ws://localhost:3001/ws/events" */
  url: string;
  /** Optional: only surface events matching this contract_id */
  contractId?: string;
  /** Optional: only surface events matching this event_type */
  eventType?: string;
  /** REST endpoint to poll when WebSocket is unavailable */
  fallbackRestUrl?: string;
  /** Polling interval in ms (default 5000) */
  pollIntervalMs?: number;
  /** Skip connecting automatically on mount (default false) */
  disabled?: boolean;
}

export interface EventStreamResult {
  events: WsEvent[];
  status: EventStreamStatus;
  droppedCount: number;
  clearEvents: () => void;
  reconnect: () => void;
}

// ── Internal ring-read helpers ────────────────────────────────────────────────

function readUint32(view: Uint8Array, offset: number): number {
  const o = offset % view.length;
  return (
    (view[o] << 24) |
    (view[(o + 1) % view.length] << 16) |
    (view[(o + 2) % view.length] << 8) |
    view[(o + 3) % view.length]
  );
}

function readBytes(view: Uint8Array, offset: number, length: number): Uint8Array {
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = view[(offset + i) % view.length];
  }
  return result;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEventStream(options: EventStreamOptions): EventStreamResult {
  const {
    url,
    contractId,
    eventType,
    fallbackRestUrl,
    pollIntervalMs = 5000,
    disabled = false,
  } = options;

  const [events, setEvents] = useState<WsEvent[]>([]);
  const [status, setStatus] = useState<EventStreamStatus>("idle");
  const [droppedCount, setDroppedCount] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const headerRef = useRef<Int32Array | null>(null);
  const ringRef = useRef<Uint8Array | null>(null);
  const frameRef = useRef<number | null>(null);
  const decoderRef = useRef(new TextDecoder());

  // Keep filter refs fresh without restarting the worker.
  const contractIdRef = useRef(contractId);
  const eventTypeRef = useRef(eventType);
  useEffect(() => { contractIdRef.current = contractId; }, [contractId]);
  useEffect(() => { eventTypeRef.current = eventType; }, [eventType]);

  // ── Event appender ──────────────────────────────────────────────────────────

  const appendEvents = useCallback((incoming: WsEvent[]) => {
    if (incoming.length === 0) return;

    // Apply client-side filter.
    const filtered = incoming.filter((e) => {
      if (e.type === "quorum_update") return true; // Always show quorum updates
      if (contractIdRef.current && e.contract_id !== contractIdRef.current) return false;
      if (eventTypeRef.current && e.event_type !== eventTypeRef.current) return false;
      return true;
    });

    if (filtered.length === 0) return;

    setEvents((prev) => {
      const combined = [...prev, ...filtered];
      return combined.length > MAX_RENDERED_EVENTS
        ? combined.slice(combined.length - MAX_RENDERED_EVENTS)
        : combined;
    });
  }, []);

  // ── Ring buffer drain (runs on every animation frame) ───────────────────────

  const drainRing = useCallback(() => {
    const header = headerRef.current;
    const ring = ringRef.current;
    if (!header || !ring) return;

    let readCursor = Atomics.load(header, IDX_READ);
    const writeCursor = Atomics.load(header, IDX_WRITE);

    if (writeCursor <= readCursor) {
      const dropped = Atomics.exchange(header, IDX_DROPPED, 0);
      if (dropped > 0) setDroppedCount((p) => p + dropped);
      return;
    }

    const parsed: WsEvent[] = [];

    for (let i = 0; i < MAX_EVENTS_PER_FLUSH; i++) {
      const available = writeCursor - readCursor;
      if (available < MESSAGE_HEADER_BYTES) break;

      const lenOffset = readCursor % RING_CAPACITY;
      const payloadLen = readUint32(ring, lenOffset);

      if (payloadLen > MAX_ENTRY_BYTES) {
        readCursor = writeCursor;
        break;
      }

      if (available < MESSAGE_HEADER_BYTES + payloadLen) break;

      const payloadOffset = (lenOffset + MESSAGE_HEADER_BYTES) % RING_CAPACITY;
      const bytes = readBytes(ring, payloadOffset, payloadLen);
      const json = decoderRef.current.decode(bytes);

      try {
        parsed.push(JSON.parse(json) as WsEvent);
      } catch {
        // skip malformed entries
      }

      readCursor += MESSAGE_HEADER_BYTES + payloadLen;
      if (readCursor >= writeCursor) break;
    }

    Atomics.store(header, IDX_READ, readCursor);
    const dropped = Atomics.exchange(header, IDX_DROPPED, 0);
    if (dropped > 0) setDroppedCount((p) => p + dropped);

    appendEvents(parsed);
  }, [appendEvents]);

  // ── REST fallback polling ───────────────────────────────────────────────────

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback(() => {
    if (!fallbackRestUrl || pollRef.current) return;
    setStatus("fallback");

    pollRef.current = setInterval(async () => {
      try {
        const params = new URLSearchParams();
        if (contractId) params.set("contract_id", contractId);
        if (eventType) params.set("event_type", eventType);
        const res = await fetch(`${fallbackRestUrl}?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { events?: WsEvent[] };
        if (data.events) appendEvents(data.events);
      } catch {
        // Silently retry on next interval.
      }
    }, pollIntervalMs);
  }, [fallbackRestUrl, contractId, eventType, pollIntervalMs, appendEvents]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Worker setup ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (disabled || typeof window === "undefined") return;

    let disposed = false;

    const worker = new Worker(
      new URL("../workers/eventStream.worker.ts", import.meta.url),
      { type: "module", name: "event-stream-worker" },
    );

    workerRef.current = worker;
    setStatus("connecting");

    const supportsSharedMemory = typeof SharedArrayBuffer !== "undefined";

    if (supportsSharedMemory) {
      const headerBuf = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
      const dataBuf = new SharedArrayBuffer(RING_CAPACITY);
      headerRef.current = new Int32Array(headerBuf);
      ringRef.current = new Uint8Array(dataBuf);
      worker.postMessage({ type: "init", headerBuffer: headerBuf, dataBuffer: dataBuf });
    } else {
      worker.postMessage({ type: "init" });
    }

    // Send the connect command.
    worker.postMessage({ type: "connect", url });

    // Handle worker messages.
    worker.onmessage = (ev: MessageEvent) => {
      if (disposed) return;
      const msg = ev.data as { type: string; payload?: WsEvent[]; message?: string; code?: number };

      switch (msg.type) {
        case "connected":
          stopPolling();
          setStatus("connected");
          break;

        case "disconnected":
          setStatus("reconnecting");
          // If the worker exhausted reconnect attempts (code 1006 = abnormal closure
          // after many retries), fall back to REST.
          if (fallbackRestUrl) startPolling();
          break;

        case "fallback_events":
          if (msg.payload) appendEvents(msg.payload);
          break;

        case "status":
          // Worker debug messages — surfaced only in development.
          if (process.env.NODE_ENV === "development") {
            console.debug("[event-stream-worker]", msg.message);
          }
          break;
      }
    };

    // Animation frame drain loop.
    const tick = () => {
      if (disposed) return;
      drainRing();
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      stopPolling();
      worker.postMessage({ type: "disconnect" });
      worker.terminate();
      workerRef.current = null;
      headerRef.current = null;
      ringRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, disabled]); // Only restart the worker when url or disabled changes.

  // ── Public controls ─────────────────────────────────────────────────────────

  const clearEvents = useCallback(() => {
    setEvents([]);
    setDroppedCount(0);
  }, []);

  const reconnect = useCallback(() => {
    stopPolling();
    setStatus("connecting");
    workerRef.current?.postMessage({ type: "connect", url });
  }, [url, stopPolling]);

  return { events, status, droppedCount, clearEvents, reconnect };
}
