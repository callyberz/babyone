import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCoreSchema,
  getSyncDelta,
  getSyncSnapshot,
} from "./db.js";

let database: Database.Database;

beforeEach(() => {
  database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  applyCoreSchema(database);
});

afterEach(() => database.close());

function insertRecord(title: string): number {
  return Number(
    database
      .prepare(
        "INSERT INTO records (type, at, title, detail, meta) VALUES ('other', '2026-08-13T12:00:00.000Z', ?, '', '{\"category\":\"note\"}')",
      )
      .run(title).lastInsertRowid,
  );
}

describe("household sync change feed", () => {
  it("captures inserts, updates, and deletes made through any SQL path", () => {
    expect(getSyncSnapshot(database)).toMatchObject({
      full: true,
      cursor: 0,
      records: [],
      messages: [],
    });

    const id = insertRecord("Original");
    database
      .prepare("UPDATE records SET title = 'Updated' WHERE id = ?")
      .run(id);
    database
      .prepare(
        "INSERT INTO messages (sender, at, text) VALUES ('bot', '2026-08-13T12:01:00.000Z', 'Logged')",
      )
      .run();

    const first = getSyncDelta(0, 2, database);
    expect(first.hasMore).toBe(true);
    expect(first.records).toMatchObject([{ id, title: "Updated" }]);

    const second = getSyncDelta(first.cursor, 2, database);
    expect(second).toMatchObject({
      full: false,
      hasMore: false,
      messages: [{ text: "Logged" }],
    });

    database.prepare("DELETE FROM records WHERE id = ?").run(id);
    expect(getSyncDelta(second.cursor, 10, database)).toMatchObject({
      records: [],
      deletedRecordIds: [id],
    });
  });

  it("returns a self-consistent full snapshot and cursor", () => {
    const id = insertRecord("Current");
    const snapshot = getSyncSnapshot(database);
    expect(snapshot.cursor).toBeGreaterThan(0);
    expect(snapshot.records.map((record) => record.id)).toEqual([id]);
    expect(getSyncDelta(snapshot.cursor, 10, database)).toMatchObject({
      cursor: snapshot.cursor,
      records: [],
      messages: [],
    });
  });

  it("falls back to a full snapshot when a cursor predates retention", () => {
    database
      .prepare(
        "INSERT INTO sync_changes (seq, entity, entity_id, operation) VALUES (?, 'record', 1, 'delete')",
      )
      .run(1);
    database
      .prepare(
        "INSERT INTO sync_changes (seq, entity, entity_id, operation) VALUES (?, 'record', 2, 'delete')",
      )
      .run(60_002);

    expect(getSyncDelta(0, 10, database)).toMatchObject({
      full: true,
      cursor: 60_002,
      records: [],
      messages: [],
    });
  });
});
