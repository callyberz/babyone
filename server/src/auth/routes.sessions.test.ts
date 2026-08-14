import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { applyAuthSchema } from "../db.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";
import { mountInviteRoutes } from "./routes.js";
import { createSession, findSession, sessionPublicId } from "./sessions.js";

const ORIGIN = "http://localhost:5173";
let app: Hono<AuthEnv>;
let db: Database.Database;
let userId: number;
let currentSession: string;

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
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("caregiver@example.com", "hash", "Caregiver", new Date().toISOString())
      .lastInsertRowid,
  );
  currentSession = createSession(db, userId, "Current browser");

  app = new Hono<AuthEnv>();
  app.use("/api/*", makeRequireAuth(db));
  mountInviteRoutes(app, db);
});

const request = (path: string, init?: RequestInit) =>
  app.request(path, {
    ...init,
    headers: {
      Cookie: `bo_sid=${currentSession}`,
      Origin: ORIGIN,
      ...init?.headers,
    },
  });

describe("caregiver session routes", () => {
  it("lists the caregiver's active sessions and identifies the current one", async () => {
    const second = createSession(db, userId, "Phone browser");
    const response = await request("/api/auth/sessions");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessions: expect.arrayContaining([
        expect.objectContaining({
          id: sessionPublicId(currentSession),
          userAgent: "Current browser",
          current: true,
        }),
        expect.objectContaining({
          id: sessionPublicId(second),
          userAgent: "Phone browser",
          current: false,
        }),
      ]),
    });
  });

  it("revokes another owned session without signing out the current one", async () => {
    const second = createSession(db, userId, "Phone browser");
    const response = await request(
      `/api/auth/sessions/${sessionPublicId(second)}`,
      {
      method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, current: false });
    expect(findSession(db, second)).toBeNull();
    expect(findSession(db, currentSession)).not.toBeNull();
  });

  it("clears the cookie when revoking the current session", async () => {
    const response = await request(
      `/api/auth/sessions/${sessionPublicId(currentSession)}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, current: true });
    expect(response.headers.get("set-cookie")).toMatch(/bo_sid=;/);
    expect(findSession(db, currentSession)).toBeNull();
  });

  it("cannot revoke another caregiver's session", async () => {
    const otherUserId = Number(
      db
        .prepare(
          "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("other@example.com", "hash", "Other", new Date().toISOString())
        .lastInsertRowid,
    );
    const otherSession = createSession(db, otherUserId, "Other browser");
    const response = await request(
      `/api/auth/sessions/${sessionPublicId(otherSession)}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(findSession(db, otherSession)).not.toBeNull();
  });

  it("rejects malformed session identifiers", async () => {
    const response = await request("/api/auth/sessions/not-valid", {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
  });
});
