import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import {
  createSession,
  findSession,
  deleteSession,
  cleanupExpiredSessions,
  SESSION_TTL_MS,
} from "./sessions.js";

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
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("a@b.c", "x", "A", new Date().toISOString());
  userId = Number(info.lastInsertRowid);
});

describe("sessions", () => {
  it("creates and finds a session", () => {
    const sid = createSession(db, userId, "");
    expect(sid).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const row = findSession(db, sid);
    expect(row).toMatchObject({ userId, email: "a@b.c", displayName: "A" });
  });

  it("returns null for unknown session", () => {
    expect(findSession(db, "nope")).toBeNull();
  });

  it("ignores expired sessions", () => {
    const sid = "sid-expired";
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')",
    ).run(sid, userId, new Date(0).toISOString(), new Date(0).toISOString());
    expect(findSession(db, sid)).toBeNull();
  });

  it("deleteSession removes the row", () => {
    const sid = createSession(db, userId, "");
    deleteSession(db, sid);
    expect(findSession(db, sid)).toBeNull();
  });

  it("cleanupExpiredSessions deletes only expired", () => {
    const goodSid = createSession(db, userId, "");
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES ('old', ?, ?, ?, '')",
    ).run(userId, new Date(0).toISOString(), new Date(0).toISOString());
    cleanupExpiredSessions(db);
    expect(findSession(db, goodSid)).not.toBeNull();
    expect(findSession(db, "old")).toBeNull();
  });

  it("SESSION_TTL_MS is 30 days", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
