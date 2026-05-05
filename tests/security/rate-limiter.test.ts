import { describe, expect, it, beforeEach } from "vitest";
import { RateLimiter } from "../../apps/server/src/rate-limiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000); // 3 events per 1 second
  });

  it("allows events under the limit", () => {
    const r1 = limiter.check("ip-1", 0);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("ip-1", 0);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("ip-1", 0);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("rejects events over the limit", () => {
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);

    const r4 = limiter.check("ip-1", 0);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
    expect(r4.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it("tracks different keys independently", () => {
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);

    // ip-2 should still be allowed
    const r = limiter.check("ip-2", 0);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("resets after the window expires", () => {
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);

    // All 3 used at t=0. At t=1001 they should be pruned.
    const r = limiter.check("ip-1", 1001);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("partially expires old events", () => {
    limiter.check("ip-1", 0);    // expires at 1000
    limiter.check("ip-1", 500);  // expires at 1500
    limiter.check("ip-1", 900);  // expires at 1900

    // At t=1100: only the first event has expired
    const r = limiter.check("ip-1", 1100);
    expect(r.allowed).toBe(true); // 2 remaining + 1 new = 3 total, but we're adding 1
    // After pruning: 2 events (500, 900) remain. Adding 1 -> 3 total -> allowed
    expect(r.remaining).toBe(0);
  });

  it("provides correct retryAfterMs", () => {
    limiter.check("ip-1", 100);
    limiter.check("ip-1", 200);
    limiter.check("ip-1", 300);

    const r = limiter.check("ip-1", 500);
    expect(r.allowed).toBe(false);
    // Oldest is 100, window is 1000. Retry after 100 + 1000 - 500 = 600ms
    expect(r.retryAfterMs).toBe(600);
  });

  it("reset clears all state", () => {
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);
    limiter.check("ip-1", 0);

    limiter.reset();

    const r = limiter.check("ip-1", 0);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("handles rapid bursts correctly", () => {
    const burstLimiter = new RateLimiter(5, 100);

    for (let i = 0; i < 5; i++) {
      expect(burstLimiter.check("key", 0).allowed).toBe(true);
    }

    expect(burstLimiter.check("key", 0).allowed).toBe(false);
    expect(burstLimiter.check("key", 50).allowed).toBe(false);
    expect(burstLimiter.check("key", 101).allowed).toBe(true); // window reset
  });

  it("handles zero retryAfterMs edge case", () => {
    limiter.check("k", 0);
    limiter.check("k", 0);
    limiter.check("k", 0);

    const r = limiter.check("k", 1000);
    // At exactly t=1000, the event at t=0 is at the boundary (0 + 1000 = 1000)
    // Pruning removes entries where timestamp <= (now - window) = 0
    // So the entry at t=0 is pruned (0 <= 0)
    expect(r.allowed).toBe(true);
  });
});
