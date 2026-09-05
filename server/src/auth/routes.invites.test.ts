import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { applyAuthSchema } from "../db.js";
import {
  consumeInvite,
  createInvite,
  invitePublicId,
} from "./invites.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";
import { mountAuthenticatedRoutes } from "./routes.js";
import { createSession } from "./sessions.js";

const ORIGIN = "http://localhost:5173";
let app: Hono<AuthEnv>;
let db: Database.Database;
let adminId: number;
let caregiverId: number;
let adminSession: string;
let caregiverSession: string;

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
  adminId = Number(
    db
      .prepare(
        `INSERT INTO users
           (email, password_hash, display_name, role, created_at)
         VALUES (?, 'hash', ?, 'administrator', ?)`,
      )
      .run("admin@example.com", "Admin", new Date().toISOString())
      .lastInsertRowid,
  );
  caregiverId = Number(
    db
      .prepare(
        `INSERT INTO users
           (email, password_hash, display_name, role, created_at)
         VALUES (?, 'hash', ?, 'caregiver', ?)`,
      )
      .run("caregiver@example.com", "Caregiver", new Date().toISOString())
      .lastInsertRowid,
  );
  adminSession = createSession(db, adminId, "Admin browser");
  caregiverSession = createSession(db, caregiverId, "Caregiver browser");

  app = new Hono<AuthEnv>();
  app.use("/api/*", makeRequireAuth(db));
  mountAuthenticatedRoutes(app, db);
});

const request = (
  path: string,
  method: "GET" | "POST" | "DELETE",
  session?: string,
) =>
  app.request(path, {
    method,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...(session ? { Cookie: `bo_sid=${session}` } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });

describe("administrator invite routes", () => {
  it("preserves one-time secret creation while adding a safe public id", async () => {
    const response = await request("/api/invites", "POST", adminSession);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      code: string;
      url: string;
      expiresAt: string;
    };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body.url).toBe(`${ORIGIN}/signup?code=${body.code}`);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("lists only live unused invites with creator metadata and no secrets", async () => {
    const live = createInvite(db, adminId);
    const used = createInvite(db, adminId);
    expect(consumeInvite(db, used.code, caregiverId)).toBe(true);
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      "expired-secret",
      adminId,
      new Date(0).toISOString(),
      new Date(0).toISOString(),
    );

    const response = await request("/api/invites", "GET", adminSession);

    expect(response.status).toBe(200);
    const serialized = await response.clone().text();
    expect(await response.json()).toEqual({
      invites: [
        {
          id: live.id,
          createdAt: expect.any(String),
          expiresAt: live.expiresAt,
          createdBy: { id: adminId, displayName: "Admin" },
        },
      ],
    });
    expect(serialized).not.toContain(live.code);
    expect(serialized).not.toContain(used.code);
    expect(serialized).not.toContain("expired-secret");
  });

  it("revokes a live unused invite and rejects malformed or stale ids", async () => {
    const live = createInvite(db, adminId);
    const used = createInvite(db, adminId);
    expect(consumeInvite(db, used.code, caregiverId)).toBe(true);
    const expiredCode = "expired-secret";
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      expiredCode,
      adminId,
      new Date(0).toISOString(),
      new Date(0).toISOString(),
    );
    const revoked = await request(
      `/api/invites/${live.id}`,
      "DELETE",
      adminSession,
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ ok: true });

    const repeated = await request(
      `/api/invites/${live.id}`,
      "DELETE",
      adminSession,
    );
    expect(repeated.status).toBe(404);
    expect(await repeated.json()).toEqual({ error: "not_found" });

    for (const staleId of [used.id, invitePublicId(expiredCode)]) {
      const stale = await request(
        `/api/invites/${staleId}`,
        "DELETE",
        adminSession,
      );
      expect(stale.status).toBe(404);
      expect(await stale.json()).toEqual({ error: "not_found" });
    }

    const malformed = await request(
      "/api/invites/not-a-fingerprint",
      "DELETE",
      adminSession,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "bad_request" });
  });

  it.each([
    ["POST", "/api/invites"],
    ["GET", "/api/invites"],
    ["DELETE", `/api/invites/${"a".repeat(43)}`],
  ] as const)("forbids caregiver %s %s", async (method, path) => {
    const response = await request(path, method, caregiverSession);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it.each([
    ["POST", "/api/invites"],
    ["GET", "/api/invites"],
    ["DELETE", `/api/invites/${"a".repeat(43)}`],
  ] as const)("requires authentication for %s %s", async (method, path) => {
    const response = await request(path, method);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});
