import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  applyCoreSchema,
  claimBriefRequest,
  completeBriefRequest,
} from "./db.js";

let database: Database.Database;

beforeEach(() => {
  database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  applyCoreSchema(database);
});

describe("durable brief claims", () => {
  it("creates the claim table during core schema initialization", () => {
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'brief_requests'",
        )
        .get(),
    ).toEqual({ name: "brief_requests" });
  });

  it("allows one claimant and reports the other as pending", () => {
    const at = "2026-08-13T12:00:00.000Z";
    expect(claimBriefRequest({ localDate: "2026-08-13", at }, database)).toEqual({
      state: "claimed",
    });
    expect(claimBriefRequest({ localDate: "2026-08-13", at }, database)).toEqual({
      state: "pending",
    });
  });

  it("recovers a stale claim but not a fresh claim", () => {
    claimBriefRequest(
      { localDate: "2026-08-13", at: "2026-08-13T12:00:00.000Z" },
      database,
    );
    expect(
      claimBriefRequest(
        {
          localDate: "2026-08-13",
          at: "2026-08-13T12:04:59.000Z",
          staleAfterMs: 5 * 60_000,
        },
        database,
      ),
    ).toEqual({ state: "pending" });
    expect(
      claimBriefRequest(
        {
          localDate: "2026-08-13",
          at: "2026-08-13T12:05:01.000Z",
          staleAfterMs: 5 * 60_000,
        },
        database,
      ),
    ).toEqual({ state: "claimed" });
  });

  it("finalizes one durable message and returns it to later callers", () => {
    claimBriefRequest(
      { localDate: "2026-08-13", at: "2026-08-13T12:00:00.000Z" },
      database,
    );
    const completed = completeBriefRequest(
      {
        localDate: "2026-08-13",
        at: "2026-08-13T12:00:01.000Z",
        text: "A calm brief.",
      },
      database,
    );
    expect(completed.message?.text).toBe("A calm brief.");
    expect(
      claimBriefRequest(
        { localDate: "2026-08-13", at: "2026-08-13T12:00:02.000Z" },
        database,
      ),
    ).toEqual({ state: "completed", message: completed.message });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE kind = 'brief'")
        .get(),
    ).toEqual({ count: 1 });
  });
});
