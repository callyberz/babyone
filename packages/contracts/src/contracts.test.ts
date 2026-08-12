import { describe, expect, it } from "vitest";
import {
  RECORD_TYPES,
  validateRecordDraft,
  type RecordType,
} from "./index.js";

const validMeta: Record<RecordType, Record<string, unknown>> = {
  feed: { volume_oz: 3, side: "bottle", mins: 15 },
  sleep: { mins: 45, where: "crib" },
  diaper: { kind: "both" },
  meds: { name: "prescribed medicine", dose: "recorded dose" },
  play: { mins: 5 },
  mood: { kind: "happy" },
  other: { category: "bath" },
};

describe("record contracts", () => {
  for (const type of RECORD_TYPES) {
    it(`accepts a valid ${type} record`, () => {
      const result = validateRecordDraft({
        type,
        at: "2026-08-10T12:00:00.000Z",
        title: `${type} entry`,
        detail: "",
        meta: validMeta[type],
      });
      expect(result.ok).toBe(true);
    });
  }

  it("rejects non-canonical types", () => {
    const result = validateRecordDraft({
      type: "bath",
      at: "2026-08-10T12:00:00.000Z",
      title: "Bath",
      meta: {},
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("requires a category for other records", () => {
    const result = validateRecordDraft({
      type: "other",
      at: "2026-08-10T12:00:00.000Z",
      title: "Other",
      meta: {},
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects invalid type-specific metadata", () => {
    expect(
      validateRecordDraft({
        type: "diaper",
        at: "2026-08-10T12:00:00.000Z",
        title: "Diaper",
        meta: { kind: "maybe" },
      }).ok,
    ).toBe(false);
    expect(
      validateRecordDraft({
        type: "feed",
        at: "2026-08-10T12:00:00.000Z",
        title: "Feed",
        meta: { volume_oz: -1 },
      }).ok,
    ).toBe(false);
  });
});
