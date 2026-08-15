import { describe, expect, it } from "vitest";
import {
  MAX_BULK_DELETE_IDS,
  MAX_CHAT_TEXT_LENGTH,
  parseOptionalRequestId,
  parseRecordId,
  parseSyncCursor,
  validateBriefRequest,
  validateBulkDeleteRequest,
  validateChatRequest,
} from "./httpValidation.js";

describe("validateChatRequest", () => {
  it("accepts and trims text with an optional valid timezone offset", () => {
    expect(
      validateChatRequest({
        text: "  wet diaper  ",
        tzOffsetMin: 240,
        requestId: "d9729c80-8c58-4c74-a1a2-231807c0a031",
      }),
    ).toEqual({
      ok: true,
      value: {
        text: "wet diaper",
        tzOffsetMin: 240,
        requestId: "d9729c80-8c58-4c74-a1a2-231807c0a031",
      },
    });
    expect(validateChatRequest({ text: "hello" })).toEqual({
      ok: true,
      value: { text: "hello", tzOffsetMin: null, requestId: null },
    });
  });

  it.each([
    null,
    [],
    {},
    { text: 123 },
    { text: "   " },
    { text: "x".repeat(MAX_CHAT_TEXT_LENGTH + 1) },
    { text: "hello", tzOffsetMin: null },
    { text: "hello", tzOffsetMin: Number.NaN },
    { text: "hello", tzOffsetMin: Number.POSITIVE_INFINITY },
    { text: "hello", tzOffsetMin: 60.5 },
    { text: "hello", tzOffsetMin: 841 },
    { text: "hello", requestId: "short" },
    { text: "hello", requestId: "spaces are not valid" },
    { text: "hello", requestId: "x".repeat(129) },
  ])("rejects an invalid chat body: %j", (body) => {
    expect(validateChatRequest(body)).toEqual({ ok: false });
  });
});

describe("parseOptionalRequestId", () => {
  it("accepts an omitted or valid request id", () => {
    expect(parseOptionalRequestId({ type: "feed" })).toBeNull();
    expect(
      parseOptionalRequestId({ requestId: "record-request-123" }),
    ).toBe("record-request-123");
  });

  it.each([
    null,
    [],
    { requestId: null },
    { requestId: "short" },
    { requestId: "contains spaces" },
    { requestId: "x".repeat(129) },
  ])("rejects an invalid request id container or value: %j", (input) => {
    expect(parseOptionalRequestId(input)).toBe(false);
  });
});

describe("validateBriefRequest", () => {
  it("accepts a real calendar date and finite whole-minute offset", () => {
    expect(
      validateBriefRequest({ localDate: "2026-08-13", tzOffsetMin: -840 }),
    ).toEqual({
      ok: true,
      value: { localDate: "2026-08-13", tzOffsetMin: -840, timeZone: null },
    });
    expect(
      validateBriefRequest({
        localDate: "2026-11-01",
        tzOffsetMin: 240,
        timeZone: "America/Toronto",
      }),
    ).toEqual({
      ok: true,
      value: {
        localDate: "2026-11-01",
        tzOffsetMin: 240,
        timeZone: "America/Toronto",
      },
    });
  });

  it.each([
    null,
    {},
    { localDate: "2026-02-30", tzOffsetMin: 0 },
    { localDate: "2026-2-03", tzOffsetMin: 0 },
    { localDate: "not-a-date", tzOffsetMin: 0 },
    { localDate: "2026-08-13" },
    { localDate: "2026-08-13", tzOffsetMin: "240" },
    { localDate: "2026-08-13", tzOffsetMin: Number.NaN },
    { localDate: "2026-08-13", tzOffsetMin: 900 },
    { localDate: "2026-08-13", tzOffsetMin: 0, timeZone: "Not/A_Zone" },
    { localDate: "2026-08-13", tzOffsetMin: 0, timeZone: "GMT+4" },
  ])("rejects an invalid brief body: %j", (body) => {
    expect(validateBriefRequest(body)).toEqual({ ok: false });
  });
});

describe("record id validation", () => {
  it.each(["1", "42", String(Number.MAX_SAFE_INTEGER)])(
    "accepts positive integer id %s",
    (value) => expect(parseRecordId(value)).toBe(Number(value)),
  );

  it.each(["", "0", "-1", "1.5", "1e2", "01", "abc", "9007199254740992"])(
    "rejects invalid id %s",
    (value) => expect(parseRecordId(value)).toBeNull(),
  );
});

describe("sync cursor validation", () => {
  it("distinguishes a missing cursor from a valid non-negative cursor", () => {
    expect(parseSyncCursor(undefined)).toBeNull();
    expect(parseSyncCursor("0")).toBe(0);
    expect(parseSyncCursor("42")).toBe(42);
  });

  it.each(["", "-1", "1.5", "01", "abc", "9007199254740992"])(
    "rejects invalid cursor %s",
    (value) => expect(parseSyncCursor(value)).toBe(false),
  );
});

describe("validateBulkDeleteRequest", () => {
  it("accepts positive safe integers and deduplicates them", () => {
    expect(validateBulkDeleteRequest({ ids: [3, 1, 3, 2] })).toEqual({
      ok: true,
      value: [3, 1, 2],
    });
  });

  it.each([
    null,
    {},
    { ids: [] },
    { ids: [0] },
    { ids: [-1] },
    { ids: [1.5] },
    { ids: [Number.NaN] },
    { ids: [Number.MAX_SAFE_INTEGER + 1] },
    { ids: ["1"] },
    { ids: Array.from({ length: MAX_BULK_DELETE_IDS + 1 }, (_, i) => i + 1) },
  ])("rejects invalid bulk-delete body", (body) => {
    expect(validateBulkDeleteRequest(body)).toEqual({ ok: false });
  });
});
