import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  deleteRecord,
  insertMessage,
  insertRecord,
  listMessages,
  listRecords,
  updateRecord,
} from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { llmEnabled, llmParse } from "./llm.js";
import type { RoutineRecord } from "./types.js";

seedIfEmpty();

const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, llm: llmEnabled }));

app.get("/api/baby", (c) =>
  c.json({
    name: "Clement",
    age: "18 days",
    weight: "7.4 lb",
  }),
);

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
