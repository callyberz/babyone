import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { bootstrapAdmin, backfillRecordsUser } from "../seed.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
    INSERT INTO records (type, at, title, detail, meta) VALUES
      ('feed', '2026-01-01T00:00:00Z', 'feed', '', '{}'),
      ('sleep', '2026-01-02T00:00:00Z', 'sleep', '', '{}');
  `);
  applyAuthSchema(db);
});

describe("bootstrapAdmin", () => {
  it("creates the admin if users is empty and env vars are set", async () => {
    const id = await bootstrapAdmin(db, {
      email: "admin@example.com",
      password: "longenough",
      displayName: "Admin",
    });
    expect(id).toBeGreaterThan(0);
    const u = db.prepare("SELECT email FROM users WHERE id = ?").get(id);
    expect(u).toEqual({ email: "admin@example.com" });
  });

  it("returns null and does nothing when users already exist", async () => {
    await bootstrapAdmin(db, {
      email: "first@example.com",
      password: "longenough",
      displayName: "First",
    });
    const id2 = await bootstrapAdmin(db, {
      email: "second@example.com",
      password: "longenough",
      displayName: "Second",
    });
    expect(id2).toBeNull();
    const c = db.prepare("SELECT COUNT(*) AS c FROM users").get() as {
      c: number;
    };
    expect(c.c).toBe(1);
  });

  it("exits when users empty and creds missing", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((_: number) => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await bootstrapAdmin(db, null);
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });
});

describe("backfillRecordsUser", () => {
  it("assigns user_id to records that have none", () => {
    backfillRecordsUser(db, 99);
    const rows = db.prepare("SELECT user_id FROM records").all() as {
      user_id: number;
    }[];
    expect(rows.every((r) => r.user_id === 99)).toBe(true);
  });

  it("does not overwrite existing user_id", () => {
    db.prepare("UPDATE records SET user_id = 7 WHERE id = 1").run();
    backfillRecordsUser(db, 99);
    const rows = db.prepare("SELECT id, user_id FROM records").all() as {
      id: number;
      user_id: number;
    }[];
    expect(rows.find((r) => r.id === 1)?.user_id).toBe(7);
    expect(rows.find((r) => r.id === 2)?.user_id).toBe(99);
  });
});
