import { describe, expect, it } from "vitest";
import { computeBriefWindow } from "./brief.js";

describe("computeBriefWindow", () => {
  it("preserves fixed-offset compatibility for older clients", () => {
    expect(computeBriefWindow("2026-08-13", 240)).toEqual({
      yesterdayStart: "2026-08-12T04:00:00.000Z",
      yesterdayEnd: "2026-08-13T04:00:00.000Z",
      baselineStart: "2026-08-05T04:00:00.000Z",
      todayEnd: "2026-08-14T04:00:00.000Z",
    });
  });

  it("uses the correct 23-hour local day across spring DST", () => {
    const window = computeBriefWindow(
      "2026-03-09",
      240,
      "America/Toronto",
    );
    expect(window.yesterdayStart).toBe("2026-03-08T05:00:00.000Z");
    expect(window.yesterdayEnd).toBe("2026-03-09T04:00:00.000Z");
    expect(
      Date.parse(window.yesterdayEnd) - Date.parse(window.yesterdayStart),
    ).toBe(23 * 60 * 60 * 1000);
  });

  it("uses the correct 25-hour local day across fall DST", () => {
    const window = computeBriefWindow(
      "2026-11-02",
      300,
      "America/Toronto",
    );
    expect(window.yesterdayStart).toBe("2026-11-01T04:00:00.000Z");
    expect(window.yesterdayEnd).toBe("2026-11-02T05:00:00.000Z");
    expect(
      Date.parse(window.yesterdayEnd) - Date.parse(window.yesterdayStart),
    ).toBe(25 * 60 * 60 * 1000);
  });
});
