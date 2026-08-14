import { serveStatic } from "@hono/node-server/serve-static";
import type DatabaseT from "better-sqlite3";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type {
  Baby,
  ChatMessage,
  HouseholdSync,
  ParseResult,
  RoutineRecord,
} from "./types.js";
import type {
  BriefRequestClaim,
  ChatApiResponse,
  ChatRequestClaim,
  HouseholdExport,
} from "./db.js";
import { validateBaby, validateRecordDraft } from "./types.js";
import type { ConversationTurn } from "./llm.js";
import type { LlmStatus } from "./llm/config.js";
import {
  aggregateBaseline,
  aggregateDay,
  computeBriefWindow,
} from "./brief.js";
import {
  isAdmin,
  makeRequireAuth,
  type AuthEnv,
} from "./auth/middleware.js";
import { mountAuthRoutes, mountInviteRoutes } from "./auth/routes.js";
import {
  parseRecordId,
  parseSyncCursor,
  validateBriefRequest,
  validateBulkDeleteRequest,
  validateChatRequest,
} from "./httpValidation.js";

interface FindRecordsOptions {
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
}

export interface AppDependencies {
  db: DatabaseT.Database;
  origin: string;
  staticRoot?: string;
  checkDatabase: () => void;
  getLlmStatus: () => LlmStatus;
  llmParse: (
    text: string,
    now: Date,
    loggerId: number | null,
    tzOffsetMin: number | null,
    history: ConversationTurn[],
  ) => Promise<ParseResult>;
  generateBriefText: (
    yesterday: ReturnType<typeof aggregateDay>,
    baseline: ReturnType<typeof aggregateDay>,
  ) => Promise<string>;
  getBaby: () => Baby;
  setBaby: (baby: Baby) => Baby;
  listRecords: () => RoutineRecord[];
  findRecords: (options: FindRecordsOptions) => RoutineRecord[];
  getRecord: (id: number) => RoutineRecord | null;
  insertRecord: (
    record: Omit<RoutineRecord, "id"> & { userId?: number | null },
  ) => RoutineRecord;
  updateRecord: (record: RoutineRecord) => RoutineRecord;
  deleteRecord: (id: number) => void;
  bulkDeleteRecords: (ids: number[]) => number[];
  listMessages: () => ChatMessage[];
  getSyncSnapshot: () => HouseholdSync;
  getSyncDelta: (after: number) => HouseholdSync;
  exportHouseholdData: (at: Date) => HouseholdExport;
  listRecentChatMessages: (limit: number) => ChatMessage[];
  insertMessage: (message: Omit<ChatMessage, "id">) => ChatMessage;
  claimChatRequest: (input: {
    userId: number;
    requestId: string;
    text: string;
    at: string;
  }) => ChatRequestClaim;
  completeChatRequest: (input: {
    userId: number;
    requestId: string;
    bot: Omit<ChatMessage, "id">;
    created: RoutineRecord[];
    updated: RoutineRecord[];
    deleted: number[];
  }) => ChatApiResponse;
  claimBriefRequest: (input: {
    localDate: string;
    at: string;
    staleAfterMs?: number;
  }) => BriefRequestClaim;
  completeBriefRequest: (input: {
    localDate: string;
    at: string;
    text?: string;
    reason?: string;
  }) => { message: ChatMessage | null; reason?: string };
  now?: () => Date;
}

