import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "./db.js";

describe("applyAuthSchema", () => {
  it("creates users, sessions, invites tables idempotently", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
      );
    `);
    applyAuthSchema(db);
    applyAuthSchema(db); // second run is a no-op

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["users", "sessions", "invites"]),
    );

    const cols = db.prepare("PRAGMA table_info(records)").all() as {
      name: string;
    }[];
    expect(cols.some((c) => c.name === "user_id")).toBe(true);
  });
});
