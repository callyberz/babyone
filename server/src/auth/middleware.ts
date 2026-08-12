import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type DatabaseT from "better-sqlite3";
import { findSession } from "./sessions.js";

const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export function isAdmin(user: { role: string }): boolean {
  return user.role === "administrator";
}

export const originGuard: MiddlewareHandler = async (c, next) => {
  if (WRITE_METHODS.has(c.req.method)) {
    const allowed = process.env.BABYONE_ORIGIN;
    const origin = c.req.header("Origin");
    if (!allowed || !origin || origin !== allowed) {
      return c.json({ error: "bad_origin" }, 403);
    }
  }
  await next();
};

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: "administrator" | "caregiver";
}

export type AuthEnv = { Variables: { user: AuthUser } };

export function makeRequireAuth(
  db: DatabaseT.Database,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const sid = getCookie(c, "bo_sid");
    if (!sid) return c.json({ error: "unauthenticated" }, 401);
    const row = findSession(db, sid);
    if (!row) return c.json({ error: "unauthenticated" }, 401);
    c.set("user", {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
    });
    await next();
  };
}
