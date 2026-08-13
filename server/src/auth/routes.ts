import type { Context, Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type DatabaseT from "better-sqlite3";
import { hashPassword, verifyPassword, dummyVerify } from "./passwords.js";
import {
  createSession,
  deleteSession,
  findSession,
  SESSION_TTL_MS,
} from "./sessions.js";
import { createInvite, consumeInvite, isInviteAvailable } from "./invites.js";
import { LoginRateLimiter, type RateLimitDecision } from "./rateLimit.js";
import { isAdmin, type AuthEnv } from "./middleware.js";

const COOKIE = "bo_sid";

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

const EMAIL_MAX = 254;
const PASSWORD_MAX = 256;
const DISPLAY_NAME_MAX = 80;
const INVITE_CODE_MAX = 128;
const USER_AGENT_MAX = 512;
const RATE_WINDOW_MS = 15 * 60_000;

export const loginIpRl = new LoginRateLimiter({
  maxAttempts: 30,
  windowMs: RATE_WINDOW_MS,
});
export const loginAccountIpRl = new LoginRateLimiter({
  maxAttempts: 10,
  windowMs: RATE_WINDOW_MS,
});
export const signupIpRl = new LoginRateLimiter({
  maxAttempts: 20,
  windowMs: RATE_WINDOW_MS,
});
export const signupInviteRl = new LoginRateLimiter({
  maxAttempts: 10,
  windowMs: RATE_WINDOW_MS,
  caseInsensitive: false,
});

export function resetAuthRateLimiters(): void {
  loginIpRl.clear();
  loginAccountIpRl.clear();
  signupIpRl.clear();
  signupInviteRl.clear();
}

function asBoundedString(
  value: unknown,
  maxLength: number,
  trim = false,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    return null;
  }
  const normalized = trim ? value.trim() : value;
  return normalized.length > 0 ? normalized : null;
}

function clientIp(c: Context<AuthEnv>): string {
  const forwarded =
    c.req.header("Fly-Client-IP") ??
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",", 1)[0];
  return forwarded?.trim().slice(0, 128) || "unknown";
}

function userAgent(c: Context<AuthEnv>): string | null {
  const value = c.req.header("User-Agent") ?? "";
  return value.length <= USER_AGENT_MAX ? value : null;
}

function rateLimited(
  c: Context<AuthEnv>,
  decisions: RateLimitDecision[],
) {
  const blocked = decisions.filter((decision) => !decision.allowed);
  if (blocked.length === 0) return null;
  const retryAfter = Math.max(
    ...blocked.map((decision) => decision.retryAfterSeconds),
  );
  c.header("Retry-After", String(retryAfter));
  return c.json({ error: "too_many_attempts" }, 429);
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
    const email = asBoundedString(body.email, EMAIL_MAX, true)?.toLowerCase();
    const password = asBoundedString(body.password, PASSWORD_MAX);
    const agent = userAgent(c);
    if (!email || !password || agent === null) {
      return c.json({ error: "bad_request" }, 400);
    }

    const ip = clientIp(c);
    const loginLimit = rateLimited(c, [
      loginIpRl.checkDetailed(ip),
      // Scope the account key by source IP so one remote attacker cannot lock
      // a caregiver out globally merely by knowing their email address.
      loginAccountIpRl.checkDetailed(`${ip}\u0000${email}`),
    ]);
    if (loginLimit) return loginLimit;

    const row = db
      .prepare(
        "SELECT id, password_hash, display_name, role FROM users WHERE email = ?",
      )
      .get(email) as
      | {
          id: number;
          password_hash: string;
          display_name: string;
          role: "administrator" | "caregiver";
        }
      | undefined;

    const ok = row
      ? await verifyPassword(row.password_hash, password)
      : (await dummyVerify(password), false);

    if (!row || !ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    loginIpRl.reset(ip);
    loginAccountIpRl.reset(`${ip}\u0000${email}`);
    const sid = createSession(db, row.id, agent);
    setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
    return c.json({
      user: {
        id: row.id,
        email,
        displayName: row.display_name,
        isAdmin: isAdmin(row),
      },
    });
  });

  app.post("/api/auth/signup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const code = asBoundedString(body.code, INVITE_CODE_MAX, true);
    const email = asBoundedString(body.email, EMAIL_MAX, true)?.toLowerCase();
    const password = asBoundedString(body.password, PASSWORD_MAX);
    const displayName = asBoundedString(
      body.displayName,
      DISPLAY_NAME_MAX,
      true,
    );
    const agent = userAgent(c);
    if (!code || !email || !password || !displayName || agent === null) {
      return c.json({ error: "bad_request" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "weak_password" }, 400);
    }

    const signupLimit = rateLimited(c, [
      signupIpRl.checkDetailed(clientIp(c)),
      signupInviteRl.checkDetailed(code),
    ]);
    if (signupLimit) return signupLimit;

    // Reject random, expired, and consumed codes before paying the Argon2
    // cost. consumeInvite() below remains the authoritative atomic claim.
    if (!isInviteAvailable(db, code)) {
      return c.json({ error: "invalid_invite" }, 400);
    }
    const existingEmail = db
      .prepare("SELECT 1 FROM users WHERE email = ? LIMIT 1")
      .get(email);
    if (existingEmail) {
      return c.json({ error: "email_taken" }, 400);
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
      const sid = createSession(db, userId, agent);
      setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
      return c.json({
        user: {
          id: userId,
          email,
          displayName,
          isAdmin: false,
        },
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
        isAdmin: isAdmin(row),
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
