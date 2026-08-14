import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupExpiredPasswordResets,
  consumePasswordReset,
  createPasswordReset,
  isPasswordResetAvailable,
  PASSWORD_RESET_TTL_MS,
} from "./passwordResets.js";

let database: Database.Database;

beforeEach(() => {
  database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE password_resets (
      code TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );
    INSERT INTO users (id) VALUES (1), (2);
  `);
});

afterEach(() => database.close());

describe("password reset tokens", () => {
  it("creates a one-hour token that can be consumed only once", () => {
    const now = new Date("2026-08-13T20:00:00.000Z");
    const reset = createPasswordReset(database, 2, 1, now);

    expect(reset.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reset.expiresAt).toBe(
      new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
    );
    expect(isPasswordResetAvailable(database, reset.code, now)).toBe(true);
    expect(consumePasswordReset(database, reset.code, now)).toBe(2);
    expect(consumePasswordReset(database, reset.code, now)).toBeNull();
  });

  it("invalidates an older unused token for the same caregiver", () => {
    const first = createPasswordReset(
      database,
      2,
      1,
      new Date("2026-08-13T20:00:00.000Z"),
    );
    const second = createPasswordReset(
      database,
      2,
      1,
      new Date("2026-08-13T20:05:00.000Z"),
    );

    const checkedAt = new Date("2026-08-13T20:06:00.000Z");
    expect(isPasswordResetAvailable(database, first.code, checkedAt)).toBe(false);
    expect(isPasswordResetAvailable(database, second.code, checkedAt)).toBe(true);
  });

  it("rejects and cleans up expired tokens", () => {
    const reset = createPasswordReset(
      database,
      2,
      1,
      new Date("2026-08-13T20:00:00.000Z"),
    );
    const afterExpiry = new Date("2026-08-13T21:00:00.001Z");

    expect(
      isPasswordResetAvailable(database, reset.code, afterExpiry),
    ).toBe(false);
    cleanupExpiredPasswordResets(database, afterExpiry);
    expect(
      database.prepare("SELECT 1 FROM password_resets").get(),
    ).toBeUndefined();
  });
});
