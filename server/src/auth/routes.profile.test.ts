import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { applyAuthSchema } from "../db.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";
import { mountInviteRoutes } from "./routes.js";
import { createSession } from "./sessions.js";

const ORIGIN = "http://localhost:5173";
let app: Hono<AuthEnv>;
let db: Database.Database;
let userId: number;
let cookie: string;

beforeEach(() => {
  process.env.BABYONE_ORIGIN = ORIGIN;
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
        `INSERT INTO users
          (email, password_hash, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "admin@example.com",
        "hash",
        "Old name",
        "administrator",
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  cookie = `bo_sid=${createSession(db, userId, "Test browser")}`;
  app = new Hono<AuthEnv>();
  app.use("/api/*", makeRequireAuth(db));
  mountInviteRoutes(app, db);
});

const update = (body: unknown) =>
  app.request("/api/auth/profile", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      Origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("PUT /api/auth/profile", () => {
  it("trims and persists the authenticated caregiver's display name", async () => {
    const response = await update({ displayName: "  New name  " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: userId,
        email: "admin@example.com",
        displayName: "New name",
        isAdmin: true,
      },
    });
    expect(
      (
        db.prepare("SELECT display_name FROM users WHERE id = ?").get(userId) as {
          display_name: string;
        }
      ).display_name,
    ).toBe("New name");
  });

  it.each([
    null,
    [],
    {},
    { displayName: "   " },
    { displayName: "x".repeat(81) },
  ])("rejects invalid profile input (%j)", async (body) => {
    const response = await update(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request" });
  });
});
