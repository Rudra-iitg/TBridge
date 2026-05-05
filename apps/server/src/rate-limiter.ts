/**
 * In-memory sliding-window rate limiter.
 *
 * Tracks timestamps of events per key within a configurable window.
 * Old entries are pruned on every check to avoid unbounded memory growth.
 *
 * This is intentionally simple — no Redis dependency for the local relay
 * prototype. Production should use a shared store.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type WindowEntry = {
  timestamps: number[];
};

export class RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly limit: number;
  private readonly windowMs: number;

  /**
   * @param limit   Maximum events allowed within the window.
   * @param windowMs Window duration in milliseconds.
   */
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /**
   * Check whether a key is allowed to perform an action.
   * Records the event if allowed.
   */
  check(key: string, now = Date.now()): RateLimitResult {
    const entry = this.getOrCreate(key);
    this.prune(entry, now);

    if (entry.timestamps.length >= this.limit) {
      const oldest = entry.timestamps[0]!;
      const retryAfterMs = oldest + this.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, retryAfterMs)
      };
    }

    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.limit - entry.timestamps.length,
      retryAfterMs: 0
    };
  }

  /**
   * Reset all tracked state. Useful for tests.
   */
  reset(): void {
    this.windows.clear();
  }

  private getOrCreate(key: string): WindowEntry {
    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    return entry;
  }

  private prune(entry: WindowEntry, now: number): void {
    const cutoff = now - this.windowMs;
    // Timestamps are always in order, so find the first valid index
    let firstValid = 0;
    while (
      firstValid < entry.timestamps.length &&
      entry.timestamps[firstValid]! <= cutoff
    ) {
      firstValid++;
    }

    if (firstValid > 0) {
      entry.timestamps.splice(0, firstValid);
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-configured limiters for the relay server
// ---------------------------------------------------------------------------

/** Max 10 WebSocket connections per IP per minute */
export const connectionLimiter = new RateLimiter(10, 60_000);

/** Max 5 host/guest registrations per IP per minute */
export const registrationLimiter = new RateLimiter(5, 60_000);

/** Max 200 messages per IP per second (PTY flood protection) */
export const messageLimiter = new RateLimiter(200, 1_000);
