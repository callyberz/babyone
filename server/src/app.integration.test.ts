import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppDependencies } from "./app.js";
import { createSession } from "./auth/sessions.js";

const ORIGIN = "http://localhost:5173";
const tempDir = mkdtempSync(join(tmpdir(), "babyone-app-test-"));
process.env.BABYONE_DB = join(tempDir, "integration.db");
process.env.BABYONE_ORIGIN = ORIGIN;

const repository = await import("./db.js");
const { db } = repository;
let cookie = "";
let authenticatedUserId = 0;
let databaseHealthy = true;

const llmParse = vi.fn<AppDependencies["llmParse"]>(async () => ({
  replyText: "Logged.",
  created: [],
  updated: [],
  deleted: [],
}));
const generateBriefText = vi.fn<AppDependencies["generateBriefText"]>(
  async () => "A calm morning brief.",
);

const app = createApp({
  db,
  origin: ORIGIN,
  checkDatabase: () => {
    if (!databaseHealthy) throw new Error("database unavailable");
    db.prepare("SELECT 1").get();
  },
  getLlmStatus: () => ({
    state: "healthy",
    provider: "anthropic",
    model: "test-model",
    fallback: "rule-based",
  }),
  llmParse,
  generateBriefText,
  getBaby: repository.getBaby,
  setBaby: repository.setBaby,
  listRecords: repository.listRecords,
  findRecords: repository.findRecords,
  getRecord: repository.getRecord,
  insertRecord: repository.insertRecord,
  updateRecord: repository.updateRecord,
  deleteRecord: repository.deleteRecord,
  bulkDeleteRecords: repository.bulkDeleteRecords,
  listMessages: repository.listMessages,
  listRecentChatMessages: repository.listRecentChatMessages,
  insertMessage: repository.insertMessage,
  claimChatRequest: repository.claimChatRequest,
  completeChatRequest: repository.completeChatRequest,
  hasBriefInRange: repository.hasBriefInRange,
  getKv: repository.getKv,
  setKv: repository.setKv,
  now: () => new Date("2026-08-13T15:00:00.000Z"),
});

beforeEach(() => {
  db.exec(`
    DELETE FROM invites;
    DELETE FROM sessions;
    DELETE FROM chat_requests;
    DELETE FROM messages;
    DELETE FROM records;
    DELETE FROM users;
    DELETE FROM kv;
  `);
  repository.ensureBaby(db, new Date("2026-08-11T12:00:00.000Z"));
  authenticatedUserId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, 'administrator', ?)",
      )
      .run("admin@example.com", "unused", "Admin", "2026-08-01T00:00:00Z")
      .lastInsertRowid,
  );
  cookie = `bo_sid=${createSession(db, authenticatedUserId, "integration-test")}`;
  databaseHealthy = true;
  llmParse.mockClear();
  generateBriefText.mockClear();
});

afterAll(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    authenticated?: boolean;
    origin?: string | null;
  } = {},
) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.authenticated !== false) headers.Cookie = cookie;
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    headers["Content-Type"] = "application/json";
    if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN;
  }
  const serializedBody =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (serializedBody !== undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(serializedBody));
  }
  return app.request(path, {
    method,
    headers,
    body: serializedBody,
  });
}

const recordDraft = {
  type: "diaper" as const,
  at: "2026-08-13T14:30:00.000Z",
  title: "Diaper — wet",
  detail: "",
  meta: { kind: "wet" as const },
};

