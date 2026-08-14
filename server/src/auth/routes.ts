import type { Context, Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type DatabaseT from "better-sqlite3";
import { hashPassword, verifyPassword, dummyVerify } from "./passwords.js";
import {
  createSession,
  deleteSession,
  deleteSessionForUser,
  findSession,
  listSessionsForUser,
  sessionPublicId,
  SESSION_TTL_MS,
} from "./sessions.js";
import { createInvite, consumeInvite, isInviteAvailable } from "./invites.js";
import { LoginRateLimiter, type RateLimitDecision } from "./rateLimit.js";
import { isAdmin, type AuthEnv } from "./middleware.js";
import {
  consumePasswordReset,
  createPasswordReset,
  isPasswordResetAvailable,
} from "./passwordResets.js";

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
const RESET_CODE_MAX = 128;
const USER_AGENT_MAX = 512;
const RATE_WINDOW_MS = 15 * 60_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readJsonObject(
  c: Context<AuthEnv>,
): Promise<Record<string, unknown> | null> {
  const value: unknown = await c.req.json().catch(() => null);
  return isObject(value) ? value : null;
}

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
export const resetIpRl = new LoginRateLimiter({
  maxAttempts: 20,
  windowMs: RATE_WINDOW_MS,
});
export const resetCodeRl = new LoginRateLimiter({
  maxAttempts: 10,
  windowMs: RATE_WINDOW_MS,
  caseInsensitive: false,
});

export function resetAuthRateLimiters(): void {
  loginIpRl.clear();
  loginAccountIpRl.clear();
  signupIpRl.clear();
  signupInviteRl.clear();
  resetIpRl.clear();
  resetCodeRl.clear();
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
    const body = await readJsonObject(c);
    if (!body) return c.json({ error: "bad_request" }, 400);
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
    const body = await readJsonObject(c);
    if (!body) return c.json({ error: "bad_request" }, 400);
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

  app.post("/api/auth/reset-password", async (c) => {
    const body = await readJsonObject(c);
    if (!body) return c.json({ error: "bad_request" }, 400);
    const code = asBoundedString(body.code, RESET_CODE_MAX, true);
    const password = asBoundedString(body.password, PASSWORD_MAX);
    const agent = userAgent(c);
    if (!code || !password || agent === null) {
      return c.json({ error: "bad_request" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "weak_password" }, 400);
    }

    const ip = clientIp(c);
    const resetLimit = rateLimited(c, [
      resetIpRl.checkDetailed(ip),
      resetCodeRl.checkDetailed(code),
    ]);
    if (resetLimit) return resetLimit;
    if (!isPasswordResetAvailable(db, code)) {
      return c.json({ error: "invalid_reset" }, 400);
    }

    const passwordHash = await hashPassword(password);
    const resetAt = new Date();
    const tx = db.transaction(() => {
      const userId = consumePasswordReset(db, code, resetAt);
      if (userId === null) throw new Error("invalid_reset");
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        passwordHash,
        userId,
      );
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      return db
        .prepare("SELECT id, email, display_name, role FROM users WHERE id = ?")
        .get(userId) as {
        id: number;
        email: string;
        display_name: string;
        role: "administrator" | "caregiver";
      };
    });

    let user: ReturnType<typeof tx>;
    try {
      user = tx.immediate();
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_reset") {
        return c.json({ error: "invalid_reset" }, 400);
      }
      throw error;
    }
    resetIpRl.reset(ip);
    resetCodeRl.reset(code);
    const sid = createSession(db, user.id, agent);
    setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
    return c.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        isAdmin: isAdmin(user),
      },
    });
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
  app.get("/api/auth/sessions", (c) => {
    const user = c.get("user");
    const currentId = getCookie(c, COOKIE);
    const sessions = listSessionsForUser(db, user.id).map((session) => ({
      ...session,
      current: currentId ? session.id === sessionPublicId(currentId) : false,
    }));
    return c.json({ sessions });
  });

  app.delete("/api/auth/sessions/:id", (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(sessionId)) {
      return c.json({ error: "bad_request" }, 400);
    }
    if (!deleteSessionForUser(db, sessionId, user.id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const currentSid = getCookie(c, COOKIE);
    const current = currentSid
      ? sessionId === sessionPublicId(currentSid)
      : false;
    if (current) deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true, current });
  });

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

  app.get("/api/caregivers", (c) => {
    if (!isAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
    const caregivers = (
      db
        .prepare(
          "SELECT id, email, display_name, role FROM users ORDER BY display_name COLLATE NOCASE, id",
        )
        .all() as Array<{
        id: number;
        email: string;
        display_name: string;
        role: "administrator" | "caregiver";
      }>
    ).map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isAdmin: isAdmin(user),
    }));
    return c.json({ caregivers });
  });

  app.post("/api/caregivers/:id/password-reset", (c) => {
    const sessionUser = c.get("user");
    if (!isAdmin(sessionUser)) return c.json({ error: "forbidden" }, 403);
    const rawId = c.req.param("id");
    if (!/^[1-9]\d*$/.test(rawId)) {
      return c.json({ error: "bad_request" }, 400);
    }
    const userId = Number(rawId);
    if (!Number.isSafeInteger(userId)) {
      return c.json({ error: "bad_request" }, 400);
    }
    const target = db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
    if (!target) return c.json({ error: "not_found" }, 404);

    const reset = createPasswordReset(db, userId, sessionUser.id);
    const origin = process.env.BABYONE_ORIGIN ?? "";
    return c.json({
      expiresAt: reset.expiresAt,
      url: `${origin}/reset-password?code=${reset.code}`,
    });
  });
}
