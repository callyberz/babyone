import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { applyCoreSchema, listMessages, listRecords } from "./db.js";

const MAX_RECORD_TITLE_LENGTH = 200;
const MAX_RECORD_META_JSON_LENGTH = 8_000;

let database: Database.Database | undefined;

afterEach(() => database?.close());

describe("database JSON and field integrity", () => {
  it("keeps legacy malformed JSON rows readable and guards future writes", () => {
    database = new Database(":memory:");
    database.exec(`
      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        at TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        at TEXT NOT NULL,
        text TEXT NOT NULL,
        record_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      INSERT INTO records (type, at, title, detail, meta)
      VALUES ('feed', '2026-08-13T12:00:00.000Z', 'Legacy', '', '{broken');
      INSERT INTO messages (sender, at, text, record_ids)
      VALUES ('bot', '2026-08-13T12:01:00.000Z', 'Legacy', '{broken');
    `);

    expect(() => applyCoreSchema(database!)).not.toThrow();
    expect(listRecords(database!)).toMatchObject([{ title: "Legacy", meta: {} }]);
    expect(listMessages(database!)).toMatchObject([
      { text: "Legacy", recordIds: [], kind: "chat" },
    ]);

    expect(() =>
      database!
        .prepare(
          "INSERT INTO records (type, at, title, detail, meta) VALUES ('feed', ?, 'Bad', '', '{broken')",
        )
        .run("2026-08-13T12:02:00.000Z"),
    ).toThrow(/invalid record storage/);
    expect(() =>
      database!
        .prepare(
          "INSERT INTO messages (sender, at, text, record_ids) VALUES ('bot', ?, 'Bad', 'null')",
        )
        .run("2026-08-13T12:03:00.000Z"),
    ).toThrow(/invalid message record ids/);
  });

  it("enforces record size limits for direct database writers", () => {
    database = new Database(":memory:");
    applyCoreSchema(database);
    const insert = database.prepare(
      "INSERT INTO records (type, at, title, detail, meta) VALUES ('other', ?, ?, '', ?)",
    );

    expect(() =>
      insert.run(
        "2026-08-13T12:00:00.000Z",
        "x".repeat(MAX_RECORD_TITLE_LENGTH + 1),
        '{"category":"note"}',
      ),
    ).toThrow();
    expect(() =>
      insert.run(
        "2026-08-13T12:00:00.000Z",
        "Note",
        JSON.stringify({ note: "x".repeat(MAX_RECORD_META_JSON_LENGTH) }),
      ),
    ).toThrow();
  });

  it("sanitizes malformed record-id arrays instead of trusting persisted JSON", () => {
    database = new Database(":memory:");
    applyCoreSchema(database);
    database
      .prepare(
        "INSERT INTO messages (sender, at, text, record_ids) VALUES ('bot', ?, 'Mixed', ?)",
      )
      .run(
        "2026-08-13T12:00:00.000Z",
        JSON.stringify([1, 1, -2, 2.5, "3", 4]),
      );

    expect(listMessages(database)[0]?.recordIds).toEqual([1, 4]);
  });
});
