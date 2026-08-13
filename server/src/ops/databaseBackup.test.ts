import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCoreSchema, ensureBaby } from "../db.js";
import {
  createOnlineBackup,
  verifyRestoreCandidate,
} from "./databaseBackup.js";

const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "babyone-backup-test-"));
  workspaces.push(path);
  return path;
}

afterEach(() => {
  for (const path of workspaces.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function createSource(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  applyCoreSchema(database);
  ensureBaby(database, new Date("2026-08-13T00:00:00.000Z"));
  database.prepare(
    "INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, 'administrator', ?)",
  ).run("admin@example.com", "hash", "Admin", "2026-08-13T00:00:00.000Z");
  database.prepare(
    "INSERT INTO records (type, at, title, detail, meta, user_id) VALUES ('diaper', ?, 'Wet diaper', '', ?, 1)",
  ).run("2026-08-13T01:00:00.000Z", JSON.stringify({ kind: "wet" }));
  database.prepare(
    "INSERT INTO messages (sender, at, text, record_ids, kind) VALUES ('user', ?, 'wet diaper', '[1]', 'chat')",
  ).run("2026-08-13T01:00:00.000Z");
  return database;
}

describe("database backup operations", () => {
  it("backs up a live WAL database and verifies the self-contained result", async () => {
    const dir = workspace();
    const source = join(dir, "source.db");
    const backup = join(dir, "backups", "snapshot.db");
    const live = createSource(source);
    try {
      const report = await createOnlineBackup(source, backup);
      expect(report.integrity).toBe("ok");
      expect(report.counts).toMatchObject({ users: 1, records: 1, messages: 1 });
      expect(existsSync(backup)).toBe(true);
      expect(existsSync(`${backup}-wal`)).toBe(false);
    } finally {
      live.close();
    }
  });

  it("verifies a restore candidate through a disposable copy", async () => {
    const dir = workspace();
    const source = join(dir, "source.db");
    const backup = join(dir, "snapshot.db");
    const live = createSource(source);
    await createOnlineBackup(source, backup);
    live.close();

    const report = verifyRestoreCandidate(backup);
    expect(report.integrity).toBe("ok");
    expect(report.tables).toEqual(expect.arrayContaining(["records", "users", "kv"]));
    expect(report.counts.records).toBe(1);
  });

  it("refuses to overwrite an existing backup", async () => {
    const dir = workspace();
    const source = join(dir, "source.db");
    const backup = join(dir, "snapshot.db");
    const live = createSource(source);
    await createOnlineBackup(source, backup);
    await expect(createOnlineBackup(source, backup)).rejects.toThrow(
      "refusing to overwrite",
    );
    live.close();
  });
});
