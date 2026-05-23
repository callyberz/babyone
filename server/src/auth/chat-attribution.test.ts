import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer so we can inspect what insertRecord is called with
// without spinning up a real SQLite file. The rule-based parser produces a
// deterministic draft for simple inputs, so llmParse → fallbackPath →
// insertRecord is testable in isolation.
const insertRecordMock = vi.fn((r: Record<string, unknown>) => ({
  id: 42,
  type: r.type,
  at: r.at,
  title: r.title,
  detail: r.detail ?? "",
  meta: r.meta ?? {},
  user: null,
}));

vi.mock("../db.js", () => ({
  insertRecord: insertRecordMock,
  findRecords: () => [],
  getRecord: () => null,
}));

// llm.ts checks ANTHROPIC_API_KEY at import time. Clear it so we go down
// the fallback path (which is what we want to test).
const originalKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { llmParse } = await import("../llm.js");

beforeEach(() => {
  insertRecordMock.mockClear();
});

describe("llmParse fallback path attribution", () => {
  it("threads loggerId through to insertRecord", async () => {
    const now = new Date("2026-06-01T12:00:00Z");
    await llmParse("3 oz bottle", now, 7);
    expect(insertRecordMock).toHaveBeenCalledOnce();
    expect(insertRecordMock.mock.calls[0]?.[0]).toMatchObject({ userId: 7 });
  });

  it("passes userId=null when no logger is supplied", async () => {
    await llmParse("3 oz bottle", new Date("2026-06-01T12:00:00Z"));
    expect(insertRecordMock).toHaveBeenCalledOnce();
    expect(insertRecordMock.mock.calls[0]?.[0]).toMatchObject({ userId: null });
  });

  it("does not call insertRecord when the parser produces no draft", async () => {
    // "hi" is plain chat — no actionable draft.
    await llmParse("hi", new Date("2026-06-01T12:00:00Z"), 7);
    expect(insertRecordMock).not.toHaveBeenCalled();
  });
});

// restore env for any later tests that share this worker
if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
