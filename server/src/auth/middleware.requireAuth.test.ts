import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { createSession } from "./sessions.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";

let db: Database.Database;
let app: Hono<AuthEnv>;
let userId: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES ('a@b.c','x','A',?)",
      )
      .run(new Date().toISOString()).lastInsertRowid,
  );
  app = new Hono<AuthEnv>();
  app.use("/api/secret", makeRequireAuth(db));
  app.get("/api/secret", (c) => c.json({ user: c.get("user") }));
});

describe("requireAuth", () => {
  it("401s when no cookie", async () => {
    const res = await app.request("/api/secret");
    expect(res.status).toBe(401);
  });

  it("401s when cookie unknown", async () => {
    const res = await app.request("/api/secret", {
      headers: { Cookie: "bo_sid=nope" },
    });
    expect(res.status).toBe(401);
  });

  it("attaches the user when cookie is valid", async () => {
    const sid = createSession(db, userId, "");
    const res = await app.request("/api/secret", {
      headers: { Cookie: `bo_sid=${sid}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: {
        id: userId,
        email: "a@b.c",
        displayName: "A",
        role: "caregiver",
      },
    });
  });
});
