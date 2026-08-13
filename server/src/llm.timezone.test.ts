import { describe, expect, it, vi } from "vitest";

const findRecords = vi.fn(() => [
  {
    id: 7,
    type: "feed",
    at: "2026-08-13T04:30:00.000Z",
    title: "Bottle",
    detail: "",
    meta: { volume_oz: 3 },
    user: null,
  },
]);

vi.mock("./db.js", () => ({
  findRecords,
  getRecord: vi.fn(),
}));

const { summariseTodaysRecords } = await import("./llm.js");

describe("today's-record context", () => {
  it("queries from caregiver-local midnight and displays caregiver-local time", () => {
    const summary = summariseTodaysRecords(
      new Date("2026-08-13T05:00:00.000Z"),
      240,
    );

    expect(findRecords).toHaveBeenCalledWith({
      since: "2026-08-13T04:00:00.000Z",
      limit: 50,
    });
    expect(summary).toContain("00:30 — Bottle");
  });
});