describe("mounted application health and security", () => {
  it("reports database readiness without authentication", async () => {
    const healthy = await request("/api/health", { authenticated: false });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      ok: true,
      db: { state: "healthy" },
      llm: { state: "healthy" },
    });

    databaseHealthy = false;
    const unhealthy = await request("/api/health", { authenticated: false });
    expect(unhealthy.status).toBe(503);
    expect(await unhealthy.json()).toMatchObject({
      ok: false,
      db: { state: "unhealthy" },
    });
  });

  it("gates core routes and rejects writes from the wrong origin", async () => {
    expect(
      (await request("/api/records", { authenticated: false })).status,
    ).toBe(401);
    expect(
      (
        await request("/api/records", {
          method: "POST",
          body: recordDraft,
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects oversized API bodies before parsing them", async () => {
    const response = await request("/api/chat", {
      method: "POST",
      rawBody: JSON.stringify({ text: "x".repeat(17 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });
});

describe("baby profile routes", () => {
  it("reads, validates, and persists the profile", async () => {
    const initial = await request("/api/baby");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ name: "Clement" });

    const invalid = await request("/api/baby", {
      method: "PUT",
      body: { name: "", birthdate: "nope" },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_baby" });

    const baby = {
      name: "Clemmie",
      birthdate: "2026-08-09",
      weightValue: 7.4,
      weightUnit: "lb",
    };
    const saved = await request("/api/baby", { method: "PUT", body: baby });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(baby);
    expect(repository.getBaby()).toEqual(baby);
  });
});

describe("record routes", () => {
  it("creates, lists, updates, and deletes an attributed record", async () => {
    const createdResponse = await request("/api/records", {
      method: "POST",
      body: recordDraft,
    });
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as { id: number };

    const list = await request("/api/records");
    expect(await list.json()).toEqual([
      expect.objectContaining({
        id: created.id,
        title: "Diaper — wet",
        user: { id: authenticatedUserId, displayName: "Admin" },
      }),
    ]);

    const updated = await request(`/api/records/${created.id}`, {
      method: "PUT",
      body: { ...recordDraft, title: "Diaper — both", meta: { kind: "both" } },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ title: "Diaper — both" });

    const deleted = await request(`/api/records/${created.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(repository.listRecords()).toEqual([]);
  });

  it("returns consistent validation and not-found responses", async () => {
    const invalid = await request("/api/records", {
      method: "POST",
      body: { ...recordDraft, at: "not-a-date" },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_record" });

    const badId = await request("/api/records/0", {
      method: "PUT",
      body: recordDraft,
    });
    expect(badId.status).toBe(400);

    const missing = await request("/api/records/999", {
      method: "PUT",
      body: recordDraft,
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    const deleteMissing = await request("/api/records/999", {
      method: "DELETE",
    });
    expect(deleteMissing.status).toBe(404);
    expect(await deleteMissing.json()).toEqual({ error: "not_found" });
  });
});

describe("chat and brief routes", () => {
  it("returns 400 for malformed requests before invoking services", async () => {
    const malformedChat = await request("/api/chat", {
      method: "POST",
      rawBody: "{",
    });
    expect(malformedChat.status).toBe(400);
    expect(await malformedChat.json()).toEqual({ error: "bad_request" });

    const invalidBrief = await request("/api/brief/today", {
      method: "POST",
      body: { localDate: "2026-02-30", tzOffsetMin: 0 },
    });
    expect(invalidBrief.status).toBe(400);
    expect(await invalidBrief.json()).toEqual({ error: "bad_request" });
    expect(llmParse).not.toHaveBeenCalled();
    expect(generateBriefText).not.toHaveBeenCalled();
  });

  it("persists a valid chat turn while using the injected LLM", async () => {
    const requestId = "integration-chat-request-1";
    const response = await request("/api/chat", {
      method: "POST",
      body: { text: "hello", tzOffsetMin: 240, requestId },
    });
    expect(response.status).toBe(200);
    const firstResult = await response.json();
    expect(llmParse).toHaveBeenCalledWith(
      "hello",
      new Date("2026-08-13T15:00:00.000Z"),
      authenticatedUserId,
      240,
      [],
    );
    expect(repository.listMessages().map((message) => message.text)).toEqual([
      "hello",
      "Logged.",
    ]);

    const retry = await request("/api/chat", {
      method: "POST",
      body: { text: "hello", tzOffsetMin: 240, requestId },
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstResult);
    expect(llmParse).toHaveBeenCalledTimes(1);
    expect(repository.listMessages()).toHaveLength(2);

    const conflict = await request("/api/chat", {
      method: "POST",
      body: { text: "different text", tzOffsetMin: 240, requestId },
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "request_id_conflict" });
  });

  it("handles a valid brief request with insufficient data", async () => {
    const response = await request("/api/brief/today", {
      method: "POST",
      body: { localDate: "2026-08-13", tzOffsetMin: 240 },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: null,
      reason: "insufficient_data",
    });
    expect(generateBriefText).not.toHaveBeenCalled();
  });
});
