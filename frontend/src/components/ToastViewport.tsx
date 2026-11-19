'use client';

import React, { useSyncExternalStore, useState, useEffect } from 'react';
import { toastManager, type ToastType, type ToastItem } from '../lib/toastManager';
import { Volume2, VolumeX, ExternalLink, X } from 'lucide-react';

let cachedToasts = toastManager.getToasts();
const subscribe = (onStoreChange: () => void) =>
  toastManager.subscribe((toasts) => {
    cachedToasts = toasts;
    onStoreChange();
  });
const getSnapshot = () => cachedToasts;
const getServerSnapshot = () => [];

const TYPE_STYLES: Record<
  ToastType,
  {
    container: string;
    title: string;
    message: string;
    badge: string;
    closeBtn: string;
  }
> = {
  error: {
    container: 'border-red-500/40 bg-slate-950/95 text-red-200',
    title: 'text-red-200 font-semibold',
    message: 'text-red-100/80',
    badge: 'bg-red-500/20 text-red-300 border-red-500/30',
    closeBtn: 'text-red-400 hover:text-red-200 hover:bg-red-500/20',
  },
  warning: {
    container: 'border-amber-500/40 bg-slate-950/95 text-amber-200',
    title: 'text-amber-200 font-semibold',
    message: 'text-amber-100/80',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    closeBtn: 'text-amber-400 hover:text-amber-200 hover:bg-amber-500/20',
  },
  success: {
    container: 'border-emerald-500/40 bg-slate-950/95 text-emerald-200',
    title: 'text-emerald-200 font-semibold',
    message: 'text-emerald-100/80',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    closeBtn: 'text-emerald-400 hover:text-emerald-200 hover:bg-emerald-500/20',
  },
  info: {
    container: 'border-sky-500/40 bg-slate-950/95 text-sky-200',
    title: 'text-sky-200 font-semibold',
    message: 'text-sky-100/80',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    closeBtn: 'text-sky-400 hover:text-sky-200 hover:bg-sky-500/20',
  },
};

export default function ToastViewport() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    setSoundEnabled(toastManager.isSoundEnabled());
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    toastManager.setSoundEnabled(next);
    setSoundEnabled(next);
  };

  if (!toasts.length) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {/* Accessibility Sound Toggle Bar */}
      <div className="flex justify-end pr-1">
        <button
          type="button"
          onClick={toggleSound}
          title={soundEnabled ? 'Mute notification sound cues' : 'Enable notification sound cues'}
          aria-label={soundEnabled ? 'Mute notification sound cues' : 'Enable notification sound cues'}
          className="inline-flex items-center gap-1 rounded bg-slate-900/80 px-2 py-0.5 text-xs text-slate-400 backdrop-blur transition hover:bg-slate-800 hover:text-slate-200 border border-slate-700/50"
        >
          {soundEnabled ? (
            <>
              <Volume2 size={12} className="text-emerald-400" />
              <span>Sound on</span>
            </>
          ) : (
            <>
              <VolumeX size={12} className="text-slate-500" />
              <span>Sound off</span>
            </>
          )}
        </button>
      </div>

      {toasts.map((toast: ToastItem) => {
        const styles = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
        const count = toast.groupCount || 1;

        return (
          <div
            key={toast.id}
            role="status"
            aria-live={toast.priority === 'critical' || toast.type === 'error' ? 'assertive' : 'polite'}
            className={`rounded-lg border p-4 text-sm shadow-xl backdrop-blur transition-all duration-200 ${styles.container}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className={styles.title}>{toast.title}</strong>
                  {count > 1 && (
                    <span
                      aria-label={`Occurred ${count} times`}
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.2 text-[11px] font-semibold tracking-tight ${styles.badge}`}
                    >
                      ×{count}
                    </span>
                  )}
                </div>
                {toast.message && (
                  <p className={`mt-1 break-words text-xs leading-relaxed ${styles.message}`}>
                    {toast.message}
                  </p>
                )}
                {toast.explorerUrl && (
                  <a
                    href={toast.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs underline opacity-80 hover:opacity-100"
                  >
                    <span>View in Explorer</span>
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <button
                type="button"
                aria-label={`Dismiss ${toast.title}`}
                onClick={() => toastManager.dismiss(toast.id)}
                className={`rounded p-1 transition ${styles.closeBtn}`}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
