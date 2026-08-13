import { serve } from "@hono/node-server";
import {
  bulkDeleteRecords,
  claimChatRequest,
  completeChatRequest,
  db,
  deleteRecord,
  findRecords,
  getBaby,
  getKv,
  getRecord,
  hasBriefInRange,
  insertMessage,
  insertRecord,
  listMessages,
  listRecentChatMessages,
  listRecords,
  setBaby,
  setKv,
  updateRecord,
} from "./db.js";
import { createApp } from "./app.js";
import { generateBriefText } from "./brief.js";
import { getLlmStatus, llmParse } from "./llm.js";
import { bootstrapAuth, seedIfEmpty } from "./seed.js";
import { cleanupExpiredInvites } from "./auth/invites.js";
import { cleanupExpiredSessions } from "./auth/sessions.js";

if (process.env.BABYONE_SEED_DEMO === "1") seedIfEmpty();
await bootstrapAuth();
cleanupExpiredSessions(db);
cleanupExpiredInvites(db);

const origin = process.env.BABYONE_ORIGIN ?? "http://localhost:5173";
const staticRoot = process.env.STATIC_ROOT ?? "../client/dist";
const app = createApp({
  db,
  origin,
  staticRoot,
  checkDatabase: () => {
    db.prepare("SELECT 1").get();
  },
  getLlmStatus,
  llmParse,
  generateBriefText,
  getBaby,
  setBaby,
  listRecords,
  findRecords,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  bulkDeleteRecords,
  listMessages,
  listRecentChatMessages,
  insertMessage,
  claimChatRequest,
  completeChatRequest,
  hasBriefInRange,
  getKv,
  setKv,
});

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
const server = serve({ fetch: app.fetch, port, hostname });
console.log(
  `[babyone] server listening on http://${hostname}:${port}  llm=${getLlmStatus().state}`,
);

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[babyone] ${signal} received; closing cleanly`);
  server.close(() => {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  });
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
