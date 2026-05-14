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
import {
  BabyInputSchema,
  ChatRequestSchema,
  RoutineRecordInputSchema,
} from "@babyone/shared";
import type { Context } from "hono";
import type { ZodSchema } from "zod";

const validateBody = async <T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> => {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    response: c.json(
      {
        error: parsed.error.issues[0]?.message ?? "invalid payload",
        details: parsed.error.flatten(),
      },
      400,
    ),
  };
};

seedIfEmpty();

const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, llm: llmEnabled }));

app.get("/api/baby", (c) => {
  const b = getBaby();
  if (!b) return c.json({ error: "baby not seeded" }, 500);
  return c.json(b);
});

app.put("/api/baby", async (c) => {
  const v = await validateBody(c, BabyInputSchema);
  if (!v.ok) return v.response;
  const saved = setBaby({ ...v.data, name: v.data.name.trim() });
  return c.json(saved);
});

app.get("/api/records", (c) => c.json(listRecords()));

app.post("/api/records", async (c) => {
  const v = await validateBody(c, RoutineRecordInputSchema);
  if (!v.ok) return v.response;
  return c.json(insertRecord(v.data));
});

app.put("/api/records/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const v = await validateBody(c, RoutineRecordInputSchema);
  if (!v.ok) return v.response;
  return c.json(updateRecord({ ...v.data, id }));
});

app.delete("/api/records/:id", (c) => {
  deleteRecord(Number(c.req.param("id")));
  return c.json({ ok: true });
});

app.get("/api/messages", (c) => c.json(listMessages()));

app.post("/api/chat", async (c) => {
  const v = await validateBody(c, ChatRequestSchema);
  if (!v.ok) return v.response;
  const { text } = v.data;
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
