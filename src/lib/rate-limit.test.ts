import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  it("allows requests up to the limit and then blocks", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.check("ip", 0).allowed).toBe(true);
    expect(limiter.check("ip", 1).allowed).toBe(true);
    expect(limiter.check("ip", 2).allowed).toBe(true);
    const blocked = limiter.check("ip", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks each key separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
    expect(limiter.check("b", 1).allowed).toBe(true);
  });

  it("resets after the window", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("ip", 0).allowed).toBe(true);
    expect(limiter.check("ip", 500).allowed).toBe(false);
    expect(limiter.check("ip", 1001).allowed).toBe(true);
  });

  it("reports the remaining allowance", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 1000 });
    expect(limiter.check("ip", 0).remaining).toBe(4);
    expect(limiter.check("ip", 0).remaining).toBe(3);
  });

  it("stays bounded when many keys arrive", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
    for (let index = 0; index < 50; index += 1) limiter.check(`ip-${index}`, 0);
    expect(limiter.size()).toBeLessThanOrEqual(10);
  });
});
