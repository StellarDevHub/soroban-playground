"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

export type SplitDirection = "horizontal" | "vertical";

export interface SplitPaneProps {
  direction?: SplitDirection;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  storageKey?: string;
  className?: string;
  label?: string;
  step?: number;
  first: React.ReactNode;
  second: React.ReactNode;
  onSizeChange?: (size: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Adjustable, draggable split-pane container.
 *
 * - Pointer/touch dragging via a keyboard accessible `role="separator"` handle.
 * - Sizes are clamped between `minSize` and `maxSize` (and never squeeze the
 *   secondary pane out of existence).
 * - Optional `storageKey` persists the user's preferred size across reloads.
 */
export default function SplitPane({
  direction = "horizontal",
  defaultSize = 480,
  minSize = 240,
  maxSize = 1400,
  storageKey,
  className = "",
  label = "Resize panels",
  step = 16,
  first,
  second,
  onSizeChange,
}: SplitPaneProps) {
  const [size, setSize] = useState(defaultSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const originRef = useRef({ pointer: 0, size: 0, container: 0 });

  const upperBound = useCallback(
    (containerSize: number) => Math.max(minSize, Math.min(maxSize, containerSize - minSize)),
    [maxSize, minSize],
  );

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        setSize((current) => clamp(parsed, minSize, Math.max(minSize, maxSize) || current));
      }
    } catch {
      // Storage unavailable (private mode / blocked cookies) — keep defaults.
    }
  }, [storageKey, minSize, maxSize]);

  const persist = useCallback(
    (next: number) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, String(Math.round(next)));
      } catch {
        // Ignore quota / privacy errors.
      }
    },
    [storageKey],
  );

  const commit = useCallback(
    (next: number) => {
      setSize(next);
      onSizeChange?.(next);
    },
    [onSizeChange],
  );

  const readContainerSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return 0;
    return direction === "horizontal" ? el.clientWidth : el.clientHeight;
  }, [direction]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const containerSize = readContainerSize();
    if (!containerSize) return;

    draggingRef.current = true;
    originRef.current = {
      pointer: direction === "horizontal" ? event.clientX : event.clientY,
      size,
      container: containerSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;

    const { pointer, size: startSize, container } = originRef.current;
    const current = direction === "horizontal" ? event.clientX : event.clientY;
    const delta = current - pointer;
    if (delta === 0) return;

    const next = clamp(startSize + delta, minSize, upperBound(container));
    if (next !== size) {
      commit(next);
      persist(next);
    }
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persist(size);
  };

  const nudge = (amount: number) => {
    const containerSize = readContainerSize();
    const bound = containerSize ? upperBound(containerSize) : maxSize;
    const next = clamp(size + amount, minSize, bound);
    commit(next);
    persist(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const decrease = direction === "horizontal" ? ["ArrowLeft", "ArrowUp"] : ["ArrowUp"];
    const increase = direction === "horizontal" ? ["ArrowRight", "ArrowDown"] : ["ArrowDown"];

    if (decrease.includes(event.key)) {
      event.preventDefault();
      nudge(-(event.shiftKey ? step * 4 : step));
      return;
    }
    if (increase.includes(event.key)) {
      event.preventDefault();
      nudge(event.shiftKey ? step * 4 : step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      commit(minSize);
      persist(minSize);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const bound = readContainerSize() || maxSize;
      const next = upperBound(bound);
      commit(next);
      persist(next);
    }
  };

  const handleDoubleClick = () => {
    commit(defaultSize);
    persist(defaultSize);
  };

  const isHorizontal = direction === "horizontal";
  const paneStyle: React.CSSProperties = isHorizontal
    ? { width: size, minWidth: minSize }
    : { height: size, minHeight: minSize };

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? "flex-row" : "flex-col"} ${className}`}
      data-testid="split-pane"
    >
      <div
        className={`relative min-w-0 min-h-0 overflow-hidden ${isHorizontal ? "h-full" : "w-full"}`}
        style={paneStyle}
      >
        {first}
      </div>

      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(size)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        title={`${label} (drag, or use arrow keys; double-click to reset)`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
        className={`group relative z-10 shrink-0 touch-none bg-slate-950/70 outline-none transition-colors ${
          isHorizontal
            ? "w-2 cursor-col-resize hover:bg-teal-500/30 focus-visible:bg-teal-500/40"
            : "h-2 cursor-row-resize hover:bg-teal-500/30 focus-visible:bg-teal-500/40"
        }`}
      >
        <span
          className={`absolute rounded-full bg-slate-600 transition-colors group-hover:bg-teal-400 ${
            isHorizontal
              ? "left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2"
              : "left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2"
          }`}
        />
      </div>

      <div className="relative min-w-0 min-h-0 flex-1 overflow-hidden">
        {second}
      </div>
    </div>
  );
}
