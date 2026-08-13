import { describe, expect, it } from "vitest";
import { ruleBasedParse } from "./parser.js";

describe("rule-based parser", () => {
  it("converts millilitres to ounces while preserving the entered unit", () => {
    const result = ruleBasedParse("90 ml formula");

    expect(result.draft).toMatchObject({
      type: "feed",
      title: "Bottle — 90 ml",
      meta: { volume_oz: 3.043, side: "bottle" },
    });
    expect(result.replyText).toBe("Logged a 90 ml bottle.");
  });

  it("keeps ounce input unchanged", () => {
    const result = ruleBasedParse("3.5 oz bottle");

    expect(result.draft).toMatchObject({
      title: "Bottle — 3.5 oz",
      meta: { volume_oz: 3.5 },
    });
  });

  it("interprets explicit clock times in the caregiver offset", () => {
    const now = new Date("2026-08-13T18:00:00.000Z"); // 2pm at UTC-4
    const result = ruleBasedParse("3 oz bottle at 1pm", now, 240);

    expect(result.draft?.at).toBe("2026-08-13T17:00:00.000Z");
  });

  it("uses the prior caregiver-local day for a future clock time", () => {
    const now = new Date("2026-08-13T05:00:00.000Z"); // 1am at UTC-4
    const result = ruleBasedParse("3 oz bottle at 11pm", now, 240);

    expect(result.draft?.at).toBe("2026-08-13T03:00:00.000Z");
  });
});
