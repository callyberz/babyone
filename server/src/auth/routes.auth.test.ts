import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { hashPassword } from "./passwords.js";
import { mountAuthRoutes, loginRl } from "./routes.js";
import type { AuthEnv } from "./middleware.js";

let db: Database.Database;
let app: Hono<AuthEnv>;

const ORIGIN = "http://localhost:5173";

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
  const hash = await hashPassword("hunter22");
  db.prepare(
    "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
  ).run("alice@example.com", hash, "Alice", new Date().toISOString());

  app = new Hono<AuthEnv>();
  mountAuthRoutes(app, db);

  // Reset the module-level rate limiter so the 429 test doesn't bleed into
  // subsequent describe blocks (me / logout) that also call login.
  loginRl.reset("alice@example.com");
});

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/login", () => {
  it("returns the user and sets a cookie on success", async () => {
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: {
        id: 1,
        email: "alice@example.com",
        displayName: "Alice",
        isAdmin: false,
      },
    });
    expect(res.headers.get("set-cookie")).toMatch(/bo_sid=/);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
  });

  it("is case-insensitive on email", async () => {
    const res = await post("/api/auth/login", {
      email: "ALICE@example.com",
      password: "hunter22",
    });
    expect(res.status).toBe(200);
  });

  it("401s on wrong password (same shape as unknown email)", async () => {
    const a = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "wrong",
    });
    const b = await post("/api/auth/login", {
      email: "nobody@example.com",
      password: "wrong",
    });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual({ error: "invalid_credentials" });
    expect(await b.json()).toEqual({ error: "invalid_credentials" });
  });

  it("429s after 10 failed attempts", async () => {
    for (let i = 0; i < 10; i++)
      await post("/api/auth/login", {
        email: "alice@example.com",
        password: "x",
      });
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    expect(res.status).toBe(429);
  });

  it("400 on missing fields", async () => {
    const res = await post("/api/auth/login", { email: "alice@example.com" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  it("401 without cookie", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("200 with valid cookie", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: {
        id: 1,
        email: "alice@example.com",
        displayName: "Alice",
        isAdmin: false,
      },
    });
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and deletes the session", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const out = await post("/api/auth/logout", {}, cookie);
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/bo_sid=;/);

    const me = await app.request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(me.status).toBe(401);
  });
});
