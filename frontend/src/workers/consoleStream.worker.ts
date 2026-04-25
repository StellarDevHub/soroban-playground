/// <reference lib="webworker" />

import {
  CONSOLE_RING_MAX_ENTRY_BYTES,
  ConsoleRingHeaderIndex,
  writeBytesWrapped,
  writeUint32Wrapped,
} from "@/utils/consoleRingBuffer";

type IncomingWorkerMessage =
  | {
      type: "init";
      headerBuffer?: SharedArrayBuffer;
      dataBuffer?: SharedArrayBuffer;
    }
  | { type: "enqueue"; payload: string }
  | { type: "enqueue_batch"; payload: string[] }
  | { type: "clear" }
  | { type: "connect_socket"; url: string; protocols?: string[] }
  | { type: "disconnect_socket" };

type OutgoingWorkerMessage =
  | { type: "status"; message: string }
  | { type: "fallback_lines"; payload: string[] };

const MESSAGE_HEADER_BYTES = 4;

let headerView: Int32Array | null = null;
let dataView: Uint8Array | null = null;
let socket: WebSocket | null = null;
let fallbackMode = true;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function postStatus(message: string): void {
  (self as DedicatedWorkerGlobalScope).postMessage({
    type: "status",
    message,
  } satisfies OutgoingWorkerMessage);
}

function splitLogLines(text: string): string[] {
  if (!text) {
    return [""];
  }

  return text.replace(/\r\n/g, "\n").split("\n");
}

function writeLineToRing(line: string): void {
  if (!headerView || !dataView) {
    return;
  }

  const encoded = encoder.encode(line);

  if (encoded.length > CONSOLE_RING_MAX_ENTRY_BYTES) {
    Atomics.add(headerView, ConsoleRingHeaderIndex.DROPPED_MESSAGES, 1);
    return;
  }

  const requiredBytes = MESSAGE_HEADER_BYTES + encoded.length;
  const capacity = dataView.length;

  if (requiredBytes >= capacity) {
    Atomics.add(headerView, ConsoleRingHeaderIndex.DROPPED_MESSAGES, 1);
    return;
  }

  const writeCursor = Atomics.load(headerView, ConsoleRingHeaderIndex.WRITE_CURSOR);
  const readCursor = Atomics.load(headerView, ConsoleRingHeaderIndex.READ_CURSOR);
  const usedBytes = writeCursor - readCursor;
  const freeBytes = capacity - usedBytes;

  if (freeBytes < requiredBytes) {
    Atomics.add(headerView, ConsoleRingHeaderIndex.DROPPED_MESSAGES, 1);
    return;
  }

  const writeOffset = writeCursor % capacity;
  writeUint32Wrapped(dataView, writeOffset, encoded.length);
  writeBytesWrapped(dataView, (writeOffset + MESSAGE_HEADER_BYTES) % capacity, encoded);

  Atomics.store(headerView, ConsoleRingHeaderIndex.WRITE_CURSOR, writeCursor + requiredBytes);
  Atomics.add(headerView, ConsoleRingHeaderIndex.SEQUENCE, 1);
}

function emitLines(lines: string[]): void {
  if (lines.length === 0) {
    return;
  }

  if (fallbackMode) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "fallback_lines",
      payload: lines,
    } satisfies OutgoingWorkerMessage);
    return;
  }

  for (const line of lines) {
    writeLineToRing(line);
  }
}

function enqueueText(text: string): void {
  emitLines(splitLogLines(text));
}

function enqueueBinary(data: ArrayBuffer): void {
  const text = decoder.decode(new Uint8Array(data));
  enqueueText(text);
}

function closeSocket(): void {
  if (!socket) {
    return;
  }

  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  socket.close();
  socket = null;
}

function connectSocket(url: string, protocols?: string[]): void {
  closeSocket();

  try {
    socket = protocols && protocols.length > 0 ? new WebSocket(url, protocols) : new WebSocket(url);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      postStatus(`Socket connected: ${url}`);
    };

    socket.onclose = (event) => {
      postStatus(`Socket closed (${event.code})`);
    };

    socket.onerror = () => {
      postStatus(`Socket error: ${url}`);
    };

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        enqueueText(event.data);
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        enqueueBinary(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        event.data
          .arrayBuffer()
          .then((buffer) => enqueueBinary(buffer))
          .catch(() => {
            postStatus("Socket blob decode failed");
          });
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown socket error";
    postStatus(`Socket setup failed: ${message}`);
  }
}

(self as DedicatedWorkerGlobalScope).onmessage = (event: MessageEvent<IncomingWorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "init": {
      if (message.headerBuffer && message.dataBuffer) {
        headerView = new Int32Array(message.headerBuffer);
        dataView = new Uint8Array(message.dataBuffer);
        fallbackMode = false;
      } else {
        headerView = null;
        dataView = null;
        fallbackMode = true;
      }
      break;
    }
    case "enqueue": {
      enqueueText(message.payload);
      break;
    }
    case "enqueue_batch": {
      emitLines(
        message.payload.flatMap((line) => {
          return splitLogLines(line);
        }),
      );
      break;
    }
    case "clear": {
      if (!fallbackMode && headerView) {
        Atomics.store(headerView, ConsoleRingHeaderIndex.READ_CURSOR, 0);
        Atomics.store(headerView, ConsoleRingHeaderIndex.WRITE_CURSOR, 0);
        Atomics.store(headerView, ConsoleRingHeaderIndex.DROPPED_MESSAGES, 0);
        Atomics.add(headerView, ConsoleRingHeaderIndex.SEQUENCE, 1);
      }
      break;
    }
    case "connect_socket": {
      connectSocket(message.url, message.protocols);
      break;
    }
    case "disconnect_socket": {
      closeSocket();
      break;
    }
    default: {
      break;
    }
  }
};

(self as DedicatedWorkerGlobalScope).addEventListener("close", () => {
  closeSocket();
});

export {};
