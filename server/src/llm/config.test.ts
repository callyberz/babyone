import { describe, expect, it } from "vitest";
import { LlmStateTracker } from "./config.js";

describe("LLM runtime states", () => {
  it("reports unavailable and retains the safe fallback boundary", () => {
    const tracker = new LlmStateTracker(false);
    tracker.degraded("request_failed");
    expect(tracker.status()).toMatchObject({
      state: "unavailable",
      fallback: "rule-based",
    });
  });

  it("reports configured request failures as degraded", () => {
    const tracker = new LlmStateTracker(true);
    tracker.degraded("chat_request_failed");
    expect(tracker.status()).toMatchObject({
      state: "degraded",
      reason: "chat_request_failed",
      fallback: "rule-based",
    });
  });

  it("recovers to healthy after a successful request", () => {
    const tracker = new LlmStateTracker(true);
    tracker.degraded("brief_request_failed");
    tracker.healthy();
    expect(tracker.status()).toMatchObject({ state: "healthy" });
    expect(tracker.status()).not.toHaveProperty("reason");
  });
});
