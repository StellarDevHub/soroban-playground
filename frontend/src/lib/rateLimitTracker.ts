export interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: number; // timestamp in milliseconds
  cooldownSeconds: number;
  isLowQuota: boolean; // true when remaining/limit < 0.15 or remaining <= 2
  isExceeded: boolean; // true when remaining <= 0
  lastUpdated: number;
}

export type RateLimitSubscriber = (state: RateLimitState | null) => void;

export class RateLimitTracker {
  private state: RateLimitState | null = null;
  private subscribers: Set<RateLimitSubscriber> = new Set();
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  public subscribe(subscriber: RateLimitSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.state);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notify(): void {
    this.subscribers.forEach((sub) => {
      try {
        sub(this.state ? { ...this.state } : null);
      } catch (err) {
        console.error('Error notifying rate limit subscriber:', err);
      }
    });
  }

  public getState(): RateLimitState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * Updates rate limit status from standard HTTP response headers
   */
  public updateFromHeaders(headers: Headers | Record<string, string | null | undefined>): void {
    const getHeader = (name: string): string | null => {
      if (typeof headers.get === 'function') {
        return headers.get(name);
      }
      const record = headers as Record<string, string | null | undefined>;
      const lower = name.toLowerCase();
      for (const [key, value] of Object.entries(record)) {
        if (key.toLowerCase() === lower && value !== undefined && value !== null) {
          return String(value);
        }
      }
      return null;
    };

    const limitStr = getHeader('X-RateLimit-Limit') || getHeader('RateLimit-Limit');
    const remainingStr = getHeader('X-RateLimit-Remaining') || getHeader('RateLimit-Remaining');
    const resetStr = getHeader('X-RateLimit-Reset') || getHeader('RateLimit-Reset') || getHeader('Retry-After');

    if (!remainingStr) return;

    const remaining = parseInt(remainingStr, 10);
    if (isNaN(remaining)) return;

    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    const now = Date.now();

    let resetAt = now + 60000; // default 60s cooldown if reset header missing
    if (resetStr) {
      const resetVal = parseInt(resetStr, 10);
      if (!isNaN(resetVal)) {
        // If resetVal is unix seconds (e.g. 1700000000), convert to ms; if delta seconds (e.g. 45), add to now
        if (resetVal > 1000000000) {
          resetAt = resetVal * 1000;
        } else {
          resetAt = now + resetVal * 1000;
        }
      }
    }

    const cooldownSeconds = Math.max(0, Math.ceil((resetAt - now) / 1000));
    const ratio = limit > 0 ? remaining / limit : 1;
    const isLowQuota = ratio < 0.15 || remaining <= 2;
    const isExceeded = remaining <= 0;

    this.state = {
      limit: Math.max(1, limit),
      remaining: Math.max(0, remaining),
      resetAt,
      cooldownSeconds,
      isLowQuota,
      isExceeded,
      lastUpdated: now,
    };

    this.startCountdown();
    this.notify();
  }

  public setManualState(limit: number, remaining: number, cooldownSecs: number): void {
    const now = Date.now();
    const resetAt = now + cooldownSecs * 1000;
    const ratio = limit > 0 ? remaining / limit : 1;
    this.state = {
      limit,
      remaining,
      resetAt,
      cooldownSeconds: cooldownSecs,
      isLowQuota: ratio < 0.15 || remaining <= 2,
      isExceeded: remaining <= 0,
      lastUpdated: now,
    };
    this.startCountdown();
    this.notify();
  }

  public clear(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.state = null;
    this.notify();
  }

  private startCountdown(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }

    this.intervalTimer = setInterval(() => {
      if (!this.state) {
        if (this.intervalTimer) clearInterval(this.intervalTimer);
        return;
      }

      const now = Date.now();
      const remainingSeconds = Math.max(0, Math.ceil((this.state.resetAt - now) / 1000));

      if (remainingSeconds <= 0) {
        // Cooldown reached: clear or reset
        this.clear();
      } else {
        this.state.cooldownSeconds = remainingSeconds;
        this.notify();
      }
    }, 1000);
  }
}

export const rateLimitTracker = new RateLimitTracker();
