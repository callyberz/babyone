import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCoreSchema,
  createRecordIdempotently,
} from "./db.js";

let testDb: Database.Database;
let userId: number;

const baseRecord = {
  type: "feed" as const,
  at: "2026-08-14T12:00:00.000Z",
  title: "Bottle",
  detail: "Morning feed",
  meta: { volume_oz: 3, side: "bottle" as const },
};

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  applyCoreSchema(testDb);
  userId = Number(
    testDb
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        "caregiver@example.com",
        "hash",
        "Caregiver",
        "2026-08-14T00:00:00.000Z",
      ).lastInsertRowid,
  );
});

afterEach(() => testDb.close());

describe("direct record request idempotency", () => {
  it("creates once and replays the exact response for an equivalent payload", () => {
    const input = {
      userId,
      requestId: "record-request-123",
      record: baseRecord,
      createdAt: "2026-08-14T12:00:01.000Z",
    };

    const first = createRecordIdempotently(input, testDb);
    const retry = createRecordIdempotently(
      {
        ...input,
        record: {
          ...baseRecord,
          meta: { side: "bottle", volume_oz: 3 },
        },
        createdAt: "2026-08-14T12:01:00.000Z",
      },
      testDb,
    );

    expect(first).toMatchObject({ state: "created" });
    if (first.state !== "created") throw new Error("request was not created");
    expect(retry).toEqual({
      state: "completed",
      record: first.record,
    });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM records").get(),
    ).toEqual({ count: 1 });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM record_requests").get(),
    ).toEqual({ count: 1 });
  });

  it("conflicts when the same request id is reused with a different payload", () => {
    createRecordIdempotently(
      {
        userId,
        requestId: "record-request-123",
        record: baseRecord,
        createdAt: "2026-08-14T12:00:01.000Z",
      },
      testDb,
    );

    expect(
      createRecordIdempotently(
        {
          userId,
          requestId: "record-request-123",
          record: { ...baseRecord, title: "Different bottle" },
          createdAt: "2026-08-14T12:00:02.000Z",
        },
        testDb,
      ),
    ).toEqual({ state: "conflict" });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM records").get(),
    ).toEqual({ count: 1 });
  });

  it("retains the receipt after deletion so a delayed retry cannot resurrect the record", () => {
    const input = {
      userId,
      requestId: "record-request-123",
      record: baseRecord,
      createdAt: "2026-08-14T12:00:01.000Z",
    };
    const first = createRecordIdempotently(input, testDb);
    if (first.state !== "created") throw new Error("request was not created");
    testDb.prepare("DELETE FROM records WHERE id = ?").run(first.record.id);

    expect(createRecordIdempotently(input, testDb)).toEqual({ state: "gone" });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM records").get(),
    ).toEqual({ count: 0 });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM record_requests").get(),
    ).toEqual({ count: 1 });
  });

  it("returns current record state after an edit instead of the stale creation snapshot", () => {
    const input = {
      userId,
      requestId: "record-request-123",
      record: baseRecord,
      createdAt: "2026-08-14T12:00:01.000Z",
    };
    const first = createRecordIdempotently(input, testDb);
    if (first.state !== "created") throw new Error("request was not created");
    testDb
      .prepare("UPDATE records SET title = ? WHERE id = ?")
      .run("Corrected bottle", first.record.id);

    expect(createRecordIdempotently(input, testDb)).toMatchObject({
      state: "completed",
      record: { id: first.record.id, title: "Corrected bottle" },
    });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM records").get(),
    ).toEqual({ count: 1 });
  });

  it("enforces request and receipt size limits at the storage boundary", () => {
    const oversizedJson = JSON.stringify({ value: "x".repeat(70_000) });
    expect(() =>
      testDb
        .prepare(
          "INSERT INTO record_requests (user_id, request_id, payload_json, response_json, created_at) VALUES (?, 'short', '{}', '{}', ?)",
        )
        .run(userId, "2026-08-14T12:00:01.000Z"),
    ).toThrow();
    expect(() =>
      testDb
        .prepare(
          "INSERT INTO record_requests (user_id, request_id, payload_json, response_json, created_at) VALUES (?, ?, ?, '{}', ?)",
        )
        .run(
          userId,
          "record-request-123",
          oversizedJson,
          "2026-08-14T12:00:01.000Z",
        ),
    ).toThrow();
    expect(() =>
      testDb
        .prepare(
          "INSERT INTO record_requests (user_id, request_id, payload_json, response_json, created_at) VALUES (?, ?, '{}', ?, ?)",
        )
        .run(
          userId,
          "record-request-456",
          oversizedJson,
          "2026-08-14T12:00:01.000Z",
        ),
    ).toThrow();
  });

  it("rolls record creation back if its receipt cannot be committed", () => {
    expect(() =>
      createRecordIdempotently(
        {
          userId,
          requestId: "short",
          record: baseRecord,
          createdAt: "2026-08-14T12:00:01.000Z",
        },
        testDb,
      ),
    ).toThrow();
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM records").get(),
    ).toEqual({ count: 0 });
  });
});
