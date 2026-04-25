"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONSOLE_RING_DEFAULT_CAPACITY,
  CONSOLE_RING_HEADER_INTS,
  CONSOLE_RING_MAX_ENTRY_BYTES,
  ConsoleRingHeaderIndex,
  readBytesWrapped,
  readUint32Wrapped,
} from "@/utils/consoleRingBuffer";

const MESSAGE_HEADER_BYTES = 4;
const MAX_MESSAGES_PER_FLUSH = 1500;
const MAX_RENDERED_LOGS = 6000;

interface StreamState {
  lines: string[];
  baseLineNumber: number;
}

interface WorkerStatusMessage {
  type: "status";
  message: string;
}

interface WorkerFallbackLinesMessage {
  type: "fallback_lines";
  payload: string[];
}

type WorkerMessage = WorkerStatusMessage | WorkerFallbackLinesMessage;

interface ConsoleStreamApi {
  logs: string[];
  baseLineNumber: number;
  droppedMessages: number;
  isIngestionPaused: boolean;
  setIngestionPaused: (paused: boolean) => void;
  appendLog: (line: string) => void;
  appendLogs: (lines: string[]) => void;
  clearLogs: () => void;
  connectSocket: (url: string, protocols?: string[]) => void;
  disconnectSocket: () => void;
}

function appendToRenderState(prev: StreamState, lines: string[]): StreamState {
  if (lines.length === 0) {
    return prev;
  }

  const totalLength = prev.lines.length + lines.length;

  if (totalLength <= MAX_RENDERED_LOGS) {
    return {
      lines: prev.lines.concat(lines),
      baseLineNumber: prev.baseLineNumber,
    };
  }

  const overflow = totalLength - MAX_RENDERED_LOGS;

  if (overflow >= prev.lines.length) {
    const kept = lines.slice(-MAX_RENDERED_LOGS);
    const droppedFromPrev = prev.lines.length;
    const droppedFromBatch = lines.length - kept.length;

    return {
      lines: kept,
      baseLineNumber: prev.baseLineNumber + droppedFromPrev + droppedFromBatch,
    };
  }

  return {
    lines: prev.lines.slice(overflow).concat(lines),
    baseLineNumber: prev.baseLineNumber + overflow,
  };
}

export function useConsoleStream(): ConsoleStreamApi {
  const [streamState, setStreamState] = useState<StreamState>({ lines: [], baseLineNumber: 0 });
  const [droppedMessages, setDroppedMessages] = useState(0);
  const [isIngestionPaused, setIsIngestionPaused] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const headerRef = useRef<Int32Array | null>(null);
  const ringRef = useRef<Uint8Array | null>(null);
  const frameRef = useRef<number | null>(null);
  const pauseRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());

  useEffect(() => {
    pauseRef.current = isIngestionPaused;
  }, [isIngestionPaused]);

  const appendRenderedLines = useCallback((lines: string[]) => {
    if (lines.length === 0) {
      return;
    }

    setStreamState((prev) => appendToRenderState(prev, lines));
  }, []);

  const drainRingBuffer = useCallback(() => {
    const header = headerRef.current;
    const ring = ringRef.current;

    if (!header || !ring || pauseRef.current) {
      return;
    }

    let readCursor = Atomics.load(header, ConsoleRingHeaderIndex.READ_CURSOR);
    const writeCursor = Atomics.load(header, ConsoleRingHeaderIndex.WRITE_CURSOR);

    if (writeCursor <= readCursor) {
      const droppedNow = Atomics.exchange(header, ConsoleRingHeaderIndex.DROPPED_MESSAGES, 0);

      if (droppedNow > 0) {
        setDroppedMessages((prev) => prev + droppedNow);
      }

      return;
    }

    const lines: string[] = [];

    for (let count = 0; count < MAX_MESSAGES_PER_FLUSH; count += 1) {
      const availableBytes = writeCursor - readCursor;

      if (availableBytes < MESSAGE_HEADER_BYTES) {
        break;
      }

      const lengthOffset = readCursor % ring.length;
      const payloadLength = readUint32Wrapped(ring, lengthOffset);

      if (payloadLength > CONSOLE_RING_MAX_ENTRY_BYTES) {
        readCursor = writeCursor;
        break;
      }

      if (availableBytes < MESSAGE_HEADER_BYTES + payloadLength) {
        break;
      }

      const payloadOffset = (lengthOffset + MESSAGE_HEADER_BYTES) % ring.length;
      const payloadBytes = readBytesWrapped(ring, payloadOffset, payloadLength);
      lines.push(decoderRef.current.decode(payloadBytes));

      readCursor += MESSAGE_HEADER_BYTES + payloadLength;

      if (readCursor >= writeCursor) {
        break;
      }
    }

    Atomics.store(header, ConsoleRingHeaderIndex.READ_CURSOR, readCursor);

    const droppedNow = Atomics.exchange(header, ConsoleRingHeaderIndex.DROPPED_MESSAGES, 0);
    if (droppedNow > 0) {
      setDroppedMessages((prev) => prev + droppedNow);
    }

    appendRenderedLines(lines);
  }, [appendRenderedLines]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;

    const worker = new Worker(new URL("../workers/consoleStream.worker.ts", import.meta.url), {
      type: "module",
      name: "console-stream-worker",
    });

    workerRef.current = worker;

    const supportsSharedMemory = typeof SharedArrayBuffer !== "undefined";

    if (supportsSharedMemory) {
      const headerBuffer = new SharedArrayBuffer(CONSOLE_RING_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT);
      const dataBuffer = new SharedArrayBuffer(CONSOLE_RING_DEFAULT_CAPACITY);
      headerRef.current = new Int32Array(headerBuffer);
      ringRef.current = new Uint8Array(dataBuffer);
      worker.postMessage({
        type: "init",
        headerBuffer,
        dataBuffer,
      });
    } else {
      worker.postMessage({ type: "init" });
    }

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;

      if (message.type === "status") {
        appendRenderedLines([`[worker] ${message.message}`]);
        return;
      }

      if (message.type === "fallback_lines") {
        appendRenderedLines(message.payload);
      }
    };

    const tick = () => {
      if (disposed) {
        return;
      }

      drainRingBuffer();
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      worker.postMessage({ type: "disconnect_socket" });
      worker.terminate();

      workerRef.current = null;
      headerRef.current = null;
      ringRef.current = null;
    };
  }, [appendRenderedLines, drainRingBuffer]);

  const appendLog = useCallback((line: string) => {
    if (!line) {
      return;
    }

    workerRef.current?.postMessage({ type: "enqueue", payload: line });
  }, []);

  const appendLogs = useCallback((lines: string[]) => {
    if (lines.length === 0) {
      return;
    }

    workerRef.current?.postMessage({ type: "enqueue_batch", payload: lines });
  }, []);

  const clearLogs = useCallback(() => {
    setStreamState({ lines: [], baseLineNumber: 0 });
    setDroppedMessages(0);
    workerRef.current?.postMessage({ type: "clear" });
  }, []);

  const connectSocket = useCallback((url: string, protocols?: string[]) => {
    workerRef.current?.postMessage({ type: "connect_socket", url, protocols });
  }, []);

  const disconnectSocket = useCallback(() => {
    workerRef.current?.postMessage({ type: "disconnect_socket" });
  }, []);

  return {
    logs: streamState.lines,
    baseLineNumber: streamState.baseLineNumber,
    droppedMessages,
    isIngestionPaused,
    setIngestionPaused: setIsIngestionPaused,
    appendLog,
    appendLogs,
    clearLogs,
    connectSocket,
    disconnectSocket,
  };
}
