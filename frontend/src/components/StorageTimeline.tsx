import React from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

interface StorageTimelineProps {
  totalFrames: number;
  currentFrame: number;
  contextLabel?: string;
  capturedAt?: string;
  onScrub: (index: number) => void;
}

export default function StorageTimeline({
  totalFrames,
  currentFrame,
  contextLabel,
  capturedAt,
  onScrub,
}: StorageTimelineProps) {
  const hasFrames = totalFrames > 0;
  const canStepBackward = hasFrames && currentFrame > 0;
  const canStepForward = hasFrames && currentFrame < totalFrames - 1;
  const formattedTimestamp = capturedAt ? new Date(capturedAt).toLocaleTimeString() : undefined;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500 flex items-center">
            <History size={14} className="mr-2 text-cyan-400" />
            Ledger Timeline
          </p>
          <p className="text-xs text-gray-400 mt-1">{contextLabel ?? "No snapshot selected"}</p>
        </div>
        <p className="text-xs text-gray-500 tabular-nums">
          {hasFrames ? `Frame ${currentFrame + 1} / ${totalFrames}` : "Frame 0 / 0"}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onScrub(Math.max(0, currentFrame - 1))}
          disabled={!canStepBackward}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
            canStepBackward
              ? "border-gray-700 bg-gray-900 text-cyan-300 hover:border-cyan-600"
              : "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
          }`}
          aria-label="Previous frame"
        >
          <ChevronLeft size={14} />
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={hasFrames ? currentFrame : 0}
          disabled={!hasFrames}
          onChange={(event) => onScrub(Number(event.target.value))}
          className="w-full accent-cyan-500 disabled:opacity-40"
          aria-label="Storage timeline slider"
        />

        <button
          type="button"
          onClick={() => onScrub(Math.min(totalFrames - 1, currentFrame + 1))}
          disabled={!canStepForward}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
            canStepForward
              ? "border-gray-700 bg-gray-900 text-cyan-300 hover:border-cyan-600"
              : "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
          }`}
          aria-label="Next frame"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <p className="text-[11px] text-gray-500">
        {formattedTimestamp ? `Captured at ${formattedTimestamp}` : "Run a transaction to generate timeline frames."}
      </p>
    </div>
  );
}
