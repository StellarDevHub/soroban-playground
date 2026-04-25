import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PauseCircle, PlayCircle, Terminal, TriangleAlert } from "lucide-react";

interface ConsoleProps {
  logs: string[];
  baseLineNumber: number;
  droppedMessages: number;
  isIngestionPaused: boolean;
  onIngestionPauseChange: (paused: boolean) => void;
}

const ROW_HEIGHT = 24;
const OVERSCAN_ROWS = 8;
const BOTTOM_ANCHOR_THRESHOLD = 36;

export default function Console({
  logs,
  baseLineNumber,
  droppedMessages,
  isIngestionPaused,
  onIngestionPauseChange,
}: ConsoleProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = logs.length * ROW_HEIGHT;

  const { startIndex, endIndex } = useMemo(() => {
    if (logs.length === 0) {
      return { startIndex: 0, endIndex: 0 };
    }

    const safeHeight = viewportHeight > 0 ? viewportHeight : ROW_HEIGHT * 8;
    const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
    const start = Math.max(0, firstVisible - OVERSCAN_ROWS);
    const rowsOnScreen = Math.ceil(safeHeight / ROW_HEIGHT);
    const end = Math.min(logs.length, start + rowsOnScreen + OVERSCAN_ROWS * 2);

    return {
      startIndex: start,
      endIndex: end,
    };
  }, [logs.length, scrollTop, viewportHeight]);

  const visibleRows = useMemo(() => logs.slice(startIndex, endIndex), [endIndex, logs, startIndex]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });

    observer.observe(viewport);
    setViewportHeight(viewport.clientHeight);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isIngestionPaused) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
    setScrollTop(viewport.scrollTop);
  }, [isIngestionPaused, logs.length]);

  const handleResume = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
      setScrollTop(viewport.scrollTop);
    }

    onIngestionPauseChange(false);
  }, [onIngestionPauseChange]);

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const viewport = event.currentTarget;
      setScrollTop(viewport.scrollTop);

      const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      const shouldPause = distanceFromBottom > BOTTOM_ANCHOR_THRESHOLD;

      if (shouldPause !== isIngestionPaused) {
        onIngestionPauseChange(shouldPause);
      }
    },
    [isIngestionPaused, onIngestionPauseChange],
  );

  return (
    <div className="flex flex-col h-72 bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow-inner">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 rounded-t-xl text-xs text-gray-400 font-medium tracking-wider uppercase">
        <div className="flex items-center space-x-2">
          <Terminal size={14} />
          <span>Console Output</span>
        </div>

        <div className="flex items-center gap-3 normal-case tracking-normal font-normal text-[11px]">
          {droppedMessages > 0 ? (
            <div className="inline-flex items-center gap-1 text-amber-400">
              <TriangleAlert size={13} />
              <span>{droppedMessages.toLocaleString()} dropped</span>
            </div>
          ) : null}

          {isIngestionPaused ? (
            <button
              type="button"
              onClick={handleResume}
              className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 transition"
            >
              <PlayCircle size={13} />
              Resume
            </button>
          ) : (
            <div className="inline-flex items-center gap-1 text-emerald-400">
              <PauseCircle size={13} className="opacity-60" />
              Live
            </div>
          )}
        </div>
      </div>

      <div
        ref={viewportRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto font-mono text-xs leading-6 text-gray-300"
      >
        {logs.length === 0 ? (
          <p className="px-4 py-3 text-gray-600 italic">No output yet. Compile or deploy to see logs.</p>
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            {visibleRows.map((line, index) => {
              const absoluteIndex = startIndex + index;
              const lineNumber = baseLineNumber + absoluteIndex + 1;

              return (
                <div
                  key={`${lineNumber}-${absoluteIndex}`}
                  className="absolute left-0 right-0 px-4 flex items-center gap-3"
                  style={{ top: absoluteIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <span className="text-cyan-500 min-w-[56px] text-right">{String(lineNumber).padStart(6, "0")}</span>
                  <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{line}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
