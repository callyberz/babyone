import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyCoreSchema,
  checkpointAndCloseDatabase,
  configureDatabase,
  ensureBaby,
  getBaby,
  setBaby,
  SQLITE_BUSY_TIMEOUT_MS,
} from "./db.js";

describe("production database initialization", () => {
  it("creates a fresh schema without demo records or messages", () => {
    const database = new Database(":memory:");
    applyCoreSchema(database);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM records").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("initializes and persists a singleton baby profile", () => {
    const database = new Database(":memory:");
    applyCoreSchema(database);
    ensureBaby(database, new Date("2026-08-11T12:00:00.000Z"));
    expect(getBaby(database)).toEqual({
      name: "Clement",
      birthdate: "2026-08-09",
      weightValue: null,
      weightUnit: "lb",
    });

    setBaby(
      {
        name: "Clemmie",
        birthdate: "2026-08-09",
        weightValue: 7.4,
        weightUnit: "lb",
      },
      database,
    );
    ensureBaby(database, new Date("2026-08-12T12:00:00.000Z"));
    expect(getBaby(database).name).toBe("Clemmie");
    database.close();
  });

  it("configures contention safety and checkpoints cleanly on close", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "babyone-db-lifecycle-"));
    const filename = path.join(directory, "data.db");
    const database = new Database(filename);

    try {
      configureDatabase(database);
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.pragma("busy_timeout", { simple: true })).toBe(
        SQLITE_BUSY_TIMEOUT_MS,
      );

      database.exec("CREATE TABLE lifecycle_test (value TEXT NOT NULL)");
      database
        .prepare("INSERT INTO lifecycle_test (value) VALUES (?)")
        .run("persisted");
      checkpointAndCloseDatabase(database);

      expect(database.open).toBe(false);
      expect(() => checkpointAndCloseDatabase(database)).not.toThrow();

      const reopened = new Database(filename, { readonly: true });
      expect(reopened.prepare("SELECT value FROM lifecycle_test").get()).toEqual(
        { value: "persisted" },
      );
      reopened.close();
    } finally {
      if (database.open) database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
