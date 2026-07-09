import { describe, it, expect } from "vitest";
import { fmtDuration, recordChips } from "./utils";

describe("fmtDuration", () => {
  it("shows minutes under an hour", () => {
    expect(fmtDuration(45)).toBe("45 min");
    expect(fmtDuration(0)).toBe("0 min");
  });
  it("shows exact hours without minutes", () => {
    expect(fmtDuration(60)).toBe("1h");
    expect(fmtDuration(120)).toBe("2h");
  });
  it("shows hours and minutes for spans", () => {
    expect(fmtDuration(80)).toBe("1h 20m");
    expect(fmtDuration(155)).toBe("2h 35m");
  });
  it("rounds and clamps", () => {
    expect(fmtDuration(45.4)).toBe("45 min");
    expect(fmtDuration(-5)).toBe("0 min");
  });
});

describe("recordChips", () => {
  it("shows duration and location for sleep", () => {
    expect(
      recordChips({ type: "sleep", meta: { mins: 80, where: "crib" } }),
    ).toEqual([
      { icon: "⏱", text: "1h 20m" },
      { icon: "😴", text: "crib" },
    ]);
  });

  it("shows breastfeeding duration and side", () => {
    expect(
      recordChips({ type: "feed", meta: { mins: 22, side: "both" } }),
    ).toEqual([
      { icon: "⏱", text: "22 min" },
      { icon: "🤱", text: "both sides" },
    ]);
  });

  it("shows volume and duration for a bottle feed", () => {
    expect(
      recordChips({
        type: "feed",
        meta: { side: "bottle", volume_oz: 4, mins: 15 },
      }),
    ).toEqual([
      { icon: "🍼", text: "4 oz" },
      { icon: "⏱", text: "15 min" },
    ]);
  });

  it("treats a feed with volume as a bottle even without side", () => {
    expect(recordChips({ type: "feed", meta: { volume_oz: 3 } })).toEqual([
      { icon: "🍼", text: "3 oz" },
    ]);
  });

  it("shows diaper kind", () => {
    expect(recordChips({ type: "diaper", meta: { kind: "dirty" } })).toEqual([
      { icon: "💩", text: "dirty" },
    ]);
  });

  it("shows meds name and dose", () => {
    expect(
      recordChips({
        type: "meds",
        meta: { name: "Vitamin D", dose: "1 drop" },
      }),
    ).toEqual([{ icon: "💊", text: "Vitamin D" }, { text: "1 drop" }]);
  });

  it("returns nothing when meta is empty or missing", () => {
    expect(recordChips({ type: "sleep", meta: {} })).toEqual([]);
    expect(recordChips({ type: "diaper" })).toEqual([]);
    expect(recordChips({ type: "other", meta: { mins: 5 } })).toEqual([]);
  });
});
