'use client';

import React, { useSyncExternalStore, useState } from 'react';
import { rateLimitTracker, type RateLimitState } from '../lib/rateLimitTracker';
import { AlertTriangle, Clock, X, ShieldAlert } from 'lucide-react';

let cachedState = rateLimitTracker.getState();
const subscribe = (onStoreChange: () => void) =>
  rateLimitTracker.subscribe((state) => {
    cachedState = state;
    onStoreChange();
  });
const getSnapshot = () => cachedState;
const getServerSnapshot = () => null;

export default function RateLimitBanner() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dismissedUntil, setDismissedUntil] = useState<number>(0);

  if (!state || (!state.isLowQuota && !state.isExceeded)) {
    return null;
  }

  // If user dismissed this warning cycle, don't show until new update or reset
  if (dismissedUntil >= state.lastUpdated) {
    return null;
  }

  const { limit, remaining, cooldownSeconds, isExceeded } = state;
  const percentage = Math.min(100, Math.max(0, Math.round((remaining / limit) * 100)));

  const formatCooldown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
    }
    return `${secs}s`;
  };

  const gaugeColor = isExceeded
    ? 'bg-red-500'
    : percentage < 15
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  const borderColor = isExceeded
    ? 'border-red-500/50 bg-red-950/80 text-red-200'
    : 'border-amber-500/50 bg-amber-950/80 text-amber-200';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative z-50 mb-4 rounded-lg border p-4 shadow-lg backdrop-blur transition-all ${borderColor}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Icon and Warning Title */}
        <div className="flex items-start gap-3">
          {isExceeded ? (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400 animate-pulse" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          )}
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <span>
                {isExceeded
                  ? 'API Rate Limit Reached'
                  : 'Proactive API Quota Warning'}
              </span>
              <span className="rounded bg-black/40 px-2 py-0.5 text-xs font-mono">
                {remaining} / {limit} requests ({percentage}%)
              </span>
            </div>
            <p className="mt-1 text-xs opacity-90">
              {isExceeded
                ? 'Outgoing operations are throttled to avoid server rejection. Please pause deployments until cooldown expires.'
                : 'Your remaining API request allowance is running low (< 15%). Proactively pacing calls will prevent workflow disruption.'}
            </p>
          </div>
        </div>

        {/* Right: Live Cooldown Timer and Dismiss Button */}
        <div className="flex items-center gap-4 self-end sm:self-center">
          <div className="flex items-center gap-1.5 rounded-md bg-black/50 px-3 py-1.5 text-xs font-mono border border-white/10">
            <Clock className="h-3.5 w-3.5 text-blue-400 animate-spin-slow" />
            <span>Cooldown:</span>
            <strong className="text-white">{formatCooldown(cooldownSeconds)}</strong>
          </div>

          <button
            type="button"
            onClick={() => setDismissedUntil(Date.now())}
            aria-label="Dismiss rate limit banner"
            className="rounded p-1 hover:bg-white/10 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Visual Quota Gauge Bar */}
      <div className="mt-3">
        <div className="flex justify-between text-[10px] opacity-75 mb-1 font-mono">
          <span>Quota Consumption</span>
          <span>{percentage}% remaining</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full transition-all duration-500 ease-out ${gaugeColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
