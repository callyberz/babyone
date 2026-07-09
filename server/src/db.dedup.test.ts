import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the db singleton at a throwaway SQLite file before importing it, so we
// exercise the real query (not a mock). Vitest isolates modules per test file.
process.env.BABYONE_DB = join(
  mkdtempSync(join(tmpdir(), "babyone-dedup-")),
  "t.db",
);

const { insertRecord, findDuplicateRecord } = await import("./db.js");

const AT = "2026-07-07T13:15:00.000Z";
insertRecord({
  type: "feed",
  at: AT,
  title: "Bottle — 3oz",
  detail: "",
  meta: {},
  userId: null,
});

describe("findDuplicateRecord", () => {
  it("matches an identical record (same type, title, exact at)", () => {
    const dup = findDuplicateRecord({
      type: "feed",
      at: AT,
      title: "Bottle — 3oz",
    });
    expect(dup?.title).toBe("Bottle — 3oz");
  });

  it("matches within the time window (60s later)", () => {
    const dup = findDuplicateRecord({
      type: "feed",
      at: "2026-07-07T13:16:00.000Z",
      title: "Bottle — 3oz",
    });
    expect(dup).not.toBeNull();
  });

  it("does not match outside the window (5 min later)", () => {
    const dup = findDuplicateRecord({
      type: "feed",
      at: "2026-07-07T13:20:00.000Z",
      title: "Bottle — 3oz",
    });
    expect(dup).toBeNull();
  });

  it("does not match a different title", () => {
    expect(
      findDuplicateRecord({ type: "feed", at: AT, title: "Bottle — 4oz" }),
    ).toBeNull();
  });

  it("does not match a different type", () => {
    expect(
      findDuplicateRecord({ type: "sleep", at: AT, title: "Bottle — 3oz" }),
    ).toBeNull();
  });
});
