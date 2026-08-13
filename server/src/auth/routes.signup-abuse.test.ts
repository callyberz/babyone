import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import type { AuthEnv } from "./middleware.js";
import { createInvite } from "./invites.js";

const passwordMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(async () => "test-hash"),
  verifyPassword: vi.fn(async () => false),
  dummyVerify: vi.fn(async () => false),
}));

vi.mock("./passwords.js", () => passwordMocks);

const { mountAuthRoutes, resetAuthRateLimiters } = await import("./routes.js");

let db: Database.Database;
let app: Hono<AuthEnv>;

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthRateLimiters();
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  db.prepare(
    "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
  ).run("admin@example.com", "hash", "Admin", new Date().toISOString());
  app = new Hono<AuthEnv>();
  mountAuthRoutes(app, db);
});

describe("signup abuse resistance", () => {
  it("rejects an unavailable invite before invoking Argon2", async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "random-invalid-code",
        email: "person@example.com",
        password: "longenough",
        displayName: "Person",
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_invite" });
    expect(passwordMocks.hashPassword).not.toHaveBeenCalled();
  });

  it("rejects an existing email before invoking Argon2", async () => {
    const admin = db
      .prepare("SELECT id FROM users WHERE email = 'admin@example.com'")
      .get() as { id: number };
    const invite = createInvite(db, admin.id);
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: invite.code,
        email: "admin@example.com",
        password: "longenough",
        displayName: "Duplicate",
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email_taken" });
    expect(passwordMocks.hashPassword).not.toHaveBeenCalled();
  });
});
