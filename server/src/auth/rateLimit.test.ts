import { describe, it, expect, beforeEach, vi } from "vitest";
import { LoginRateLimiter } from "./rateLimit.js";

describe("LoginRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());

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

  it("reset(email) clears the counter", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    rl.check("a@b.c");
    rl.reset("a@b.c");
    expect(rl.check("a@b.c")).toBe(true);
  });
});
