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
  private timers: Map<string, any> = new Map();

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

    // Deduplicate / group related events if groupId exists
    if (groupId) {
      for (const [existingId, item] of this.toasts.entries()) {
        if (item.groupId === groupId) {
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
      groupId,
      groupCount: 1,
      createdAt: Date.now(),
    };

    this.toasts.set(id, toastItem);
    this.resetTimer(id, durationMs);
    this.notify();
    return id;
  }

  private resetTimer(id: string, durationMs: number): void {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
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

  public getToasts(): ToastItem[] {
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
}

export const toastManager = new ToastManager();
