/// <reference lib="webworker" />

import { scValToNative, xdr } from "@stellar/stellar-sdk";

/**
 * eventStream.worker.ts
 *
 * A dedicated Web Worker that owns the WebSocket connection to the indexer's
 * /ws/events endpoint. Modelled after consoleStream.worker.ts — uses a
 * SharedArrayBuffer ring buffer when available, falls back to postMessage.
 *
 * Reconnection with exponential backoff is handled here so the main thread
 * stays free.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type WsEvent =
  | {
      type: "event";
      id: string;
      contract_id: string;
      ledger: number;
      ledger_closed_at: string;
      event_type: string;
      data: string;
      topics?: unknown[] | string;
      topic?: unknown[] | string;
      raw_xdr?: string | null;
      ledger_sequence?: number;
    }
  | {
      type: "quorum_update";
      id: string;
      quorum_type: string;
      state: string;
      strategy: string;
      threshold: number;
      target_id?: string;
      created_at: string;
      expires_at: string;
    };

type ServerMessage =
  | { type: "event"; payload: WsEvent & { type: "event" } }
  | { type: "quorum_update"; payload: WsEvent & { type: "quorum_update" } }
  | { type: "ping"; ts: number }
  | { type: "lagged"; count: number }
  | { type: "error"; message: string };

type IncomingWorkerMessage =
  | {
      type: "init";
      headerBuffer?: SharedArrayBuffer;
      dataBuffer?: SharedArrayBuffer;
    }
  | { type: "connect"; url: string }
  | { type: "disconnect" }
  | { type: "decode_events"; payload: WsEvent[] }
  | { type: "set_filter"; contractId?: string; eventType?: string };

type OutgoingWorkerMessage =
  | { type: "status"; message: string }
  | { type: "fallback_events"; payload: WsEvent[] }
  | { type: "connected" }
  | { type: "disconnected"; code: number };

// ── Ring buffer constants ─────────────────────────────────────────────────────
// Mirrors the layout used by consoleStream.worker.ts / consoleRingBuffer utils.
// We store serialised WsEvent JSON strings in the ring.

const MESSAGE_HEADER_BYTES = 4; // u32 payload length prefix
const RING_CAPACITY = 1024 * 1024; // 1 MiB
const MAX_ENTRY_BYTES = 65_536; // 64 KiB per event

// Header slot indices (Int32Array).
const IDX_READ = 0;
const IDX_WRITE = 1;
const IDX_DROPPED = 2;
const IDX_SEQ = 3;

// ── State ─────────────────────────────────────────────────────────────────────

let headerView: Int32Array | null = null;
let dataView: Uint8Array | null = null;
let fallbackMode = true;

let socket: WebSocket | null = null;
let currentUrl: string | null = null;
let shouldReconnect = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── Helpers ───────────────────────────────────────────────────────────────────

function post(msg: OutgoingWorkerMessage): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

function postStatus(message: string): void {
  post({ type: "status", message });
}

function writeUint32(view: Uint8Array, offset: number, value: number): void {
  const o = offset % view.length;
  view[o] = (value >>> 24) & 0xff;
  view[(o + 1) % view.length] = (value >>> 16) & 0xff;
  view[(o + 2) % view.length] = (value >>> 8) & 0xff;
  view[(o + 3) % view.length] = value & 0xff;
}

function writeBytes(view: Uint8Array, offset: number, bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    view[(offset + i) % view.length] = bytes[i];
  }
}

function writeEventToRing(event: WsEvent): void {
  if (!headerView || !dataView) return;

  const json = JSON.stringify(event);
  const encoded = encoder.encode(json);

  if (encoded.length > MAX_ENTRY_BYTES) {
    Atomics.add(headerView, IDX_DROPPED, 1);
    return;
  }

  const required = MESSAGE_HEADER_BYTES + encoded.length;
  if (required >= RING_CAPACITY) {
    Atomics.add(headerView, IDX_DROPPED, 1);
    return;
  }

  const writeCursor = Atomics.load(headerView, IDX_WRITE);
  const readCursor = Atomics.load(headerView, IDX_READ);
  const free = RING_CAPACITY - (writeCursor - readCursor);

  if (free < required) {
    Atomics.add(headerView, IDX_DROPPED, 1);
    return;
  }

  const writeOffset = writeCursor % RING_CAPACITY;
  writeUint32(dataView, writeOffset, encoded.length);
  writeBytes(
    dataView,
    (writeOffset + MESSAGE_HEADER_BYTES) % RING_CAPACITY,
    encoded,
  );
  Atomics.store(headerView, IDX_WRITE, writeCursor + required);
  Atomics.add(headerView, IDX_SEQ, 1);
}

function emitEvents(events: WsEvent[]): void {
  if (events.length === 0) return;

  const decodedEvents = events.map(decodeEvent);

  if (fallbackMode) {
    post({ type: "fallback_events", payload: decodedEvents });
    return;
  }

  for (const event of decodedEvents) {
    writeEventToRing(event);
  }
}

function decodeScVal(
  value: string,
): { decoded: true; value: unknown } | { decoded: false; value: string } {
  try {
    return {
      decoded: true,
      value: scValToNative(xdr.ScVal.fromXDR(value, "base64")),
    };
  } catch {
    return { decoded: false, value };
  }
}

function decodeTopics(topics: unknown): unknown[] | undefined {
  let values = topics;
  if (typeof values === "string") {
    try {
      values = JSON.parse(values) as unknown;
    } catch {
      values = [values];
    }
  }
  if (!Array.isArray(values)) return undefined;
  return values.map((topic) => {
    if (typeof topic !== "string") return topic;
    const result = decodeScVal(topic);
    return result.decoded ? result.value : topic;
  });
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return (
      JSON.stringify(value, (_key, nestedValue: unknown) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

function decodeEvent(event: WsEvent): WsEvent {
  if (event.type !== "event") return event;

  const decodedTopics = decodeTopics(event.topics ?? event.topic);
  const rawData = event.raw_xdr ?? event.data;
  const decodedData = decodeScVal(rawData);

  return {
    ...event,
    ...(decodedTopics ? { topics: decodedTopics } : {}),
    ...(decodedData.decoded
      ? { data: serializeValue(decodedData.value) }
      : {}),
  };
}

// ── Reconnection with exponential backoff ─────────────────────────────────────

function scheduleReconnect(): void {
  if (!shouldReconnect || !currentUrl) return;

  const baseMs = 1000;
  const capMs = 30_000;
  const delay = Math.min(capMs, baseMs * 2 ** reconnectAttempt);
  reconnectAttempt++;

  postStatus(`Reconnecting in ${delay}ms (attempt ${reconnectAttempt})…`);

  reconnectTimer = setTimeout(() => {
    if (shouldReconnect && currentUrl) {
      openSocket(currentUrl);
    }
  }, delay);
}

function cancelReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ── WebSocket lifecycle ────────────────────────────────────────────────────────

function closeSocket(): void {
  cancelReconnect();
  if (!socket) return;
  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  socket.close();
  socket = null;
}

function openSocket(url: string): void {
  closeSocket();

  try {
    socket = new WebSocket(url);

    socket.onopen = () => {
      reconnectAttempt = 0;
      postStatus(`Connected to ${url}`);
      post({ type: "connected" });
    };

    socket.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;

      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "event":
          emitEvents([msg.payload]);
          break;

        case "quorum_update":
          emitEvents([msg.payload]);
          break;

        case "ping":
          // Respond with pong to keep the connection alive.
          socket?.send(JSON.stringify({ type: "pong" }));
          break;

        case "lagged":
          postStatus(
            `Stream lagged — missed ${msg.count} event(s). Consider a REST sync.`,
          );
          break;

        case "error":
          postStatus(`Server error: ${msg.message}`);
          break;
      }
    };

    socket.onclose = (ev: CloseEvent) => {
      postStatus(`Disconnected (code ${ev.code})`);
      post({ type: "disconnected", code: ev.code });
      socket = null;

      // Reconnect unless the worker was explicitly disconnected (shouldReconnect = false).
      if (shouldReconnect) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      postStatus("WebSocket error");
      // onclose fires after onerror; reconnect logic lives there.
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    postStatus(`Failed to open socket: ${msg}`);
    if (shouldReconnect) {
      scheduleReconnect();
    }
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

(self as DedicatedWorkerGlobalScope).onmessage = (
  ev: MessageEvent<IncomingWorkerMessage>,
) => {
  const msg = ev.data;

  switch (msg.type) {
    case "init": {
      if (msg.headerBuffer && msg.dataBuffer) {
        headerView = new Int32Array(msg.headerBuffer);
        dataView = new Uint8Array(msg.dataBuffer);
        fallbackMode = false;
      } else {
        headerView = null;
        dataView = null;
        fallbackMode = true;
      }
      break;
    }

    case "connect": {
      currentUrl = msg.url;
      shouldReconnect = true;
      reconnectAttempt = 0;
      openSocket(msg.url);
      break;
    }

    case "disconnect": {
      shouldReconnect = false;
      currentUrl = null;
      reconnectAttempt = 0;
      closeSocket();
      break;
    }

    case "decode_events": {
      post({
        type: "fallback_events",
        payload: msg.payload.map(decodeEvent),
      });
      break;
    }

    case "set_filter": {
      // Filters are applied on the main thread (in useEventStream).
      // This message is a no-op in the worker but kept for future server-side filtering.
      postStatus(
        `Filter hint received: contract=${msg.contractId ?? "*"} type=${msg.eventType ?? "*"}`,
      );
      break;
    }
  }
};

(self as DedicatedWorkerGlobalScope).addEventListener("close", () => {
  shouldReconnect = false;
  closeSocket();
});

export type { IncomingWorkerMessage, OutgoingWorkerMessage };
