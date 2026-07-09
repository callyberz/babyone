import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer so we can assert whether insertRecord is called without a
// real SQLite file. handleLogRecord is the single choke point for new records
// created by the LLM, so the dedup guard lives there.
const insertRecordMock = vi.fn((r: Record<string, unknown>) => ({
  id: 99,
  type: r.type,
  at: r.at,
  title: r.title,
  detail: r.detail ?? "",
  meta: r.meta ?? {},
  user: null,
}));
const findDuplicateRecordMock = vi.fn<
  (opts: { type: string; at: string; title: string }) => unknown
>(() => null);

vi.mock("../db.js", () => ({
  insertRecord: insertRecordMock,
  findDuplicateRecord: findDuplicateRecordMock,
  findRecords: () => [],
  getRecord: () => null,
  updateRecord: (r: unknown) => r,
  deleteRecord: () => {},
}));

const { handleLogRecord } = await import("./server.js");

beforeEach(() => {
  insertRecordMock.mockClear();
  findDuplicateRecordMock.mockClear();
  findDuplicateRecordMock.mockReturnValue(null);
});

describe("handleLogRecord dedup guard", () => {
  it("inserts a new record when no duplicate exists", () => {
    const out = handleLogRecord({
      type: "feed",
      at: "2026-07-07T09:15:00",
      title: "Bottle — 3oz",
      _tzOffsetMin: 240,
    });
    expect(insertRecordMock).toHaveBeenCalledOnce();
    expect((out.result as { id: number }).id).toBe(99);
    expect(out.isError).toBeFalsy();
  });

  it("does NOT insert when an identical record already exists — returns the existing one", () => {
    findDuplicateRecordMock.mockReturnValue({
      id: 12,
      type: "feed",
      at: "2026-07-07T13:15:00.000Z",
      title: "Bottle — 3oz",
      detail: "",
      meta: {},
      user: null,
    });

    const out = handleLogRecord({
      type: "feed",
      at: "2026-07-07T09:15:00",
      title: "Bottle — 3oz",
      _tzOffsetMin: 240,
    });

    expect(insertRecordMock).not.toHaveBeenCalled();
    expect((out.result as { id: number }).id).toBe(12);
    expect(out.isError).toBeFalsy();
  });

  it("passes the resolved UTC timestamp to the duplicate check", () => {
    handleLogRecord({
      type: "feed",
      at: "2026-07-07T09:15:00",
      title: "Bottle — 3oz",
      _tzOffsetMin: 240, // EDT: local 09:15 -> 13:15 UTC
    });
    expect(findDuplicateRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "feed",
        title: "Bottle — 3oz",
        at: "2026-07-07T13:15:00.000Z",
      }),
    );
  });
});
