import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  db,
  deleteRecord,
  findRecords,
  getKv,
  hasBriefInRange,
  insertMessage,
  insertRecord,
  listMessages,
  listRecords,
  setKv,
  updateRecord,
} from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { llmEnabled, llmParse } from "./llm.js";
import {
  aggregateBaseline,
  aggregateDay,
  computeBriefWindow,
  generateBriefText,
} from "./brief.js";
import type { RoutineRecord } from "./types.js";
import {
  originGuard,
  makeRequireAuth,
  type AuthEnv,
} from "./auth/middleware.js";
import { mountAuthRoutes, mountInviteRoutes } from "./auth/routes.js";
import { cleanupExpiredSessions } from "./auth/sessions.js";
import { cleanupExpiredInvites } from "./auth/invites.js";

seedIfEmpty();
cleanupExpiredSessions(db);
cleanupExpiredInvites(db);

const app = new Hono<AuthEnv>();

const origin = process.env.BABYONE_ORIGIN ?? "http://localhost:5173";
app.use(
  "/api/*",
  cors({
    origin,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowHeaders: ["Content-Type"],
  }),
);

app.use("/api/*", originGuard);

// Open routes (mounted BEFORE requireAuth so they pass through).
app.get("/api/health", (c) => c.json({ ok: true, llm: llmEnabled }));
mountAuthRoutes(app, db);

// Everything else under /api/* requires a valid session.
const requireAuth = makeRequireAuth(db);
app.use("/api/*", requireAuth);

// Gated auth-adjacent routes (must come AFTER requireAuth).
mountInviteRoutes(app, db);

app.get("/api/baby", (c) =>
  c.json({
    name: "Clement",
    age: "18 days",
    weight: "7.4 lb",
  }),
);

app.get("/api/records", (c) => c.json(listRecords()));

app.post("/api/records", async (c) => {
  const body = (await c.req.json()) as Omit<RoutineRecord, "id" | "user">;
  const user = c.get("user");
  return c.json(insertRecord({ ...body, userId: user.id }));
});

app.put("/api/records/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as Omit<RoutineRecord, "id">;
  return c.json(updateRecord({ ...body, id }));
});

app.delete("/api/records/:id", (c) => {
  deleteRecord(Number(c.req.param("id")));
  return c.json({ ok: true });
});

app.get("/api/messages", (c) => c.json(listMessages()));

app.post("/api/chat", async (c) => {
  const { text } = (await c.req.json()) as { text: string };
  const now = new Date();

  const userMsg = insertMessage({
    from: "user",
    at: now.toISOString(),
    text,
    recordIds: [],
  });

  const result = await llmParse(text, now);
  const recordIds = [
    ...result.created.map((r) => r.id),
    ...result.updated.map((r) => r.id),
  ];

  const botMsg = insertMessage({
    from: "bot",
    at: new Date().toISOString(),
    text: result.replyText,
    recordIds,
  });

  return c.json({
    userMsg,
    botMsg,
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
  });
});

app.post("/api/brief/today", async (c) => {
  const { localDate, tzOffsetMin } = (await c.req.json()) as {
    localDate: string;
    tzOffsetMin: number;
  };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
    typeof tzOffsetMin !== "number"
  ) {
    return c.json({ error: "bad_request" }, 400);
  }

  if (getKv("brief.lastDate") === localDate) {
    return c.json({ message: null, reason: "already_generated" });
  }

  const { yesterdayStart, yesterdayEnd, baselineStart, todayEnd } =
    computeBriefWindow(localDate, tzOffsetMin);

  // Belt-and-suspenders: if the kv flag was lost (DB restore, manual edit),
  // fall back to checking whether a brief message already exists for today.
  if (hasBriefInRange(yesterdayEnd, todayEnd)) {
    setKv("brief.lastDate", localDate);
    return c.json({ message: null, reason: "already_generated" });
  }

  const all = findRecords({
    since: baselineStart,
    until: yesterdayEnd,
    limit: 2000,
  });
  const yesterdayRecords = all.filter(
    (r) => r.at >= yesterdayStart && r.at < yesterdayEnd,
  );
  const baselineRecords = all.filter((r) => r.at < yesterdayStart);

  if (yesterdayRecords.length <= 2) {
    setKv("brief.lastDate", localDate);
    return c.json({ message: null, reason: "insufficient_data" });
  }

  const yest = aggregateDay(yesterdayRecords);
  const { avg } = aggregateBaseline(
    baselineRecords,
    new Date(baselineStart),
    new Date(yesterdayStart),
  );
  const text = await generateBriefText(yest, avg);

  const msg = insertMessage({
    from: "bot",
    at: new Date().toISOString(),
    text,
    recordIds: [],
    kind: "brief",
  });
  setKv("brief.lastDate", localDate);
  return c.json({ message: msg });
});

const staticRoot = process.env.STATIC_ROOT ?? "../client/dist";
app.use("/assets/*", serveStatic({ root: staticRoot }));
app.get("*", serveStatic({ root: staticRoot, path: "index.html" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(
  `[babyone] server listening on http://localhost:${port}  llm=${llmEnabled ? "claude" : "rule-based"}`,
);
