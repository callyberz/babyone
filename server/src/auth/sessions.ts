import { randomBytes } from "node:crypto";
import type DatabaseT from "better-sqlite3";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionLookup {
  sessionId: string;
  userId: number;
  email: string;
  displayName: string;
  expiresAt: string;
}

function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function createSession(
  db: DatabaseT.Database,
  userId: number,
  userAgent: string,
): string {
  const id = newSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, now.toISOString(), expiresAt.toISOString(), userAgent);
  return id;
}

export function findSession(
  db: DatabaseT.Database,
  sid: string,
): SessionLookup | null {
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.user_id AS uid, s.expires_at AS exp,
              u.email AS email, u.display_name AS name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sid) as
    | { sid: string; uid: number; exp: string; email: string; name: string }
    | undefined;
  if (!row) return null;
  if (row.exp < new Date().toISOString()) return null;
  return {
    sessionId: row.sid,
    userId: row.uid,
    email: row.email,
    displayName: row.name,
    expiresAt: row.exp,
  };
}

export function deleteSession(db: DatabaseT.Database, sid: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
}

export function cleanupExpiredSessions(db: DatabaseT.Database): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(
    new Date().toISOString(),
  );
}
