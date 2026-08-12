import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyCoreSchema, ensureBaby, getBaby, setBaby } from "./db.js";

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
});
