import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  deleteRecord,
  getBaby,
  insertMessage,
  insertRecord,
  listMessages,
  listRecords,
  setBaby,
  updateRecord,
} from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { llmEnabled, llmParse } from "./llm.js";
import type { Baby, RoutineRecord } from "./types.js";

seedIfEmpty();

const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, llm: llmEnabled }));

app.get("/api/baby", (c) => {
  const b = getBaby();
  if (!b) return c.json({ error: "baby not seeded" }, 500);
  return c.json(b);
});

const isValidIsoDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

const validateBaby = (b: Partial<Baby>): string | null => {
  if (typeof b.name !== "string" || !b.name.trim()) return "name required";
  if (b.name.trim().length > 60) return "name too long";
  if (typeof b.birthdate !== "string" || !isValidIsoDate(b.birthdate))
    return "birthdate must be YYYY-MM-DD";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(b.birthdate).getTime() > today.getTime())
    return "birthdate cannot be in the future";
  if (
    typeof b.weightValue !== "number" ||
    !Number.isFinite(b.weightValue) ||
    b.weightValue <= 0 ||
    b.weightValue >= 1000
  )
    return "weightValue must be a positive number under 1000";
  if (b.weightUnit !== "lb" && b.weightUnit !== "kg")
    return "weightUnit must be 'lb' or 'kg'";
  return null;
};

app.put("/api/baby", async (c) => {
  const body = (await c.req.json()) as Partial<Baby>;
  const err = validateBaby(body);
  if (err) return c.json({ error: err }, 400);
  const saved = setBaby({
    name: body.name!.trim(),
    birthdate: body.birthdate!,
    weightValue: body.weightValue!,
    weightUnit: body.weightUnit!,
  });
  return c.json(saved);
});

app.get("/api/records", (c) => c.json(listRecords()));

app.post("/api/records", async (c) => {
  const body = (await c.req.json()) as Omit<RoutineRecord, "id">;
  return c.json(insertRecord(body));
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

const staticRoot = process.env.STATIC_ROOT ?? "../client/dist";
app.use("/assets/*", serveStatic({ root: staticRoot }));
app.get("*", serveStatic({ root: staticRoot, path: "index.html" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(
  `[babyone] server listening on http://localhost:${port}  llm=${llmEnabled ? "claude" : "rule-based"}`,
);
