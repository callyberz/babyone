import type { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type DatabaseT from "better-sqlite3";
import { hashPassword, verifyPassword, dummyVerify } from "./passwords.js";
import {
  createSession,
  deleteSession,
  findSession,
  SESSION_TTL_MS,
} from "./sessions.js";
import { createInvite, consumeInvite } from "./invites.js";
import { LoginRateLimiter } from "./rateLimit.js";
import { isAdmin, type AuthEnv } from "./middleware.js";

const COOKIE = "bo_sid";

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

// Exported so tests can call loginRl.reset(...) in beforeEach to prevent
// the 429 test from bleeding into subsequent describe blocks.
export const loginRl = new LoginRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60_000,
});

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function mountAuthRoutes(
  app: Hono<AuthEnv>,
  db: DatabaseT.Database,
): void {
  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const email = asString(body.email)?.toLowerCase();
    const password = asString(body.password);
    if (!email || !password) {
      return c.json({ error: "bad_request" }, 400);
    }

    if (!loginRl.check(email)) {
      return c.json({ error: "too_many_attempts" }, 429);
    }

    const row = db
      .prepare(
        "SELECT id, password_hash, display_name FROM users WHERE email = ?",
      )
      .get(email) as
      { id: number; password_hash: string; display_name: string } | undefined;

    const ok = row
      ? await verifyPassword(row.password_hash, password)
      : (await dummyVerify(password), false);

    if (!row || !ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    loginRl.reset(email);
    const sid = createSession(db, row.id, c.req.header("User-Agent") ?? "");
    setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
    return c.json({
      user: {
        id: row.id,
        email,
        displayName: row.display_name,
        isAdmin: isAdmin(email),
      },
    });
  });

  app.post("/api/auth/signup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const code = asString(body.code);
    const email = asString(body.email)?.toLowerCase();
    const password = asString(body.password);
    const displayName = asString(body.displayName);
    if (!code || !email || !password || !displayName) {
      return c.json({ error: "bad_request" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "weak_password" }, 400);
    }

    const hash = await hashPassword(password);
    const now = new Date().toISOString();

    try {
      const tx = db.transaction(() => {
        const info = db
          .prepare(
            "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(email, hash, displayName, now);
        const userId = Number(info.lastInsertRowid);
        const consumed = consumeInvite(db, code, userId);
        if (!consumed) throw new Error("invalid_invite");
        return userId;
      });
      const userId = tx();
      const sid = createSession(db, userId, c.req.header("User-Agent") ?? "");
      setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
      return c.json({
        user: { id: userId, email, displayName, isAdmin: isAdmin(email) },
      });
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "email_taken" }, 400);
      }
      if (msg === "invalid_invite") {
        return c.json({ error: "invalid_invite" }, 400);
      }
      throw err;
    }
  });

  app.post("/api/auth/logout", (c) => {
    const sid = getCookie(c, COOKIE);
    if (sid) deleteSession(db, sid);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", (c) => {
    const sid = getCookie(c, COOKIE);
    if (!sid) return c.json({ error: "unauthenticated" }, 401);
    const row = findSession(db, sid);
    if (!row) return c.json({ error: "unauthenticated" }, 401);
    return c.json({
      user: {
        id: row.userId,
        email: row.email,
        displayName: row.displayName,
        isAdmin: isAdmin(row.email),
      },
    });
  });
}

// Registered separately so it can be mounted AFTER requireAuth in index.ts.
export function mountInviteRoutes(
  app: Hono<AuthEnv>,
  db: DatabaseT.Database,
): void {
  app.post("/api/invites", (c) => {
    const user = c.get("user");
    const inv = createInvite(db, user.id);
    const origin = process.env.BABYONE_ORIGIN ?? "";
    return c.json({
      code: inv.code,
      expiresAt: inv.expiresAt,
      url: `${origin}/signup?code=${inv.code}`,
    });
  });
}
