export type ToastType = 'info' | 'success' | 'warning' | 'error';
export type ToastPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  priority: ToastPriority;
  durationMs: number;
  explorerUrl?: string;
  groupId?: string;
  groupCount?: number;
  createdAt: number;
}

export type ToastSubscriber = (toasts: ToastItem[]) => void;

export class ToastManager {
  private toasts: Map<string, ToastItem> = new Map();
  private subscribers: Set<ToastSubscriber> = new Set();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private maxVisible: number = 3;
  private soundEnabled: boolean = true;
  private audioContext: AudioContext | null = null;

  constructor(options?: { maxVisible?: number; soundEnabled?: boolean }) {
    if (options?.maxVisible !== undefined) {
      this.maxVisible = options.maxVisible;
    }
    if (options?.soundEnabled !== undefined) {
      this.soundEnabled = options.soundEnabled;
    }
  }

  public setMaxVisible(max: number): void {
    this.maxVisible = Math.max(1, max);
    this.notify();
  }

  public getMaxVisible(): number {
    return this.maxVisible;
  }

  public setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public subscribe(subscriber: ToastSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getToasts());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notify(): void {
    const activeToasts = this.getToasts();
    this.subscribers.forEach((sub) => {
      try {
        sub(activeToasts);
      } catch (err) {
        console.error('Error notifying toast subscriber:', err);
      }
    });
  }

  /**
   * Generates a sound cue using the Web Audio API for success or error events.
   * Degrades gracefully when audio context is unavailable or permissions are restricted.
   */
  public playSoundCue(type: ToastType): void {
    if (!this.soundEnabled || typeof window === 'undefined') return;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume();
      }

      const ctx = this.audioContext;
      const now = ctx.currentTime;

      if (type === 'success') {
        // Melodic ascending chime: C5 (523.25Hz) to G5 (783.99Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'error') {
        // Soft cautionary low double-tone: 260Hz descending to 180Hz
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.25);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch {
      // Audio playback restrictions or headless test runner
    }
  }

  public show(options: {
    title: string;
    message?: string;
    type?: ToastType;
    priority?: ToastPriority;
    durationMs?: number;
    explorerUrl?: string;
    groupId?: string;
  }): string {
    const {
      title,
      message,
      type = 'info',
      priority = 'medium',
      durationMs = 5000,
      explorerUrl,
      groupId,
    } = options;

    // Automatic grouping: use explicit groupId or auto-group identical error notifications
    const effectiveGroupId =
      groupId || (type === 'error' ? `auto-error:${title}:${message || ''}` : undefined);

    if (effectiveGroupId) {
      for (const [existingId, item] of this.toasts.entries()) {
        if (item.groupId === effectiveGroupId) {
          const updated: ToastItem = {
            ...item,
            title,
            message,
            type,
            priority,
            explorerUrl: explorerUrl || item.explorerUrl,
            groupCount: (item.groupCount || 1) + 1,
            createdAt: Date.now(),
          };

          this.toasts.set(existingId, updated);
          this.resetTimer(existingId, durationMs);
          this.notify();
          this.playSoundCue(type);
          return existingId;
        }
      }
    }

    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toastItem: ToastItem = {
      id,
      title,
      message,
      type,
      priority,
      durationMs,
      explorerUrl,
      groupId: effectiveGroupId,
      groupCount: 1,
      createdAt: Date.now(),
    };

    this.toasts.set(id, toastItem);
    this.resetTimer(id, durationMs);
    this.notify();
    this.playSoundCue(type);
    return id;
  }

  private resetTimer(id: string, durationMs: number): void {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }

    if (durationMs > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id);
      }, durationMs);
      this.timers.set(id, timer);
    }
  }

  public dismiss(id: string): void {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }
    if (this.toasts.has(id)) {
      this.toasts.delete(id);
      this.notify();
    }
  }

  public clear(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.toasts.clear();
    this.notify();
  }

  /**
   * Returns all active toasts sorted by priority then timestamp.
   */
  public getAllToasts(): ToastItem[] {
    const list = Array.from(this.toasts.values());
    const priorityWeight: Record<ToastPriority, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    return list.sort((a, b) => {
      if (priorityWeight[b.priority] !== priorityWeight[a.priority]) {
        return priorityWeight[b.priority] - priorityWeight[a.priority];
      }
      return b.createdAt - a.createdAt;
    });
  }

  /**
   * Returns prioritized toasts capped at maxVisible (default 3) to prevent screen overflow.
   */
  public getToasts(): ToastItem[] {
    return this.getAllToasts().slice(0, this.maxVisible);
  }
}

export const toastManager = new ToastManager();
