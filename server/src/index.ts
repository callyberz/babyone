import { serve } from "@hono/node-server";
import {
  bulkDeleteRecords,
  claimBriefRequest,
  claimChatRequest,
  completeBriefRequest,
  checkpointAndCloseDatabase,
  completeChatRequest,
  createRecordIdempotently,
  db,
  deleteRecord,
  exportHouseholdData,
  findRecords,
  getBaby,
  getRecord,
  getSyncDelta,
  getSyncSnapshot,
  insertMessage,
  insertRecord,
  listMessages,
  listRecentChatMessages,
  listRecords,
  releaseBriefRequest,
  setBaby,
  updateRecord,
} from "./db.js";
import { createApp } from "./app.js";
import { generateBriefText } from "./brief.js";
import { getLlmStatus, llmParse } from "./llm.js";
import { bootstrapAuth, seedIfEmpty } from "./seed.js";
import { cleanupExpiredInvites } from "./auth/invites.js";
import { cleanupExpiredSessions } from "./auth/sessions.js";
import { cleanupExpiredPasswordResets } from "./auth/passwordResets.js";

if (process.env.BABYONE_SEED_DEMO === "1") seedIfEmpty();
await bootstrapAuth();
cleanupExpiredSessions(db);
cleanupExpiredInvites(db);
cleanupExpiredPasswordResets(db);

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
  createRecordIdempotently,
  updateRecord,
  deleteRecord,
  bulkDeleteRecords,
  listMessages,
  getSyncSnapshot,
  getSyncDelta,
  exportHouseholdData,
  listRecentChatMessages,
  insertMessage,
  claimChatRequest,
  completeChatRequest,
  claimBriefRequest,
  completeBriefRequest,
  releaseBriefRequest,
});

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
const server = serve({ fetch: app.fetch, port, hostname });
console.log(
  `[babyone] server listening on http://${hostname}:${port}  llm=${getLlmStatus().state}`,
);

let shuttingDown = false;
const SHUTDOWN_GRACE_MS = 10_000;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[babyone] ${signal} received; closing cleanly`);

  let finalized = false;
  let forceTimer: NodeJS.Timeout;
  const finalize = (error?: Error) => {
    if (finalized) return;
    finalized = true;
    clearTimeout(forceTimer);
    try {
      checkpointAndCloseDatabase(db);
    } catch (closeError) {
      console.error("[babyone] database shutdown failed", closeError);
      process.exitCode = 1;
    }
    if (error) {
      console.error("[babyone] HTTP shutdown failed", error);
      process.exitCode = 1;
    }
  };

  forceTimer = setTimeout(() => {
    console.error(
      `[babyone] graceful shutdown exceeded ${SHUTDOWN_GRACE_MS}ms; closing active connections`,
    );
    // `serve` is typed as an HTTP/1-or-HTTP/2 union. The default server used
    // here is HTTP/1 and supports forcibly draining lingering keep-alive
    // sockets, while retaining a safe fallback if that default ever changes.
    if ("closeAllConnections" in server) server.closeAllConnections();
    else server.close();
    finalize(new Error("graceful shutdown timed out"));
  }, SHUTDOWN_GRACE_MS);
  forceTimer.unref();
  server.close(finalize);
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
