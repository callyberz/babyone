import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { applyAuthSchema } from "../db.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";
import { createPasswordReset, isPasswordResetAvailable } from "./passwordResets.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { mountAuthenticatedRoutes, resetAuthRateLimiters } from "./routes.js";
import { createSession, findSession } from "./sessions.js";

const ORIGIN = "http://localhost:5173";
let app: Hono<AuthEnv>;
let db: Database.Database;
let userId: number;
let currentSession: string;

beforeEach(async () => {
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
      .run(
        "caregiver@example.com",
        await hashPassword("current-password"),
        "Caregiver",
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  currentSession = createSession(db, userId, "Current browser");

  app = new Hono<AuthEnv>();
  app.use("/api/*", makeRequireAuth(db));
  mountAuthenticatedRoutes(app, db);
  resetAuthRateLimiters();
});

const changePassword = (
  body: unknown,
  options: { session?: string; ip?: string } = {},
) =>
  app.request("/api/auth/password", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bo_sid=${options.session ?? currentSession}`,
      Origin: ORIGIN,
      ...(options.ip ? { "Fly-Client-IP": options.ip } : {}),
    },
    body: JSON.stringify(body),
  });

describe("PUT /api/auth/password", () => {
  it("changes the password atomically, retains this session, and revokes the others", async () => {
    const phoneSession = createSession(db, userId, "Phone browser");
    const tabletSession = createSession(db, userId, "Tablet browser");
    const reset = createPasswordReset(db, userId, userId);

    const response = await changePassword({
      currentPassword: "current-password",
      newPassword: "replacement-password",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revokedSessions: 2 });
    const credential = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(userId) as { password_hash: string };
    expect(await verifyPassword(credential.password_hash, "replacement-password")).toBe(true);
    expect(await verifyPassword(credential.password_hash, "current-password")).toBe(false);
    expect(findSession(db, currentSession)).not.toBeNull();
    expect(findSession(db, phoneSession)).toBeNull();
    expect(findSession(db, tabletSession)).toBeNull();
    expect(isPasswordResetAvailable(db, reset.code)).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not mutate credentials or sessions when the current password is wrong", async () => {
    const secondSession = createSession(db, userId, "Phone browser");
    const before = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(userId) as { password_hash: string };

    const response = await changePassword({
      currentPassword: "incorrect-password",
      newPassword: "replacement-password",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_credentials" });
    const after = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(userId) as { password_hash: string };
    expect(after.password_hash).toBe(before.password_hash);
    expect(findSession(db, currentSession)).not.toBeNull();
    expect(findSession(db, secondSession)).not.toBeNull();
  });

  it("only reports an unchanged password after authenticating it", async () => {
    const valid = await changePassword({
      currentPassword: "current-password",
      newPassword: "current-password",
    });
    expect(valid.status).toBe(400);
    expect(await valid.json()).toEqual({ error: "password_unchanged" });

    const invalid = await changePassword({
      currentPassword: "plausible-but-wrong",
      newPassword: "plausible-but-wrong",
    });
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: "invalid_credentials" });
  });

  it("validates object shape, bounds, and the shared password policy", async () => {
    for (const body of [null, [], "passwords", 42, {}, {
      currentPassword: "x".repeat(257),
      newPassword: "replacement-password",
    }, {
      currentPassword: "current-password",
      newPassword: "x".repeat(257),
    }]) {
      const response = await changePassword(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_request" });
    }

    const weak = await changePassword({
      currentPassword: "current-password",
      newPassword: "short",
    });
    expect(weak.status).toBe(400);
    expect(await weak.json()).toEqual({ error: "weak_password" });
  });

  it("requires authentication", async () => {
    const response = await app.request("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({
        currentPassword: "current-password",
        newPassword: "replacement-password",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("rate-limits failures by source IP and authenticated account", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await changePassword(
        {
          currentPassword: "incorrect-password",
          newPassword: "replacement-password",
        },
        { ip: "203.0.113.10" },
      );
      expect(response.status).toBe(401);
    }

    const blocked = await changePassword(
      {
        currentPassword: "current-password",
        newPassword: "replacement-password",
      },
      { ip: "203.0.113.10" },
    );
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_attempts" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    const otherIp = await changePassword(
      {
        currentPassword: "still-incorrect",
        newPassword: "replacement-password",
      },
      { ip: "203.0.113.11" },
    );
    expect(otherIp.status).toBe(401);

    const otherUserId = Number(
      db
        .prepare(
          "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          "other@example.com",
          await hashPassword("other-current-password"),
          "Other",
          new Date().toISOString(),
        ).lastInsertRowid,
    );
    const otherSession = createSession(db, otherUserId, "Other browser");
    const otherAccount = await changePassword(
      {
        currentPassword: "still-incorrect",
        newPassword: "replacement-password",
      },
      { session: otherSession, ip: "203.0.113.10" },
    );
    expect(otherAccount.status).toBe(401);
  });
});
