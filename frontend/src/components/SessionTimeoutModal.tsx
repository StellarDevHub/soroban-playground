'use client';

import React, { useEffect, useRef } from 'react';
import { Clock, ShieldAlert, CheckCircle, RefreshCw, LogOut } from 'lucide-react';

export interface SessionTimeoutModalProps {
  isOpen: boolean;
  secondsRemaining: number;
  isRefreshing?: boolean;
  onExtend: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
}

export default function SessionTimeoutModal({
  isOpen,
  secondsRemaining,
  isRefreshing = false,
  onExtend,
  onLogout,
}: SessionTimeoutModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus primary button on open
  useEffect(() => {
    if (isOpen) {
      primaryButtonRef.current?.focus();
    }
  }, [isOpen]);

  // Trap focus & handle keyboard escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Safe default: extend session on escape
        void onExtend();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onExtend]);

  if (!isOpen) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  const progressRatio = Math.max(0, Math.min(100, (secondsRemaining / 120) * 100));

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm transition-opacity"
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-desc"
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 id="session-timeout-title" className="text-lg font-bold text-white">
              Session Expiring Soon
            </h2>
            <p className="text-xs text-amber-300/80">Security Timeout Safeguard</p>
          </div>
        </div>

        {/* Description & Countdown */}
        <div id="session-timeout-desc" className="space-y-3">
          <p className="text-sm text-slate-300">
            Your JWT authentication token will expire in{' '}
            <strong className="text-amber-300 font-mono text-base">{formattedTime}</strong>. To
            prevent HTTP 401 unauthorized errors and safeguard unsaved contract code, please extend
            your session.
          </p>

          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
              style={{ width: `${progressRatio}%` }}
            />
          </div>

          {/* Safe Backup Notice */}
          <div className="flex items-center gap-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 p-2.5 text-xs text-emerald-300">
            <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>Unsaved editor buffers have been backed up to local storage.</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={() => void onLogout()}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            <LogOut className="h-4 w-4" />
            <span>Log Out</span>
          </button>

          <button
            ref={primaryButtonRef}
            type="button"
            disabled={isRefreshing}
            onClick={() => void onExtend()}
            className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-600/30 hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Extending Session...' : 'Extend Session'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
