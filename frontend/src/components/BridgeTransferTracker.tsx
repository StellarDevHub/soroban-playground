"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  AlertTriangle,
  RotateCcw,
  Shield,
  Layers,
  ArrowRight,
  Sparkles,
  Link2,
} from "lucide-react";
import {
  BridgeSession,
  BridgeStage,
  BRIDGE_STAGES,
  getExplorerUrl,
  StageStatus,
} from "../types/bridgeTracker";
import {
  saveBridgeSession,
  getBridgeSessionById,
  updateBridgeSession,
} from "../utils/bridgeStorage";

export interface BridgeTransferTrackerProps {
  session?: BridgeSession;
  sessionId?: string;
  onSessionComplete?: (session: BridgeSession) => void;
  onRetryStage?: (stage: BridgeStage) => void;
  className?: string;
}

export const BridgeTransferTracker: React.FC<BridgeTransferTrackerProps> = ({
  session: initialSession,
  sessionId,
  onSessionComplete,
  onRetryStage,
  className = "",
}) => {
  const [session, setSession] = useState<BridgeSession | null>(() => {
    if (initialSession) return initialSession;
    if (sessionId) return getBridgeSessionById(sessionId);
    return null;
  });

  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  // Ticking timer for elapsed time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync if prop changes
  useEffect(() => {
    if (initialSession) {
      setSession(initialSession);
      saveBridgeSession(initialSession);
    } else if (sessionId) {
      const stored = getBridgeSessionById(sessionId);
      if (stored) setSession(stored);
    }
  }, [initialSession, sessionId]);

  // Elapsed time in seconds
  const elapsedSeconds = useMemo(() => {
    if (!session) return 0;
    return Math.max(0, Math.floor((currentTime - session.createdAt) / 1000));
  }, [currentTime, session]);

  // Remaining time formatted
  const formattedRemainingTime = useMemo(() => {
    if (!session) return "0s";
    const allCompleted = Object.values(session.stageStatuses).every(
      (s) => s === "completed"
    );
    if (allCompleted) return "Completed";

    const remaining = Math.max(0, session.estimatedTotalSeconds - elapsedSeconds);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    if (mins > 0) return `~${mins}m ${secs}s`;
    return `~${secs}s`;
  }, [session, elapsedSeconds]);

  // Step index helper
  const getStageIndex = (stageId: BridgeStage): number => {
    return BRIDGE_STAGES.findIndex((s) => s.id === stageId);
  };

  const currentStageIndex = session ? getStageIndex(session.currentStage) : 0;

  // Manual or simulated stage advance (for testing & event streams)
  const advanceStage = (nextStage: BridgeStage, nextStatus: StageStatus = "in_progress") => {
    if (!session) return;
    const now = Date.now();
    const updatedStatuses = { ...session.stageStatuses };
    const updatedTimestamps = { ...session.stageTimestamps };

    // mark previous completed
    const targetIdx = getStageIndex(nextStage);
    BRIDGE_STAGES.forEach((stage, idx) => {
      if (idx < targetIdx) {
        updatedStatuses[stage.id] = "completed";
        if (!updatedTimestamps[stage.id]) updatedTimestamps[stage.id] = now;
      }
    });

    updatedStatuses[nextStage] = nextStatus;
    if (nextStatus === "completed") {
      updatedTimestamps[nextStage] = now;
    }

    const updated = updateBridgeSession(session.id, {
      currentStage: nextStage,
      stageStatuses: updatedStatuses,
      stageTimestamps: updatedTimestamps,
    });

    if (updated) {
      setSession(updated);
      if (
        nextStage === "destination_minted" &&
        nextStatus === "completed" &&
        onSessionComplete
      ) {
        onSessionComplete(updated);
      }
    }
  };

  const handleRetry = (stageId: BridgeStage) => {
    if (onRetryStage) {
      onRetryStage(stageId);
    }
    advanceStage(stageId, "in_progress");
  };

  if (!session) {
    return (
      <div
        className={`rounded-xl border border-gray-800 bg-gray-950 p-6 text-center text-gray-500 ${className}`}
        role="region"
        aria-label="Cross-Chain Bridge Transfer Status Tracker"
      >
        <Clock className="mx-auto mb-2 h-8 w-8 text-gray-600 animate-pulse" />
        <p className="text-sm">No active bridge transfer session selected.</p>
      </div>
    );
  }

  const isCompleted = Object.values(session.stageStatuses).every(
    (s) => s === "completed"
  );
  const isFailed = Object.values(session.stageStatuses).some((s) => s === "failed");

  return (
    <div
      className={`rounded-2xl border border-gray-800/80 bg-gradient-to-b from-gray-900 to-gray-950 p-6 shadow-2xl backdrop-blur-md ${className}`}
      role="region"
      aria-label="Cross-Chain Bridge Transfer Status Tracker"
    >
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-gray-800/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Link2 size={16} />
            </span>
            <h3 className="text-base font-semibold text-gray-100">
              Cross-Chain Transfer Status
            </h3>
            <span className="font-mono text-xs text-gray-500">
              ID: {session.depositId ? `#${session.depositId}` : session.id.slice(0, 12)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Transferring{" "}
            <span className="font-semibold text-cyan-300">
              {session.amount.toLocaleString()} {session.token}
            </span>{" "}
            from{" "}
            <span className="font-medium text-gray-300 capitalize">
              {session.sourceNetwork.replace("-", " ")}
            </span>{" "}
            to{" "}
            <span className="font-medium text-gray-300 capitalize">
              {session.destinationNetwork.replace("-", " ")}
            </span>
          </p>
        </div>

        {/* Badges: Elapsed / Remaining */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Elapsed Time
            </p>
            <p className="font-mono text-xs font-medium text-gray-300">
              {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
            </p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Estimated Remaining
            </p>
            <p
              className={`font-mono text-xs font-semibold ${
                isCompleted
                  ? "text-emerald-400"
                  : isFailed
                  ? "text-rose-400"
                  : "text-amber-400"
              }`}
            >
              {formattedRemainingTime}
            </p>
          </div>
        </div>
      </div>

      {/* 4-Stage Multi-Hop Stepper */}
      <ol
        className="relative mb-8 grid grid-cols-1 gap-4 sm:grid-cols-4"
        role="list"
      >
        {BRIDGE_STAGES.map((stage, idx) => {
          const status: StageStatus = session.stageStatuses[stage.id] || "pending";
          const timestamp = session.stageTimestamps[stage.id];
          const isCurrent = session.currentStage === stage.id && status === "in_progress";

          let badgeColor = "border-gray-800 bg-gray-900 text-gray-500";
          let icon = <Clock size={16} className="text-gray-500" />;

          if (status === "completed") {
            badgeColor = "border-emerald-500/40 bg-emerald-950/30 text-emerald-400";
            icon = <CheckCircle2 size={16} className="text-emerald-400" />;
          } else if (status === "in_progress") {
            badgeColor =
              "border-cyan-500/60 bg-cyan-950/40 text-cyan-300 shadow-lg shadow-cyan-500/10";
            icon = (
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"
                aria-label="In Progress Spinner"
              />
            );
          } else if (status === "failed") {
            badgeColor = "border-rose-500/60 bg-rose-950/40 text-rose-300";
            icon = <AlertTriangle size={16} className="text-rose-400" />;
          }

          return (
            <li
              key={stage.id}
              className={`relative flex flex-col rounded-xl border p-4 transition-all duration-300 ${badgeColor}`}
              role="listitem"
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* Connector line for desktop */}
              {idx < BRIDGE_STAGES.length - 1 && (
                <div
                  className={`hidden sm:block absolute -right-3 top-1/2 -translate-y-1/2 z-10`}
                >
                  <ArrowRight
                    size={14}
                    className={
                      status === "completed" ? "text-emerald-500" : "text-gray-700"
                    }
                  />
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-950/60 border border-gray-700/40">
                  {icon}
                </span>
                <span className="font-mono text-[10px] font-semibold tracking-wider uppercase opacity-75">
                  Hop 0{idx + 1}
                </span>
              </div>

              <h4 className="text-xs font-semibold leading-tight text-gray-100">
                {stage.label}
              </h4>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400 line-clamp-2">
                {stage.description}
              </p>

              {/* Timestamp or Status Badge */}
              <div className="mt-auto pt-3 flex items-center justify-between text-[10px]">
                {timestamp ? (
                  <span className="font-mono text-gray-400">
                    {new Date(timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                ) : (
                  <span className="capitalize font-mono opacity-60">
                    {status.replace("_", " ")}
                  </span>
                )}

                {status === "failed" && (
                  <button
                    onClick={() => handleRetry(stage.id)}
                    className="flex items-center gap-1 text-rose-400 hover:text-rose-300 transition"
                  >
                    <RotateCcw size={10} />
                    Retry
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* External Explorer Links & Proof Inspection */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-xl border border-gray-800/60 bg-gray-950/50 p-4">
        {/* Source Network Explorer Link */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 truncate">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Layers size={13} />
            </span>
            <div className="truncate">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Source Chain ({session.sourceNetwork})
              </p>
              <p className="truncate font-mono text-xs text-gray-300">
                {session.sourceTxHash}
              </p>
            </div>
          </div>
          <a
            href={getExplorerUrl(session.sourceNetwork, session.sourceTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md bg-gray-800 px-2 py-1 text-[10px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition"
            aria-label="View Source Transaction on Explorer"
          >
            Explorer
            <ExternalLink size={10} />
          </a>
        </div>

        {/* Destination Network Explorer Link */}
        <div className="flex items-center justify-between gap-3 border-t sm:border-t-0 sm:border-l border-gray-800/60 pt-3 sm:pt-0 sm:pl-3">
          <div className="flex items-center gap-2 truncate">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Shield size={13} />
            </span>
            <div className="truncate">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Destination Chain ({session.destinationNetwork})
              </p>
              <p className="truncate font-mono text-xs text-gray-300">
                {session.destTxHash || "Pending mint transaction..."}
              </p>
            </div>
          </div>
          {session.destTxHash ? (
            <a
              href={getExplorerUrl(session.destinationNetwork, session.destTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md bg-gray-800 px-2 py-1 text-[10px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition"
              aria-label="View Destination Mint Transaction on Explorer"
            >
              Explorer
              <ExternalLink size={10} />
            </a>
          ) : (
            <span className="text-[10px] font-mono text-gray-600">Awaiting Mint</span>
          )}
        </div>
      </div>

      {/* Completion Banner */}
      {isCompleted && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-emerald-300">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-400" />
            <span className="text-xs font-medium">
              Bridge transfer successfully completed and minted on destination!
            </span>
          </div>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold">
            100% Finalized
          </span>
        </div>
      )}

      {/* Error Banner */}
      {isFailed && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-400" />
            <span className="text-xs font-medium">
              Transfer stalled during{" "}
              {session.currentStage.replace(/_/g, " ")}. Click Retry to resume.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BridgeTransferTracker;
