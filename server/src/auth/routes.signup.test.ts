import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { hashPassword } from "./passwords.js";
import { createInvite } from "./invites.js";
import {
  mountAuthRoutes,
  mountInviteRoutes,
  resetAuthRateLimiters,
} from "./routes.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";

const ORIGIN = "http://localhost:5173";
let db: Database.Database;
let app: Hono<AuthEnv>;
let adminId: number;

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
  adminId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("admin@example.com", hash, "Admin", new Date().toISOString())
      .lastInsertRowid,
  );

  app = new Hono<AuthEnv>();
  mountAuthRoutes(app, db);
  // mirror index.ts: gate /api/invites behind requireAuth
  app.use("/api/invites", makeRequireAuth(db));
  mountInviteRoutes(app, db);

  // Belt-and-suspenders: reset the module-level rate limiter so a 429 test
  // in another file (same worker, different describe block) cannot bleed in.
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

describe("POST /api/auth/signup", () => {
  it("creates a user with a valid invite and sets cookie", async () => {
    const inv = createInvite(db, adminId);
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "bob@example.com",
      password: "longenough",
      displayName: "Bob",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/bo_sid=/);
    const consumed = db
      .prepare("SELECT consumed_by FROM invites WHERE code = ?")
      .get(inv.code) as { consumed_by: number };
    expect(consumed.consumed_by).toBeGreaterThan(0);
  });

  it("400s on missing fields", async () => {
    const res = await post("/api/auth/signup", { code: "x", email: "x@x.x" });
    expect(res.status).toBe(400);
  });

  it.each([null, [], "signup", 42])(
    "400s on a non-object JSON body (%j)",
    async (body) => {
      const res = await post("/api/auth/signup", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    },
  );

  it("400s on weak password", async () => {
    const inv = createInvite(db, adminId);
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "bob@example.com",
      password: "short",
      displayName: "Bob",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "weak_password" });
  });

  it("400s on consumed invite (and does not create the user)", async () => {
    const inv = createInvite(db, adminId);
    await post("/api/auth/signup", {
      code: inv.code,
      email: "first@example.com",
      password: "longenough",
      displayName: "First",
    });
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "second@example.com",
      password: "longenough",
      displayName: "Second",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_invite" });
    const u = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?")
      .get("second@example.com") as { c: number };
    expect(u.c).toBe(0);
  });

  it("400s on duplicate email", async () => {
    const inv = createInvite(db, adminId);
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "admin@example.com",
      password: "longenough",
      displayName: "Dup",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email_taken" });
  });

  it("bounds all signup fields and the user agent", async () => {
    const inv = createInvite(db, adminId);
    const base = {
      code: inv.code,
      email: "bob@example.com",
      password: "longenough",
      displayName: "Bob",
    };
    expect((await post("/api/auth/signup", { ...base, password: "p".repeat(257) })).status).toBe(400);
    expect((await post("/api/auth/signup", { ...base, displayName: "x".repeat(81) })).status).toBe(400);
    expect((await post("/api/auth/signup", { ...base, code: "x".repeat(129) })).status).toBe(400);

    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "User-Agent": "a".repeat(513),
      },
      body: JSON.stringify(base),
    });
    expect(res.status).toBe(400);
  });

  it("rate-limits signup by invite code and provides Retry-After", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await post("/api/auth/signup", {
        code: "unknown-code",
        email: `person-${i}@example.com`,
        password: "longenough",
        displayName: "Person",
      });
      expect(res.status).toBe(400);
    }
    const blocked = await post("/api/auth/signup", {
      code: "unknown-code",
      email: "last@example.com",
      password: "longenough",
      displayName: "Person",
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rate-limits signup attempts across invite codes from one IP", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Fly-Client-IP": "203.0.113.50",
        },
        body: JSON.stringify({
          code: `unknown-${i}`,
          email: `person-${i}@example.com`,
          password: "longenough",
          displayName: "Person",
        }),
      });
      expect(res.status).toBe(400);
    }
    const blocked = await app.request("/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Fly-Client-IP": "203.0.113.50",
      },
      body: JSON.stringify({
        code: "one-more",
        email: "last@example.com",
        password: "longenough",
        displayName: "Person",
      }),
    });
    expect(blocked.status).toBe(429);
  });
});

describe("POST /api/invites", () => {
  it("401 without session", async () => {
    const res = await post("/api/invites", {});
    expect(res.status).toBe(401);
  });

  it("returns code + url when authed", async () => {
    const login = await post("/api/auth/login", {
      email: "admin@example.com",
      password: "hunter22",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const res = await post("/api/invites", {}, cookie);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      code: string;
      url: string;
      expiresAt: string;
    };
    expect(json.url).toBe(`${ORIGIN}/signup?code=${json.code}`);
  });
});
