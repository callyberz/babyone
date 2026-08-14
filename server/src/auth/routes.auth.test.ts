import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { hashPassword } from "./passwords.js";
import { mountAuthRoutes, resetAuthRateLimiters } from "./routes.js";
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
  resetAuthRateLimiters();
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

  it("uses the persisted administrator role after bootstrap vars are removed", async () => {
    db.prepare("UPDATE users SET role = 'administrator' WHERE id = 1").run();
    delete process.env.BABYONE_ADMIN_EMAIL;
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    expect(await res.json()).toMatchObject({ user: { isAdmin: true } });
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
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("does not let attempts from one IP lock the account for another IP", async () => {
    for (let i = 0; i < 10; i++) {
      await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Fly-Client-IP": "203.0.113.10",
        },
        body: JSON.stringify({ email: "alice@example.com", password: "wrong" }),
      });
    }

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Fly-Client-IP": "203.0.113.11",
      },
      body: JSON.stringify({ email: "alice@example.com", password: "hunter22" }),
    });
    expect(res.status).toBe(200);
  });

  it("rate-limits one IP across attempted account names", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Fly-Client-IP": "203.0.113.20",
        },
        body: JSON.stringify({
          email: `unknown-${i}@example.com`,
          password: "wrong",
        }),
      });
      expect(res.status).toBe(401);
    }

    const blocked = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Fly-Client-IP": "203.0.113.20",
      },
      body: JSON.stringify({
        email: "one-more@example.com",
        password: "wrong",
      }),
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rejects oversized credentials and user agents before password work", async () => {
    expect(
      (await post("/api/auth/login", {
        email: `${"a".repeat(255)}@example.com`,
        password: "hunter22",
      })).status,
    ).toBe(400);

    const oversizedAgent = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "User-Agent": "a".repeat(513),
      },
      body: JSON.stringify({ email: "alice@example.com", password: "hunter22" }),
    });
    expect(oversizedAgent.status).toBe(400);
  });

  it("400 on missing fields", async () => {
    const res = await post("/api/auth/login", { email: "alice@example.com" });
    expect(res.status).toBe(400);
  });

  it.each([null, [], "credentials", 42])(
    "400s on a non-object JSON body (%j)",
    async (body) => {
      const res = await post("/api/auth/login", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    },
  );

  it("400s on malformed JSON instead of throwing", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
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
