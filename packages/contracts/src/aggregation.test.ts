import { describe, expect, it } from "vitest";
import {
  aggregateFixedDays,
  aggregateLocalDays,
  aggregateRecords,
  type RoutineRecord,
} from "./index.js";

const records: RoutineRecord[] = [
  {
    id: 1,
    type: "feed",
    at: "2026-08-10T10:00:00.000Z",
    title: "Bottle",
    detail: "",
    meta: { volume_oz: 3 },
  },
  {
    id: 2,
    type: "sleep",
    at: "2026-08-10T12:00:00.000Z",
    title: "Nap",
    detail: "",
    meta: { mins: 45 },
  },
  {
    id: 3,
    type: "diaper",
    at: "2026-08-10T13:00:00.000Z",
    title: "Diaper",
    detail: "",
    meta: { kind: "both" },
  },
  {
    id: 4,
    type: "other",
    at: "2026-08-10T14:00:00.000Z",
    title: "Bath",
    detail: "",
    meta: { category: "bath" },
  },
];

describe("shared record aggregation", () => {
  it("counts recorded facts consistently", () => {
    expect(aggregateRecords(records)).toMatchObject({
      totalRecords: 4,
      feeds: 1,
      ozTotal: 3,
      sleepMins: 45,
      sleepSessions: 1,
      diapers: 1,
      diaperWet: 1,
      diaperDirty: 1,
      other: { bath: 1 },
    });
  });

  it("uses the same totals for local dashboard/trend buckets", () => {
    const bucket = aggregateLocalDays(
      records,
      1,
      new Date("2026-08-10T20:00:00.000Z"),
    )[0];
    expect(bucket).toMatchObject(aggregateRecords(records));
  });

  it("uses the same totals for fixed daily-brief buckets", () => {
    const { days, average } = aggregateFixedDays(
      records,
      new Date("2026-08-10T00:00:00.000Z"),
      new Date("2026-08-11T00:00:00.000Z"),
    );
    expect(days[0]).toEqual(aggregateRecords(records));
    expect(average).toEqual(days[0]);
  });
});