export function createApp(deps: AppDependencies): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const now = deps.now ?? (() => new Date());

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
      permissionsPolicy: {
        camera: [],
        geolocation: [],
        microphone: [],
      },
      xFrameOptions: "DENY",
    }),
  );

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );

  app.use(
    "/api/*",
    cors({
      origin: deps.origin,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.use("/api/*", async (c, next) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(c.req.method)) {
      if (c.req.header("Origin") !== deps.origin) {
        return c.json({ error: "bad_origin" }, 403);
      }
    }
    await next();
  });

  app.get("/api/health", (c) => {
    try {
      deps.checkDatabase();
      return c.json({
        ok: true,
        db: { state: "healthy" as const },
        llm: deps.getLlmStatus(),
      });
    } catch {
      return c.json(
        {
          ok: false,
          db: { state: "unhealthy" as const },
          llm: deps.getLlmStatus(),
        },
        503,
      );
    }
  });
  mountAuthRoutes(app, deps.db);

  app.use("/api/*", makeRequireAuth(deps.db));
  mountInviteRoutes(app, deps.db);

  app.get("/api/baby", (c) => c.json(deps.getBaby()));

  app.put("/api/baby", async (c) => {
    const body = await c.req.json().catch(() => null);
    const validation = validateBaby(body);
    if (!validation.ok) {
      return c.json({ error: "invalid_baby", issues: validation.issues }, 400);
    }
    return c.json(deps.setBaby(validation.value));
  });

  app.get("/api/records", (c) => c.json(deps.listRecords()));

  app.post("/api/records", async (c) => {
    const body = await c.req.json().catch(() => null);
    const validation = validateRecordDraft(body);
    if (!validation.ok) {
      return c.json({ error: "invalid_record", issues: validation.issues }, 400);
    }
    const user = c.get("user");
    return c.json(
      deps.insertRecord({ ...validation.value, userId: user.id }),
    );
  });

  app.put("/api/records/:id", async (c) => {
    const id = parseRecordId(c.req.param("id"));
    if (id === null) return c.json({ error: "bad_request" }, 400);
    const existing = deps.getRecord(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const validation = validateRecordDraft(body);
    if (!validation.ok) {
      return c.json({ error: "invalid_record", issues: validation.issues }, 400);
    }
    return c.json(
      deps.updateRecord({
        ...validation.value,
        id,
        user: existing.user,
      } as RoutineRecord),
    );
  });

  app.delete("/api/records/:id", (c) => {
    const id = parseRecordId(c.req.param("id"));
    if (id === null) return c.json({ error: "bad_request" }, 400);
    if (!deps.getRecord(id)) return c.json({ error: "not_found" }, 404);
    deps.deleteRecord(id);
    return c.json({ ok: true });
  });

  app.post("/api/records/bulk-delete", async (c) => {
    const user = c.get("user");
    if (!isAdmin(user)) return c.json({ error: "forbidden" }, 403);

    const body: unknown = await c.req.json().catch(() => null);
    const validation = validateBulkDeleteRequest(body);
    if (!validation.ok) return c.json({ error: "bad_request" }, 400);
    return c.json({ deleted: deps.bulkDeleteRecords(validation.value) });
  });

  app.get("/api/messages", (c) => c.json(deps.listMessages()));

  app.get("/api/sync", (c) => {
    const cursor = parseSyncCursor(c.req.query("after"));
    if (cursor === false) {
      return c.json({ error: "bad_request" }, 400);
    }
    return c.json(
      cursor === null ? deps.getSyncSnapshot() : deps.getSyncDelta(cursor),
    );
  });

  app.get("/api/export", (c) => {
    if (!isAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
    const exportedAt = now();
    c.header(
      "Content-Disposition",
      `attachment; filename="babyone-household-${exportedAt.toISOString().slice(0, 10)}.json"`,
    );
    return c.json(deps.exportHouseholdData(exportedAt));
  });

  app.post("/api/chat", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const validation = validateChatRequest(body);
    if (!validation.ok) return c.json({ error: "bad_request" }, 400);
    const { text, tzOffsetMin, requestId } = validation.value;
    const requestNow = now();
    const sessionUser = c.get("user");
    const history = deps.listRecentChatMessages(10).map((message) => ({
      role:
        message.from === "user"
          ? ("user" as const)
          : ("assistant" as const),
      text: message.text,
    }));

    let userMsg: ChatMessage;
    if (requestId) {
      const claim = deps.claimChatRequest({
        userId: sessionUser.id,
        requestId,
        text,
        at: requestNow.toISOString(),
      });
      if (claim.state === "completed") return c.json(claim.response);
      if (claim.state === "pending") {
        c.header("Retry-After", "1");
        return c.json({ error: "request_in_progress" }, 409);
      }
      if (claim.state === "conflict") {
        return c.json({ error: "request_id_conflict" }, 409);
      }
      userMsg = claim.userMsg;
    } else {
      // Backward compatibility for older clients. New clients always supply a
      // request ID so retries are durable and exactly-once at the API layer.
      userMsg = deps.insertMessage({
        from: "user",
        at: requestNow.toISOString(),
        text,
        recordIds: [],
      });
    }
    const result = await deps.llmParse(
      text,
      requestNow,
      sessionUser.id,
      tzOffsetMin,
      history,
    );
    const botDraft: Omit<ChatMessage, "id"> = {
      from: "bot",
      at: now().toISOString(),
      text: result.replyText,
      recordIds: [
        ...result.created.map((record) => record.id),
        ...result.updated.map((record) => record.id),
      ],
    };

    if (requestId) {
      return c.json(
        deps.completeChatRequest({
          userId: sessionUser.id,
          requestId,
          bot: botDraft,
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        }),
      );
    }
    const botMsg = deps.insertMessage(botDraft);

    return c.json({ userMsg, botMsg, ...result });
  });

  app.post("/api/brief/today", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const validation = validateBriefRequest(body);
    if (!validation.ok) return c.json({ error: "bad_request" }, 400);
    const { localDate, tzOffsetMin, timeZone } = validation.value;
    const claim = deps.claimBriefRequest({
      localDate,
      at: now().toISOString(),
    });
    if (claim.state === "pending") {
      c.header("Retry-After", "1");
      return c.json({ message: null, reason: "in_progress" }, 409);
    }
    if (claim.state === "completed") {
      return c.json({
        message: claim.message,
        reason: claim.message ? "already_generated" : claim.reason,
      });
    }

    const { yesterdayStart, yesterdayEnd, baselineStart } =
      computeBriefWindow(localDate, tzOffsetMin, timeZone);

    const all = deps.findRecords({
      since: baselineStart,
      until: yesterdayEnd,
      limit: 2000,
    });
    const yesterdayRecords = all.filter(
      (record) => record.at >= yesterdayStart && record.at < yesterdayEnd,
    );
    const baselineRecords = all.filter(
      (record) => record.at < yesterdayStart,
    );

    if (yesterdayRecords.length <= 2) {
      return c.json(
        deps.completeBriefRequest({
          localDate,
          at: now().toISOString(),
          reason: "insufficient_data",
        }),
      );
    }

    const yesterday = aggregateDay(yesterdayRecords);
    const { avg } = aggregateBaseline(
      baselineRecords,
      new Date(baselineStart),
      new Date(yesterdayStart),
    );
    const text = await deps.generateBriefText(yesterday, avg);
    return c.json(
      deps.completeBriefRequest({
        localDate,
        at: now().toISOString(),
        text,
      }),
    );
  });

  if (deps.staticRoot) {
    app.use("/assets/*", serveStatic({ root: deps.staticRoot }));
    app.get("*", serveStatic({ root: deps.staticRoot, path: "index.html" }));
  }

  return app;
}
