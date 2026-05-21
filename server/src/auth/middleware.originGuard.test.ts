import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { originGuard } from "./middleware.js";

let app: Hono;
beforeEach(() => {
  process.env.BABYONE_ORIGIN = "http://localhost:5173";
  app = new Hono();
  app.use("/api/*", originGuard);
  app.get("/api/x", (c) => c.json({ ok: true }));
  app.post("/api/x", (c) => c.json({ ok: true }));
});

describe("originGuard", () => {
  it("allows GET with no Origin", async () => {
    const res = await app.request("/api/x");
    expect(res.status).toBe(200);
  });

  it("rejects POST with missing Origin", async () => {
    const res = await app.request("/api/x", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("rejects POST with wrong Origin", async () => {
    const res = await app.request("/api/x", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("allows POST with matching Origin", async () => {
    const res = await app.request("/api/x", {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
  });
});
