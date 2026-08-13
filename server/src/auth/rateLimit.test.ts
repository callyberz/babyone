import { describe, it, expect, beforeEach, vi } from "vitest";
import { LoginRateLimiter } from "./rateLimit.js";

describe("LoginRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
  });

  it("allows the first 10 attempts then blocks the 11th", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 10, windowMs: 15 * 60_000 });
    for (let i = 0; i < 10; i++) expect(rl.check("a@b.c")).toBe(true);
    expect(rl.check("a@b.c")).toBe(false);
  });

  it("resets after the window passes", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 2, windowMs: 1000 });
    expect(rl.check("a@b.c")).toBe(true);
    expect(rl.check("a@b.c")).toBe(true);
    expect(rl.check("a@b.c")).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(rl.check("a@b.c")).toBe(true);
  });

  it("tracks emails independently and is case-insensitive", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    expect(rl.check("A@B.c")).toBe(true);
    expect(rl.check("a@b.C")).toBe(false);
    expect(rl.check("other@x.y")).toBe(true);
  });

  it("can preserve case for case-sensitive secret keys", () => {
    const rl = new LoginRateLimiter({
      maxAttempts: 1,
      windowMs: 1000,
      caseInsensitive: false,
    });
    expect(rl.check("InviteABC")).toBe(true);
    expect(rl.check("InviteABC")).toBe(false);
    expect(rl.check("inviteABC")).toBe(true);
  });

  it("reset(email) clears the counter", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    rl.check("a@b.c");
    rl.reset("a@b.c");
    expect(rl.check("a@b.c")).toBe(true);
  });

  it("reports a rounded-up Retry-After for blocked attempts", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1500 });
    expect(rl.checkDetailed("key").allowed).toBe(true);
    expect(rl.checkDetailed("key")).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
    });
    vi.advanceTimersByTime(501);
    expect(rl.checkDetailed("key").retryAfterSeconds).toBe(1);
  });

  it("prunes expired buckets and bounds storage under arbitrary keys", () => {
    const rl = new LoginRateLimiter({
      maxAttempts: 1,
      windowMs: 1000,
      maxBuckets: 3,
    });
    for (let i = 0; i < 20; i++) rl.check(`key-${i}`);
    expect(rl.size).toBe(3);

    vi.advanceTimersByTime(1001);
    rl.check("fresh");
    expect(rl.size).toBe(1);
  });
});
