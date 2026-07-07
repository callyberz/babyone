import { describe, it, expect } from "vitest";

// llm.ts checks ANTHROPIC_API_KEY at import time; not relevant here since we
// only exercise the pure message-building helper.
const { buildInitialMessages } = await import("./llm.js");

describe("buildInitialMessages", () => {
  it("appends the current turn as the final user message when history is empty", () => {
    const msgs = buildInitialMessages([], "parent said: hi");
    expect(msgs).toEqual([{ role: "user", content: "parent said: hi" }]);
  });

  it("prepends prior turns before the current turn", () => {
    const msgs = buildInitialMessages(
      [
        { role: "user", text: "3ml formula 20 mins ago" },
        { role: "assistant", text: "What was the event 20 mins ago?" },
      ],
      "parent said: I mean Jul 7 morning",
    );
    expect(msgs).toEqual([
      { role: "user", content: "3ml formula 20 mins ago" },
      { role: "assistant", content: "What was the event 20 mins ago?" },
      { role: "user", content: "parent said: I mean Jul 7 morning" },
    ]);
  });

  it("drops leading assistant turns so the array always starts with a user message", () => {
    const msgs = buildInitialMessages(
      [
        { role: "assistant", text: "Good morning! (daily brief)" },
        { role: "user", text: "changed diaper" },
        { role: "assistant", text: "Logged the diaper change." },
      ],
      "parent said: and a feed too",
    );
    expect(msgs[0]).toEqual({ role: "user", content: "changed diaper" });
    expect(msgs).toHaveLength(3);
  });
});
