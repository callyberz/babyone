import { beforeEach, describe, expect, it, vi } from "vitest";

const records = new Map<number, Record<string, unknown>>();
let nextId = 1;
const insertRecord = vi.fn((record: Record<string, unknown>) => {
  const saved = { ...record, id: nextId++, user: null };
  records.set(saved.id, saved);
  return saved;
});
const updateRecord = vi.fn((record: Record<string, unknown>) => {
  records.set(record.id as number, record);
  return record;
});
const deleteRecord = vi.fn((id: number) => records.delete(id));
const findRecords = vi.fn(() => [...records.values()]);
const findDuplicateRecord = vi.fn(() => null as Record<string, unknown> | null);
const getRecord = vi.fn((id: number) => records.get(id) ?? null);

vi.mock("../db.js", () => ({
  insertRecord,
  updateRecord,
  deleteRecord,
  findRecords,
  findDuplicateRecord,
  getRecord,
}));

const {
  callRecordTool,
  handleDeleteRecord,
  handleFindRecords,
  handleLogRecord,
  handleUpdateRecord,
} = await import("./tools.js");

beforeEach(() => {
  records.clear();
  nextId = 1;
  vi.clearAllMocks();
  findDuplicateRecord.mockReturnValue(null);
});

describe("in-process record tools", () => {
  it("creates, attributes, and timezone-normalizes", () => {
    const result = handleLogRecord(
      {
        type: "feed",
        at: "2026-08-10T09:15:00",
        title: "Bottle — 3 oz",
        meta: { volume_oz: 3 },
      },
      { loggerId: 7, tzOffsetMin: 240 },
    );
    expect(result.isError).toBeFalsy();
    expect(findDuplicateRecord).toHaveBeenCalledWith(
      expect.objectContaining({ at: "2026-08-10T13:15:00.000Z" }),
    );
    expect(insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        at: "2026-08-10T13:15:00.000Z",
        userId: 7,
      }),
    );
  });

  it("deduplicates without inserting", () => {
    findDuplicateRecord.mockReturnValue({
      id: 8,
      type: "feed",
      at: "2026-08-10T13:15:00.000Z",
      title: "Bottle",
    });
    const result = handleLogRecord({
      type: "feed",
      at: "2026-08-10T13:15:00.000Z",
      title: "Bottle",
      meta: {},
    });
    expect(insertRecord).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ id: 8, deduped: true });
  });

  it("updates and shallow-merges metadata", () => {
    records.set(3, {
      id: 3,
      type: "sleep",
      at: "2026-08-10T12:00:00.000Z",
      title: "Nap",
      detail: "crib",
      meta: { mins: 30, where: "crib" },
      user: { id: 7, displayName: "Alex" },
    });
    const result = handleUpdateRecord({ id: 3, meta: { mins: 45 } });
    expect(result.isError).toBeFalsy();
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { mins: 45, where: "crib" } }),
    );
  });

  it("deletes an existing record", () => {
    records.set(4, {
      id: 4,
      type: "mood",
      at: "2026-08-10T12:00:00.000Z",
      title: "Happy",
      detail: "",
      meta: { kind: "happy" },
    });
    expect(handleDeleteRecord({ id: 4 }).isError).toBeFalsy();
    expect(deleteRecord).toHaveBeenCalledWith(4);
  });

  it("finds records through the shared DB query", () => {
    records.set(5, {
      id: 5,
      type: "play",
      at: "2026-08-10T12:00:00.000Z",
      title: "Play",
      detail: "",
      meta: { mins: 5 },
    });
    const result = handleFindRecords({ type: "play", limit: 10 });
    expect(result.result).toEqual([
      expect.objectContaining({ id: 5, type: "play" }),
    ]);
    expect(findRecords).toHaveBeenCalledWith(
      expect.objectContaining({ type: "play", limit: 10 }),
    );
  });

  it("returns adapter-ready text from the direct dispatcher", () => {
    const outcome = callRecordTool("find_records", {});
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.text)).toEqual([]);
  });
});
