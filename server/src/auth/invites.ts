import { createHash, randomBytes } from "node:crypto";
import type DatabaseT from "better-sqlite3";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Invite {
  id: string;
  code: string;
  createdBy: number;
  expiresAt: string;
}

export interface PendingInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
  createdBy: {
    id: number;
    displayName: string;
  };
}

function newCode(): string {
  return randomBytes(24).toString("base64url");
}

export function invitePublicId(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
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
  return {
    id: invitePublicId(code),
    code,
    createdBy,
    expiresAt: expiresAt.toISOString(),
  };
}

export function listPendingInvites(
  db: DatabaseT.Database,
  now = new Date(),
): PendingInvite[] {
  return (
    db
      .prepare(
        `SELECT i.code, i.created_at, i.expires_at,
                u.id AS creator_id, u.display_name AS creator_name
         FROM invites i
         JOIN users u ON u.id = i.created_by
         WHERE i.consumed_by IS NULL AND i.expires_at > ?
         ORDER BY i.expires_at, i.created_at, i.code`,
      )
      .all(now.toISOString()) as Array<{
      code: string;
      created_at: string;
      expires_at: string;
      creator_id: number;
      creator_name: string;
    }>
  ).map((row) => ({
    id: invitePublicId(row.code),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    createdBy: {
      id: row.creator_id,
      displayName: row.creator_name,
    },
  }));
}

export function revokePendingInvite(
  db: DatabaseT.Database,
  publicId: string,
  now = new Date(),
): boolean {
  const nowIso = now.toISOString();
  const match = (
    db
      .prepare(
        `SELECT code FROM invites
         WHERE consumed_by IS NULL AND expires_at > ?`,
      )
      .all(nowIso) as Array<{ code: string }>
  ).find((invite) => invitePublicId(invite.code) === publicId);
  if (!match) return false;
  return (
    db
      .prepare(
        `DELETE FROM invites
         WHERE code = ? AND consumed_by IS NULL AND expires_at > ?`,
      )
      .run(match.code, nowIso).changes === 1
  );
}

export function isInviteAvailable(
  db: DatabaseT.Database,
  code: string,
  now = new Date(),
): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM invites WHERE code = ? AND consumed_by IS NULL AND expires_at > ? LIMIT 1",
      )
      .get(code, now.toISOString()),
  );
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
