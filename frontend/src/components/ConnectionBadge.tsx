"use client";

/**
 * ConnectionBadge
 *
 * A small status indicator that shows the current WebSocket connection state.
 * Designed to sit in a toolbar or panel header alongside other controls.
 *
 * Usage:
 *   import { ConnectionBadge } from "@/components/ConnectionBadge";
 *
 *   <ConnectionBadge status={status} droppedCount={droppedCount} onReconnect={reconnect} />
 */

import type { EventStreamStatus } from "@/hooks/useEventStream";

interface ConnectionBadgeProps {
  status: EventStreamStatus;
  droppedCount?: number;
  onReconnect?: () => void;
  className?: string;
}

const STATUS_CONFIG: Record<
  EventStreamStatus,
  { label: string; dot: string; badge: string }
> = {
  idle: {
    label: "Idle",
    dot: "bg-gray-400",
    badge: "bg-gray-800 text-gray-400 border-gray-700",
  },
  connecting: {
    label: "Connecting…",
    dot: "bg-yellow-400 animate-pulse",
    badge: "bg-yellow-900/30 text-yellow-300 border-yellow-700/50",
  },
  connected: {
    label: "Live",
    dot: "bg-green-400",
    badge: "bg-green-900/30 text-green-300 border-green-700/50",
  },
  reconnecting: {
    label: "Reconnecting…",
    dot: "bg-orange-400 animate-pulse",
    badge: "bg-orange-900/30 text-orange-300 border-orange-700/50",
  },
  fallback: {
    label: "Polling",
    dot: "bg-blue-400",
    badge: "bg-blue-900/30 text-blue-300 border-blue-700/50",
  },
  error: {
    label: "Error",
    dot: "bg-red-400",
    badge: "bg-red-900/30 text-red-300 border-red-700/50",
  },
};

export function ConnectionBadge({
  status,
  droppedCount = 0,
  onReconnect,
  className = "",
}: ConnectionBadgeProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium select-none ${cfg.badge} ${className}`}
      title={`WebSocket stream: ${cfg.label}${droppedCount > 0 ? ` (${droppedCount} dropped)` : ""}`}
    >
      {/* Animated status dot */}
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />

      {cfg.label}

      {/* Dropped message counter — only shown when non-zero */}
      {droppedCount > 0 && (
        <span className="ml-0.5 rounded bg-red-500/20 px-1 text-red-300 text-[10px]">
          {droppedCount} dropped
        </span>
      )}

      {/* Reconnect button — shown only when applicable */}
      {(status === "reconnecting" || status === "error" || status === "fallback") &&
        onReconnect && (
          <button
            onClick={onReconnect}
            className="ml-0.5 underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity text-[10px]"
            type="button"
          >
            reconnect
          </button>
        )}
    </span>
  );
}
