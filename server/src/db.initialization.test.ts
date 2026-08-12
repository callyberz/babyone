import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyCoreSchema } from "./db.js";

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
});
