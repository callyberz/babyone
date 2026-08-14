import { randomBytes } from "node:crypto";
import type DatabaseT from "better-sqlite3";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1_000;

export interface PasswordReset {
  code: string;
  userId: number;
  expiresAt: string;
}

export function createPasswordReset(
  db: DatabaseT.Database,
  userId: number,
  createdBy: number,
  now = new Date(),
): PasswordReset {
  const code = randomBytes(32).toString("base64url");
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + PASSWORD_RESET_TTL_MS,
  ).toISOString();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO password_resets
         (code, user_id, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(code, userId, createdBy, createdAt, expiresAt);
  });
  tx.immediate();
  return { code, userId, expiresAt };
}

export function isPasswordResetAvailable(
  db: DatabaseT.Database,
  code: string,
  now = new Date(),
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM password_resets
         WHERE code = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
      )
      .get(code, now.toISOString()),
  );
}

export function consumePasswordReset(
  db: DatabaseT.Database,
  code: string,
  now = new Date(),
): number | null {
  const consumedAt = now.toISOString();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT user_id FROM password_resets
         WHERE code = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .get(code, consumedAt) as { user_id: number } | undefined;
    if (!row) return null;
    const result = db
      .prepare(
        `UPDATE password_resets SET consumed_at = ?
         WHERE code = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .run(consumedAt, code, consumedAt);
    return result.changes === 1 ? row.user_id : null;
  });
  return tx.immediate();
}

export function cleanupExpiredPasswordResets(
  db: DatabaseT.Database,
  now = new Date(),
): void {
  db.prepare("DELETE FROM password_resets WHERE expires_at <= ?").run(
    now.toISOString(),
  );
}
