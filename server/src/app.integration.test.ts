import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppDependencies } from "./app.js";
import { createSession, findSession } from "./auth/sessions.js";
import { verifyPassword } from "./auth/passwords.js";

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
  createRecordIdempotently: repository.createRecordIdempotently,
  updateRecord: repository.updateRecord,
  deleteRecord: repository.deleteRecord,
  bulkDeleteRecords: repository.bulkDeleteRecords,
  listMessages: repository.listMessages,
  getSyncSnapshot: repository.getSyncSnapshot,
  getSyncDelta: repository.getSyncDelta,
  exportHouseholdData: repository.exportHouseholdData,
  listRecentChatMessages: repository.listRecentChatMessages,
  insertMessage: repository.insertMessage,
  claimChatRequest: repository.claimChatRequest,
  completeChatRequest: repository.completeChatRequest,
  claimBriefRequest: repository.claimBriefRequest,
  completeBriefRequest: repository.completeBriefRequest,
  releaseBriefRequest: repository.releaseBriefRequest,
  now: () => new Date("2026-08-13T15:00:00.000Z"),
});

beforeEach(() => {
  db.exec(`
    DELETE FROM password_resets;
    DELETE FROM invites;
    DELETE FROM sessions;
    DELETE FROM chat_requests;
    DELETE FROM record_requests;
    DELETE FROM brief_requests;
    DELETE FROM messages;
    DELETE FROM records;
    DELETE FROM users;
    DELETE FROM kv;
    DELETE FROM sync_changes;
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
    sessionCookie?: string;
  } = {},
) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.authenticated !== false) {
    headers.Cookie = options.sessionCookie ?? cookie;
  }
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
  it("hardens responses and prevents API data from being cached", async () => {
    const response = await request("/api/baby");

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");

    const unauthenticated = await request("/api/records", {
      authenticated: false,
    });
    expect(unauthenticated.headers.get("cache-control")).toBe("no-store");
    expect(unauthenticated.headers.get("x-frame-options")).toBe("DENY");
  });

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

  it("creates an idempotent record once and replays only its current state", async () => {
    const requestId = "record-request-integration-1";
    const create = () =>
      request("/api/records", {
        method: "POST",
        body: { ...recordDraft, requestId },
      });

    const firstResponse = await create();
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as { id: number; title: string };

    const retry = await create();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(first);
    expect(repository.listRecords()).toHaveLength(1);

    const conflict = await request("/api/records", {
      method: "POST",
      body: { ...recordDraft, title: "Different diaper", requestId },
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "request_id_conflict" });

    const update = await request(`/api/records/${first.id}`, {
      method: "PUT",
      body: { ...recordDraft, title: "Corrected diaper" },
    });
    expect(update.status).toBe(200);

    const retryAfterEdit = await create();
    expect(retryAfterEdit.status).toBe(200);
    expect(await retryAfterEdit.json()).toMatchObject({
      id: first.id,
      title: "Corrected diaper",
    });

    const remove = await request(`/api/records/${first.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);

    const retryAfterDelete = await create();
    expect(retryAfterDelete.status).toBe(410);
    expect(await retryAfterDelete.json()).toEqual({ error: "record_gone" });
    expect(repository.listRecords()).toEqual([]);
  });

  it("serves a full household snapshot followed by incremental changes", async () => {
    const created = repository.insertRecord({
      ...recordDraft,
      userId: authenticatedUserId,
    });
    repository.insertMessage({
      from: "bot",
      at: "2026-08-13T14:31:00.000Z",
      text: "Logged.",
      recordIds: [created.id],
    });

    const initial = await request("/api/sync");
    expect(initial.status).toBe(200);
    const snapshot = (await initial.json()) as {
      full: boolean;
      cursor: number;
      records: Array<{ id: number; title: string }>;
      messages: Array<{ text: string }>;
    };
    expect(snapshot).toMatchObject({ full: true, hasMore: false });
    expect(snapshot.records.map((record) => record.id)).toEqual([created.id]);
    expect(snapshot.messages.map((message) => message.text)).toEqual(["Logged."]);

    repository.updateRecord({ ...created, title: "Updated diaper" });
    const second = repository.insertRecord({
      ...recordDraft,
      at: "2026-08-13T14:40:00.000Z",
      title: "Second diaper",
    });
    repository.deleteRecord(second.id);

    const delta = await request(`/api/sync?after=${snapshot.cursor}`);
    expect(delta.status).toBe(200);
    expect(await delta.json()).toMatchObject({
      full: false,
      hasMore: false,
      records: [{ id: created.id, title: "Updated diaper" }],
      deletedRecordIds: [second.id],
      messages: [],
      deletedMessageIds: [],
    });

    expect((await request("/api/sync?after=-1")).status).toBe(400);
  });

  it("exports a secret-free household archive for administrators only", async () => {
    const caregiverId = Number(
      db
        .prepare(
          "INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, 'caregiver', ?)",
        )
        .run(
          "caregiver@example.com",
          "never-export-this-hash",
          "Caregiver",
          "2026-08-02T00:00:00Z",
        ).lastInsertRowid,
    );
    repository.insertRecord({ ...recordDraft, userId: authenticatedUserId });

    const response = await request("/api/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="babyone-household-2026-08-13.json"',
    );
    const text = await response.text();
    expect(text).not.toContain("never-export-this-hash");
    const archive = JSON.parse(text) as {
      schemaVersion: number;
      exportedAt: string;
      caregivers: Array<{ id: number; displayName: string }>;
      records: unknown[];
    };
    expect(archive).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-08-13T15:00:00.000Z",
    });
    expect(archive.caregivers.map((user) => user.displayName)).toEqual([
      "Admin",
      "Caregiver",
    ]);
    expect(archive.records).toHaveLength(1);

    const caregiverCookie = `bo_sid=${createSession(db, caregiverId, "integration-test")}`;
    const forbidden = await request("/api/export", {
      sessionCookie: caregiverCookie,
    });
    expect(forbidden.status).toBe(403);
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

describe("caregiver access recovery", () => {
  it("lets only administrators list caregivers and issue one-time reset links", async () => {
    const caregiverId = Number(
      db
        .prepare(
          "INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, 'caregiver', ?)",
        )
        .run(
          "maya@example.com",
          "old-hash",
          "Maya",
          "2026-08-02T00:00:00.000Z",
        ).lastInsertRowid,
    );
    const caregiverSid = createSession(db, caregiverId, "old-device");
    const caregiverCookie = `bo_sid=${caregiverSid}`;

    const forbiddenList = await request("/api/caregivers", {
      sessionCookie: caregiverCookie,
    });
    expect(forbiddenList.status).toBe(403);
    const forbiddenReset = await request(
      `/api/caregivers/${authenticatedUserId}/password-reset`,
      { method: "POST", body: {}, sessionCookie: caregiverCookie },
    );
    expect(forbiddenReset.status).toBe(403);

    const list = await request("/api/caregivers");
    expect(list.status).toBe(200);
    const listText = await list.text();
    expect(listText).not.toContain("old-hash");
    expect(JSON.parse(listText)).toEqual({
      caregivers: [
        {
          id: authenticatedUserId,
          email: "admin@example.com",
          displayName: "Admin",
          isAdmin: true,
        },
        {
          id: caregiverId,
          email: "maya@example.com",
          displayName: "Maya",
          isAdmin: false,
        },
      ],
    });

    const issued = await request(
      `/api/caregivers/${caregiverId}/password-reset`,
      { method: "POST", body: {} },
    );
    expect(issued.status).toBe(200);
    const issuedBody = (await issued.json()) as {
      url: string;
      expiresAt: string;
    };
    expect(issuedBody.url).toContain(`${ORIGIN}/reset-password?code=`);
    const code = new URL(issuedBody.url).searchParams.get("code");
    expect(code).toBeTruthy();

    const completed = await request("/api/auth/reset-password", {
      method: "POST",
      authenticated: false,
      body: { code, password: "new-password" },
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({
      user: {
        id: caregiverId,
        email: "maya@example.com",
        displayName: "Maya",
        isAdmin: false,
      },
    });
    expect(completed.headers.get("set-cookie")).toContain("bo_sid=");
    expect(findSession(db, caregiverSid)).toBeNull();
    const passwordRow = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(caregiverId) as { password_hash: string };
    expect(await verifyPassword(passwordRow.password_hash, "new-password")).toBe(
      true,
    );

    const replay = await request("/api/auth/reset-password", {
      method: "POST",
      authenticated: false,
      body: { code, password: "another-password" },
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_reset" });
  });

  it("validates reset targets and reset-password bodies", async () => {
    expect(
      (
        await request("/api/caregivers/not-an-id/password-reset", {
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/caregivers/999/password-reset", {
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(404);
    const malformed = await request("/api/auth/reset-password", {
      method: "POST",
      authenticated: false,
      body: [],
    });
    expect(malformed.status).toBe(400);
    const weak = await request("/api/auth/reset-password", {
      method: "POST",
      authenticated: false,
      body: { code: "not-a-real-token", password: "short" },
    });
    expect(weak.status).toBe(400);
    expect(await weak.json()).toEqual({ error: "weak_password" });
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

  it("allows only one concurrent brief generation", async () => {
    const yesterday = [
      ["feed", "2026-08-12T12:00:00.000Z", "Feed 1", { volume_oz: 3 }],
      ["sleep", "2026-08-12T14:00:00.000Z", "Nap", { mins: 45 }],
      ["diaper", "2026-08-12T16:00:00.000Z", "Wet", { kind: "wet" }],
    ] as const;
    for (const [type, at, title, meta] of yesterday) {
      repository.insertRecord({ type, at, title, detail: "", meta } as never);
    }

    let release!: (value: string) => void;
    generateBriefText.mockImplementationOnce(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    const firstPromise = request("/api/brief/today", {
      method: "POST",
      body: {
        localDate: "2026-08-13",
        tzOffsetMin: 240,
        timeZone: "America/Toronto",
      },
    });
    await vi.waitFor(() => expect(generateBriefText).toHaveBeenCalledTimes(1));
    const second = await request("/api/brief/today", {
      method: "POST",
      body: {
        localDate: "2026-08-13",
        tzOffsetMin: 240,
        timeZone: "America/Toronto",
      },
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ message: null, reason: "in_progress" });

    release("One generated brief.");
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(generateBriefText).toHaveBeenCalledTimes(1);
    expect(
      repository.listMessages().filter((message) => message.kind === "brief"),
    ).toHaveLength(1);

    const completed = await request("/api/brief/today", {
      method: "POST",
      body: { localDate: "2026-08-13", tzOffsetMin: 240 },
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      reason: "already_generated",
      message: { text: "One generated brief." },
    });
    expect(generateBriefText).toHaveBeenCalledTimes(1);
  });

  it("releases a failed brief claim so the same date can retry immediately", async () => {
    const yesterday = [
      ["feed", "2026-08-12T12:00:00.000Z", "Feed 1", { volume_oz: 3 }],
      ["sleep", "2026-08-12T14:00:00.000Z", "Nap", { mins: 45 }],
      ["diaper", "2026-08-12T16:00:00.000Z", "Wet", { kind: "wet" }],
    ] as const;
    for (const [type, at, title, meta] of yesterday) {
      repository.insertRecord({ type, at, title, detail: "", meta } as never);
    }

    generateBriefText.mockRejectedValueOnce(new Error("temporary failure"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await request("/api/brief/today", {
      method: "POST",
      body: { localDate: "2026-08-13", tzOffsetMin: 240 },
    });
    errorSpy.mockRestore();
    expect(failed.status).toBe(500);

    generateBriefText.mockResolvedValueOnce("Recovered brief.");
    const retried = await request("/api/brief/today", {
      method: "POST",
      body: { localDate: "2026-08-13", tzOffsetMin: 240 },
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      message: { text: "Recovered brief." },
    });
    expect(generateBriefText).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale brief worker after its claim is replaced", async () => {
    const yesterday = [
      ["feed", "2026-08-12T12:00:00.000Z", "Feed 1", { volume_oz: 3 }],
      ["sleep", "2026-08-12T14:00:00.000Z", "Nap", { mins: 45 }],
      ["diaper", "2026-08-12T16:00:00.000Z", "Wet", { kind: "wet" }],
    ] as const;
    for (const [type, at, title, meta] of yesterday) {
      repository.insertRecord({ type, at, title, detail: "", meta } as never);
    }

    let release!: (value: string) => void;
    generateBriefText.mockImplementationOnce(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    const staleRequest = request("/api/brief/today", {
      method: "POST",
      body: { localDate: "2026-08-13", tzOffsetMin: 240 },
    });
    await vi.waitFor(() => expect(generateBriefText).toHaveBeenCalledTimes(1));
    db.prepare(
      "UPDATE brief_requests SET claimed_at = ? WHERE local_date = ?",
    ).run("2026-08-13T15:05:01.000Z", "2026-08-13");

    release("Stale brief.");
    const response = await staleRequest;
    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      message: null,
      reason: "in_progress",
    });
    expect(
      repository.listMessages().filter((message) => message.kind === "brief"),
    ).toHaveLength(0);
  });
});
