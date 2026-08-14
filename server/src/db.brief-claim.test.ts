import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  applyCoreSchema,
  claimBriefRequest,
  completeBriefRequest,
  releaseBriefRequest,
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
      claimedAt: at,
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
    ).toEqual({ state: "claimed", claimedAt: "2026-08-13T12:05:01.000Z" });
  });

  it("finalizes one durable message and returns it to later callers", () => {
    const claim = claimBriefRequest(
      { localDate: "2026-08-13", at: "2026-08-13T12:00:00.000Z" },
      database,
    );
    if (claim.state !== "claimed") throw new Error("expected claim");
    const completed = completeBriefRequest(
      {
        localDate: "2026-08-13",
        claimedAt: claim.claimedAt,
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

  it("releases a failed claim for immediate retry", () => {
    const first = claimBriefRequest(
      { localDate: "2026-08-13", at: "2026-08-13T12:00:00.000Z" },
      database,
    );
    if (first.state !== "claimed") throw new Error("expected claim");

    expect(
      releaseBriefRequest(
        { localDate: "2026-08-13", claimedAt: first.claimedAt },
        database,
      ),
    ).toBe(true);
    expect(
      claimBriefRequest(
        { localDate: "2026-08-13", at: "2026-08-13T12:00:01.000Z" },
        database,
      ),
    ).toEqual({
      state: "claimed",
      claimedAt: "2026-08-13T12:00:01.000Z",
    });
  });

  it("does not release or complete a newer claimant's reservation", () => {
    const first = claimBriefRequest(
      { localDate: "2026-08-13", at: "2026-08-13T12:00:00.000Z" },
      database,
    );
    if (first.state !== "claimed") throw new Error("expected first claim");
    const second = claimBriefRequest(
      {
        localDate: "2026-08-13",
        at: "2026-08-13T12:05:01.000Z",
        staleAfterMs: 5 * 60_000,
      },
      database,
    );
    if (second.state !== "claimed") throw new Error("expected second claim");

    expect(
      releaseBriefRequest(
        { localDate: "2026-08-13", claimedAt: first.claimedAt },
        database,
      ),
    ).toBe(false);
    expect(
      completeBriefRequest(
        {
          localDate: "2026-08-13",
          claimedAt: first.claimedAt,
          at: "2026-08-13T12:05:02.000Z",
          text: "Stale result",
        },
        database,
      ),
    ).toEqual({ message: null, reason: "in_progress" });
    expect(
      completeBriefRequest(
        {
          localDate: "2026-08-13",
          claimedAt: second.claimedAt,
          at: "2026-08-13T12:05:03.000Z",
          text: "Current result",
        },
        database,
      ).message?.text,
    ).toBe("Current result");
  });
});
