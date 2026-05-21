import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import {
  createInvite,
  consumeInvite,
  cleanupExpiredInvites,
  INVITE_TTL_MS,
} from "./invites.js";

let db: Database.Database;
let userId: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES ('a@b.c', 'x', 'A', ?)",
      )
      .run(new Date().toISOString()).lastInsertRowid,
  );
});

describe("invites", () => {
  it("creates a unique 32-char base64url code with 24h TTL", () => {
    const inv = createInvite(db, userId);
    expect(inv.code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(new Date(inv.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      INVITE_TTL_MS - 5000,
    );
  });

  it("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) codes.add(createInvite(db, userId).code);
    expect(codes.size).toBe(500);
  });

  it("consumes a valid invite once", () => {
    const inv = createInvite(db, userId);
    expect(consumeInvite(db, inv.code, userId)).toBe(true);
    expect(consumeInvite(db, inv.code, userId)).toBe(false);
  });

  it("rejects expired invite", () => {
    const code = "expired-code";
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(code, userId, new Date(0).toISOString(), new Date(0).toISOString());
    expect(consumeInvite(db, code, userId)).toBe(false);
  });

  it("rejects unknown invite", () => {
    expect(consumeInvite(db, "nope", userId)).toBe(false);
  });

  it("cleanup removes expired unconsumed invites", () => {
    createInvite(db, userId); // good
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES ('old', ?, ?, ?)",
    ).run(userId, new Date(0).toISOString(), new Date(0).toISOString());
    cleanupExpiredInvites(db);
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM invites").get() as { c: number },
    ).toEqual({ c: 1 });
  });
});
