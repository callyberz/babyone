import type { MiddlewareHandler } from "hono";

const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

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
