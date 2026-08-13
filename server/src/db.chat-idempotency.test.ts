import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCoreSchema,
  claimChatRequest,
  completeChatRequest,
} from "./db.js";

let testDb: Database.Database;
let userId: number;

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  applyCoreSchema(testDb);
  const info = testDb
    .prepare(
      "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("caregiver@example.com", "hash", "Caregiver", "2026-08-13T12:00:00.000Z");
  userId = Number(info.lastInsertRowid);
});

afterEach(() => testDb.close());

describe("chat request idempotency", () => {
  it("claims a request once and reports concurrent retries as pending", () => {
    const input = {
      userId,
      requestId: "request-12345678",
      text: "90 ml formula",
      at: "2026-08-13T12:00:00.000Z",
    };

    const first = claimChatRequest(input, testDb);
    const retry = claimChatRequest(input, testDb);

    expect(first).toMatchObject({
      state: "claimed",
      userMsg: { from: "user", text: "90 ml formula" },
    });
    expect(retry).toEqual({ state: "pending" });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toEqual({ count: 1 });
  });

  it("rejects reuse of a request id with different text", () => {
    claimChatRequest(
      {
        userId,
        requestId: "request-12345678",
        text: "wet diaper",
        at: "2026-08-13T12:00:00.000Z",
      },
      testDb,
    );

    expect(
      claimChatRequest(
        {
          userId,
          requestId: "request-12345678",
          text: "dirty diaper",
          at: "2026-08-13T12:00:01.000Z",
        },
        testDb,
      ),
    ).toEqual({ state: "conflict" });
  });

  it("returns the exact completed response without duplicating messages", () => {
    const requestId = "request-12345678";
    claimChatRequest(
      {
        userId,
        requestId,
        text: "wet diaper",
        at: "2026-08-13T12:00:00.000Z",
      },
      testDb,
    );
    const response = completeChatRequest(
      {
        userId,
        requestId,
        bot: {
          from: "bot",
          at: "2026-08-13T12:00:01.000Z",
          text: "Logged a wet diaper.",
          recordIds: [9],
        },
        created: [],
        updated: [],
        deleted: [],
      },
      testDb,
    );

    const retry = claimChatRequest(
      {
        userId,
        requestId,
        text: "wet diaper",
        at: "2026-08-13T12:01:00.000Z",
      },
      testDb,
    );
    expect(retry).toEqual({ state: "completed", response });
    expect(
      testDb.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toEqual({ count: 2 });
  });
});
