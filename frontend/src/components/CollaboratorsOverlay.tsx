"use client";

import React from "react";
import { Radio, Users } from "lucide-react";
import type { PeerPresence } from "@/collaboration/yjsPresence";
import type { CollaborationStatus } from "@/collaboration/yjsProvider";

interface CollaboratorsOverlayProps {
  peers: PeerPresence[];
  status: CollaborationStatus;
  selfColor?: string;
  onPeerClick?: (peer: PeerPresence) => void;
}

const STATUS_LABEL: Record<CollaborationStatus, string> = {
  connecting: "Connecting",
  connected: "Live",
  webrtc: "P2P fallback",
  disconnected: "Offline",
};

function cursorLabel(peer: PeerPresence): string {
  return peer.cursor
    ? `L${peer.cursor.line}:C${peer.cursor.column}`
    : "no cursor";
}

export function CollaboratorsOverlay({
  peers,
  status,
  selfColor = "#38bdf8",
  onPeerClick,
}: CollaboratorsOverlayProps) {
  return (
    <div
      className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-950/85 px-2.5 py-1.5 text-xs text-slate-300 backdrop-blur-sm"
      data-testid="collaborators-overlay"
    >
      <div className="flex items-center gap-1.5 font-medium">
        {status === "webrtc" ? (
          <Radio className="h-3.5 w-3.5 text-amber-400" />
        ) : (
          <Users className="h-3.5 w-3.5 text-emerald-400" />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {STATUS_LABEL[status]} · {peers.length + 1}
        </span>
      </div>

      <div className="flex -space-x-1 overflow-visible">
        <div
          title="You"
          style={{ backgroundColor: selfColor }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-slate-950"
        >
          Y
        </div>
        {peers.map((peer) => (
          <button
            key={peer.id}
            type="button"
            onClick={() => onPeerClick?.(peer)}
            title={`${peer.name} · ${cursorLabel(peer)}`}
            style={{ backgroundColor: peer.color }}
            className="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-slate-950 uppercase"
          >
            {peer.name.charAt(0)}
            {peer.cursor && (
              <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded bg-slate-900 px-1 font-mono text-[8px] font-normal text-cyan-300">
                {cursorLabel(peer)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CollaboratorsOverlay;
