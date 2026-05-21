import { randomBytes } from "node:crypto";
import type DatabaseT from "better-sqlite3";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Invite {
  code: string;
  createdBy: number;
  expiresAt: string;
}

function newCode(): string {
  return randomBytes(24).toString("base64url");
}

export function createInvite(
  db: DatabaseT.Database,
  createdBy: number,
): Invite {
  const code = newCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  db.prepare(
    "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(code, createdBy, now.toISOString(), expiresAt.toISOString());
  return { code, createdBy, expiresAt: expiresAt.toISOString() };
}

// Returns true if the invite was valid and is now marked consumed by `userId`.
export function consumeInvite(
  db: DatabaseT.Database,
  code: string,
  userId: number,
): boolean {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE invites
       SET consumed_by = ?, consumed_at = ?
       WHERE code = ? AND consumed_by IS NULL AND expires_at > ?`,
    )
    .run(userId, now, code, now);
  return info.changes === 1;
}

export function cleanupExpiredInvites(db: DatabaseT.Database): void {
  db.prepare(
    "DELETE FROM invites WHERE consumed_by IS NULL AND expires_at < ?",
  ).run(new Date().toISOString());
}
