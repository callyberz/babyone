import Database from "better-sqlite3";
import type DatabaseT from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { KNOWN_RECORD_TYPES } from "./types.js";
import type {
  Baby,
  ChatMessage,
  HouseholdSync,
  MessageKind,
  RoutineRecord,
  RecordMeta,
  RecordType,
} from "./types.js";
import { validateBaby } from "./types.js";

export function applyAuthSchema(d: DatabaseT.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'caregiver' CHECK (role IN ('administrator','caregiver')),
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS invites (
      code        TEXT PRIMARY KEY,
      created_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      consumed_by INTEGER REFERENCES users(id),
      consumed_at TEXT
    );
  `);

  const userCols = d.prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  if (!userCols.some((column) => column.name === "role")) {
    d.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'caregiver'",
    );
    // The first account was the legacy environment-derived administrator.
    d.prepare(
      "UPDATE users SET role = 'administrator' WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)",
    ).run();
  }

  const cols = d.prepare("PRAGMA table_info(records)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "user_id")) {
    d.exec(
      "ALTER TABLE records ADD COLUMN user_id INTEGER REFERENCES users(id)",
    );
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.BABYONE_DB ?? path.resolve(__dirname, "../data.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

export function applyCoreSchema(d: DatabaseT.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      type   TEXT NOT NULL,
      at     TEXT NOT NULL,
      title  TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      meta   TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_records_at ON records(at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sender      TEXT NOT NULL CHECK (sender IN ('user','bot')),
      at          TEXT NOT NULL,
      text        TEXT NOT NULL,
      record_ids  TEXT NOT NULL DEFAULT '[]',
      kind        TEXT NOT NULL DEFAULT 'chat'
    );
    CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at ASC);

    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);

  applyAuthSchema(d);
  d.exec(`
    CREATE TABLE IF NOT EXISTS chat_requests (
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id      TEXT NOT NULL,
      text            TEXT NOT NULL,
      user_message_id INTEGER NOT NULL REFERENCES messages(id),
      response_json   TEXT,
      created_at      TEXT NOT NULL,
      PRIMARY KEY (user_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_requests_created
      ON chat_requests(created_at);

    CREATE TABLE IF NOT EXISTS brief_requests (
      local_date  TEXT PRIMARY KEY,
      state       TEXT NOT NULL CHECK (state IN ('pending','completed','skipped')),
      claimed_at  TEXT NOT NULL,
      completed_at TEXT,
      message_id  INTEGER REFERENCES messages(id),
      reason      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_brief_requests_claimed
      ON brief_requests(claimed_at);
  `);
  // Preserve the legacy one-brief-per-date marker during the migration so a
  // deploy does not regenerate a brief that was completed before claims existed.
  d.exec(`
    INSERT OR IGNORE INTO brief_requests
      (local_date, state, claimed_at, completed_at, reason)
    SELECT v, 'skipped', datetime('now'), datetime('now'), 'already_generated'
    FROM kv
    WHERE k = 'brief.lastDate' AND v GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
  `);
  const messageColumns = d.prepare("PRAGMA table_info(messages)").all() as {
    name: string;
  }[];
  if (!messageColumns.some((column) => column.name === "kind")) {
    d.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS sync_changes (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      entity     TEXT NOT NULL CHECK (entity IN ('record','message')),
      entity_id  INTEGER NOT NULL,
      operation  TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
      changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_entity
      ON sync_changes(entity, entity_id, seq DESC);

    CREATE TRIGGER IF NOT EXISTS records_sync_insert
    AFTER INSERT ON records BEGIN
      INSERT INTO sync_changes (entity, entity_id, operation)
      VALUES ('record', NEW.id, 'upsert');
    END;
    CREATE TRIGGER IF NOT EXISTS records_sync_update
    AFTER UPDATE ON records BEGIN
      INSERT INTO sync_changes (entity, entity_id, operation)
      VALUES ('record', NEW.id, 'upsert');
    END;
    CREATE TRIGGER IF NOT EXISTS records_sync_delete
    AFTER DELETE ON records BEGIN
      INSERT INTO sync_changes (entity, entity_id, operation)
      VALUES ('record', OLD.id, 'delete');
    END;
    CREATE TRIGGER IF NOT EXISTS messages_sync_insert
    AFTER INSERT ON messages BEGIN
      INSERT INTO sync_changes (entity, entity_id, operation)
      VALUES ('message', NEW.id, 'upsert');
    END;
    CREATE TRIGGER IF NOT EXISTS messages_sync_update
    AFTER UPDATE ON messages BEGIN
      INSERT INTO sync_changes (entity, entity_id, operation)
      VALUES ('message', NEW.id, 'upsert');
    END;
    CREATE TRIGGER IF NOT EXISTS messages_sync_delete
    AFTER DELETE ON messages BEGIN
      INSERT INTO sync_changes (entity, entity_id, operation)
      VALUES ('message', OLD.id, 'delete');
    END;
  `);
}

export function defaultBaby(now = new Date()): Baby {
  const birthdate = new Date(now);
  birthdate.setUTCDate(birthdate.getUTCDate() - 2);
  return {
    name: "Clement",
    birthdate: birthdate.toISOString().slice(0, 10),
    weightValue: null,
    weightUnit: "lb",
  };
}

export function getBaby(d: DatabaseT.Database = db): Baby {
  const row = d.prepare("SELECT v FROM kv WHERE k = 'baby'").get() as
    | { v: string }
    | undefined;
  if (!row) throw new Error("baby profile is not initialized");
  const parsed: unknown = JSON.parse(row.v);
  const validation = validateBaby(parsed);
  if (!validation.ok) {
    throw new Error(`invalid baby profile: ${validation.issues.join(", ")}`);
  }
  return validation.value;
}

export function setBaby(baby: Baby, d: DatabaseT.Database = db): Baby {
  d.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('baby', ?)").run(
    JSON.stringify(baby),
  );
  return baby;
}

export function ensureBaby(d: DatabaseT.Database = db, now = new Date()): Baby {
  const existing = d.prepare("SELECT 1 FROM kv WHERE k = 'baby'").get();
  if (!existing) setBaby(defaultBaby(now), d);
  return getBaby(d);
}

applyCoreSchema(db);
ensureBaby(db);

interface RecordRow {
  id: number;
  type: string;
  at: string;
  title: string;
  detail: string;
  meta: string;
  user_id: number | null;
  user_display_name: string | null;
}

interface MessageRow {
  id: number;
  sender: "user" | "bot";
  at: string;
  text: string;
  record_ids: string;
  kind: MessageKind;
}

const rowToRecord = (r: RecordRow): RoutineRecord => ({
  id: r.id,
  type: (KNOWN_RECORD_TYPES as readonly string[]).includes(r.type)
    ? (r.type as RecordType)
    : "other",
  at: r.at,
  title: r.title,
  detail: r.detail,
  meta: (() => {
    const meta = JSON.parse(r.meta) as RecordMeta;
    return (KNOWN_RECORD_TYPES as readonly string[]).includes(r.type)
      ? meta
      : { ...meta, category: r.type };
  })(),
  user:
    r.user_id !== null && r.user_display_name !== null
      ? { id: r.user_id, displayName: r.user_display_name }
      : null,
}) as RoutineRecord;

const BASE_SELECT =
  "SELECT r.*, u.display_name AS user_display_name FROM records r " +
  "LEFT JOIN users u ON u.id = r.user_id";

const rowToMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  from: r.sender,
  at: r.at,
  text: r.text,
  recordIds: JSON.parse(r.record_ids) as number[],
  kind: r.kind,
});

export const listRecords = (d: DatabaseT.Database = db): RoutineRecord[] =>
  (d.prepare(`${BASE_SELECT} ORDER BY r.at DESC`).all() as RecordRow[]).map(
    rowToRecord,
  );

export const findRecords = (opts: {
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
}): RoutineRecord[] => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.since) {
    where.push("r.at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    where.push("r.at <= ?");
    params.push(opts.until);
  }
  if (opts.type) {
    where.push("r.type = ?");
    params.push(opts.type);
  }
  const sql =
    `${BASE_SELECT}` +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY r.at DESC LIMIT ?";
  params.push(opts.limit ?? 20);
  return (db.prepare(sql).all(...params) as RecordRow[]).map(rowToRecord);
};

// Guards against the LLM re-logging an event it already logged in an earlier
// turn (the flattened-history failure mode). Returns an existing record with
// the same type + title whose timestamp is within `windowMs` of `at`, or null.
// Re-logs reproduce the exact same type/title/at, so this matches them
// deterministically; the window also catches same-turn "now" double-logs whose
// timestamps differ by seconds.
export const findDuplicateRecord = (opts: {
  type: string;
  at: string;
  title: string;
  windowMs?: number;
}): RoutineRecord | null => {
  const window = opts.windowMs ?? 120_000;
  const atMs = Date.parse(opts.at);
  if (Number.isNaN(atMs)) return null;
  const rows = db
    .prepare(
      `${BASE_SELECT} WHERE r.type = ? AND r.title = ? ORDER BY r.at DESC LIMIT 50`,
    )
    .all(opts.type, opts.title) as RecordRow[];
  for (const row of rows) {
    const existingMs = Date.parse(row.at);
    if (!Number.isNaN(existingMs) && Math.abs(existingMs - atMs) <= window) {
      return rowToRecord(row);
    }
  }
  return null;
};

export const getRecord = (id: number): RoutineRecord | null => {
  const row = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(id) as
    RecordRow | undefined;
  return row ? rowToRecord(row) : null;
};

export const insertRecord = (
  r: Omit<RoutineRecord, "id"> & { userId?: number | null },
): RoutineRecord => {
  const info = db
    .prepare(
      "INSERT INTO records (type, at, title, detail, meta, user_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      r.type,
      r.at,
      r.title,
      r.detail ?? "",
      JSON.stringify(r.meta ?? {}),
      r.userId ?? null,
    );
  // Re-read through the JOIN so the return value has `user` populated and no
  // stray DB-layer `userId` leaked from the input spread.
  return getRecord(Number(info.lastInsertRowid))!;
};

export const updateRecord = (r: RoutineRecord): RoutineRecord => {
  db.prepare(
    "UPDATE records SET type=?, at=?, title=?, detail=?, meta=? WHERE id=?",
  ).run(
    r.type,
    r.at,
    r.title,
    r.detail ?? "",
    JSON.stringify(r.meta ?? {}),
    r.id,
  );
  return getRecord(r.id)!;
};

export const deleteRecord = (id: number): void => {
  db.prepare("DELETE FROM records WHERE id=?").run(id);
};

export const bulkDeleteRecords = (ids: number[]): number[] => {
  const stmt = db.prepare("DELETE FROM records WHERE id=?");
  const tx = db.transaction((rowIds: number[]) =>
    rowIds.filter((id) => stmt.run(id).changes > 0),
  );
  return tx(ids);
};

export const listMessages = (d: DatabaseT.Database = db): ChatMessage[] =>
  (
    d.prepare("SELECT * FROM messages ORDER BY at ASC, id ASC").all() as MessageRow[]
  ).map(rowToMessage);

interface SyncChangeRow {
  seq: number;
  entity: "record" | "message";
  entity_id: number;
  operation: "upsert" | "delete";
}

const currentSyncCursor = (d: DatabaseT.Database): number =>
  (
    d.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM sync_changes").get() as {
      cursor: number;
    }
  ).cursor;

const SYNC_RETENTION = 50_000;

function pruneSyncChanges(d: DatabaseT.Database): void {
  d.prepare(
    `DELETE FROM sync_changes
     WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - ? FROM sync_changes)`,
  ).run(SYNC_RETENTION);
}

export function getSyncSnapshot(
  d: DatabaseT.Database = db,
): HouseholdSync {
  return d.transaction(() => {
    pruneSyncChanges(d);
    return {
      full: true,
      cursor: currentSyncCursor(d),
      hasMore: false,
      records: listRecords(d),
      messages: listMessages(d),
      deletedRecordIds: [],
      deletedMessageIds: [],
    };
  })();
}

function recordsByIds(ids: number[], d: DatabaseT.Database): RoutineRecord[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return (
    d
      .prepare(`${BASE_SELECT} WHERE r.id IN (${placeholders})`)
      .all(...ids) as RecordRow[]
  ).map(rowToRecord);
}

function messagesByIds(ids: number[], d: DatabaseT.Database): ChatMessage[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return (
    d.prepare(`SELECT * FROM messages WHERE id IN (${placeholders})`).all(
      ...ids,
    ) as MessageRow[]
  ).map(rowToMessage);
}

export function getSyncDelta(
  after: number,
  limit = 500,
  d: DatabaseT.Database = db,
): HouseholdSync {
  const pageSize = Math.max(1, Math.min(500, Math.trunc(limit)));
  pruneSyncChanges(d);
  const oldest = d.prepare("SELECT MIN(seq) AS seq FROM sync_changes").get() as {
    seq: number | null;
  };
  if (oldest.seq !== null && after < oldest.seq - 1) {
    return getSyncSnapshot(d);
  }
  const changes = d
    .prepare(
      `SELECT seq, entity, entity_id, operation FROM sync_changes
       WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(after, pageSize + 1) as SyncChangeRow[];
  const page = changes.slice(0, pageSize);
  const cursor = page.at(-1)?.seq ?? after;
  const latest = new Map<string, SyncChangeRow>();
  for (const change of page) {
    latest.set(`${change.entity}:${change.entity_id}`, change);
  }

  const recordUpserts = [...latest.values()]
    .filter(
      (change) =>
        change.entity === "record" && change.operation === "upsert",
    )
    .map((change) => change.entity_id);
  const messageUpserts = [...latest.values()]
    .filter(
      (change) =>
        change.entity === "message" && change.operation === "upsert",
    )
    .map((change) => change.entity_id);
  const records = recordsByIds(recordUpserts, d);
  const messages = messagesByIds(messageUpserts, d);
  const foundRecordIds = new Set(records.map((record) => record.id));
  const foundMessageIds = new Set(messages.map((message) => message.id));

  return {
    full: false,
    cursor,
    hasMore: changes.length > pageSize,
    records,
    messages,
    deletedRecordIds: [...latest.values()]
      .filter(
        (change) =>
          change.entity === "record" &&
          (change.operation === "delete" ||
            !foundRecordIds.has(change.entity_id)),
      )
      .map((change) => change.entity_id),
    deletedMessageIds: [...latest.values()]
      .filter(
        (change) =>
          change.entity === "message" &&
          (change.operation === "delete" ||
            !foundMessageIds.has(change.entity_id)),
      )
      .map((change) => change.entity_id),
  };
}

export interface HouseholdExport {
  schemaVersion: 1;
  exportedAt: string;
  baby: Baby;
  caregivers: Array<{
    id: number;
    email: string;
    displayName: string;
    role: "administrator" | "caregiver";
    createdAt: string;
  }>;
  records: RoutineRecord[];
  messages: ChatMessage[];
}

export function exportHouseholdData(
  at = new Date(),
  d: DatabaseT.Database = db,
): HouseholdExport {
  return d.transaction(() => ({
    schemaVersion: 1 as const,
    exportedAt: at.toISOString(),
    baby: getBaby(d),
    caregivers: (
      d.prepare(
        "SELECT id, email, display_name, role, created_at FROM users ORDER BY id",
      ).all() as Array<{
        id: number;
        email: string;
        display_name: string;
        role: "administrator" | "caregiver";
        created_at: string;
      }>
    ).map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      createdAt: user.created_at,
    })),
    records: listRecords(d),
    messages: listMessages(d),
  }))();
}

// Most recent `limit` conversational messages (oldest first). Excludes daily
// brief messages so they don't pollute the chat context window handed to the
// LLM for multi-turn reference resolution.
export const listRecentChatMessages = (limit: number): ChatMessage[] =>
  (
    db
      .prepare(
        "SELECT * FROM messages WHERE kind = 'chat' ORDER BY at DESC, id DESC LIMIT ?",
      )
      .all(limit) as MessageRow[]
  )
    .map(rowToMessage)
    .reverse();

export const insertMessage = (m: Omit<ChatMessage, "id">): ChatMessage => {
  const kind: MessageKind = m.kind ?? "chat";
  const info = db
    .prepare(
      "INSERT INTO messages (sender, at, text, record_ids, kind) VALUES (?, ?, ?, ?, ?)",
    )
    .run(m.from, m.at, m.text, JSON.stringify(m.recordIds ?? []), kind);
  return { ...m, kind, id: Number(info.lastInsertRowid) };
};

export interface ChatApiResponse {
  userMsg: ChatMessage;
  botMsg: ChatMessage;
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}

export type ChatRequestClaim =
  | { state: "claimed"; userMsg: ChatMessage }
  | { state: "completed"; response: ChatApiResponse }
  | { state: "pending" }
  | { state: "conflict" };

interface ChatRequestRow {
  text: string;
  user_message_id: number;
  response_json: string | null;
}

const getMessage = (
  id: number,
  d: DatabaseT.Database = db,
): ChatMessage | null => {
  const row = d.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
    | MessageRow
    | undefined;
  return row ? rowToMessage(row) : null;
};

export function claimChatRequest(
  input: {
    userId: number;
    requestId: string;
    text: string;
    at: string;
  },
  d: DatabaseT.Database = db,
): ChatRequestClaim {
  const tx = d.transaction((): ChatRequestClaim => {
    const existing = d
      .prepare(
        "SELECT text, user_message_id, response_json FROM chat_requests WHERE user_id = ? AND request_id = ?",
      )
      .get(input.userId, input.requestId) as ChatRequestRow | undefined;
    if (existing) {
      if (existing.text !== input.text) return { state: "conflict" };
      if (existing.response_json) {
        return {
          state: "completed",
          response: JSON.parse(existing.response_json) as ChatApiResponse,
        };
      }
      return { state: "pending" };
    }

    const messageInfo = d
      .prepare(
        "INSERT INTO messages (sender, at, text, record_ids, kind) VALUES ('user', ?, ?, '[]', 'chat')",
      )
      .run(input.at, input.text);
    const userMessageId = Number(messageInfo.lastInsertRowid);
    d.prepare(
      "INSERT INTO chat_requests (user_id, request_id, text, user_message_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      input.userId,
      input.requestId,
      input.text,
      userMessageId,
      input.at,
    );
    const userMsg = getMessage(userMessageId, d);
    if (!userMsg) throw new Error("failed to create chat request message");
    return { state: "claimed", userMsg };
  });
  return tx();
}

export function completeChatRequest(
  input: {
    userId: number;
    requestId: string;
    bot: Omit<ChatMessage, "id">;
    created: RoutineRecord[];
    updated: RoutineRecord[];
    deleted: number[];
  },
  d: DatabaseT.Database = db,
): ChatApiResponse {
  const tx = d.transaction((): ChatApiResponse => {
    const request = d
      .prepare(
        "SELECT text, user_message_id, response_json FROM chat_requests WHERE user_id = ? AND request_id = ?",
      )
      .get(input.userId, input.requestId) as ChatRequestRow | undefined;
    if (!request) throw new Error("chat request is not claimed");
    if (request.response_json) {
      return JSON.parse(request.response_json) as ChatApiResponse;
    }
    const userMsg = getMessage(request.user_message_id, d);
    if (!userMsg) throw new Error("chat request user message is missing");

    const kind: MessageKind = input.bot.kind ?? "chat";
    const botInfo = d
      .prepare(
        "INSERT INTO messages (sender, at, text, record_ids, kind) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        input.bot.from,
        input.bot.at,
        input.bot.text,
        JSON.stringify(input.bot.recordIds ?? []),
        kind,
      );
    const botMsg: ChatMessage = {
      ...input.bot,
      kind,
      id: Number(botInfo.lastInsertRowid),
    };
    const response: ChatApiResponse = {
      userMsg,
      botMsg,
      created: input.created,
      updated: input.updated,
      deleted: input.deleted,
    };
    d.prepare(
      "UPDATE chat_requests SET response_json = ? WHERE user_id = ? AND request_id = ?",
    ).run(JSON.stringify(response), input.userId, input.requestId);
    return response;
  });
  return tx();
}

export type BriefRequestClaim =
  | { state: "claimed" }
  | { state: "pending" }
  | { state: "completed"; message: ChatMessage | null; reason?: string };

interface BriefRequestRow {
  state: "pending" | "completed" | "skipped";
  claimed_at: string;
  message_id: number | null;
  reason: string | null;
}

export function claimBriefRequest(
  input: { localDate: string; at: string; staleAfterMs?: number },
  d: DatabaseT.Database = db,
): BriefRequestClaim {
  const staleAfterMs = input.staleAfterMs ?? 5 * 60_000;
  const staleBefore = new Date(
    Date.parse(input.at) - staleAfterMs,
  ).toISOString();
  const tx = d.transaction((): BriefRequestClaim => {
    const existing = d
      .prepare(
        "SELECT state, claimed_at, message_id, reason FROM brief_requests WHERE local_date = ?",
      )
      .get(input.localDate) as BriefRequestRow | undefined;
    if (!existing) {
      d.prepare(
        "INSERT INTO brief_requests (local_date, state, claimed_at) VALUES (?, 'pending', ?)",
      ).run(input.localDate, input.at);
      return { state: "claimed" };
    }
    if (existing.state === "completed" || existing.state === "skipped") {
      return {
        state: "completed",
        message:
          existing.message_id === null
            ? null
            : getMessage(existing.message_id, d),
        ...(existing.reason ? { reason: existing.reason } : {}),
      };
    }
    if (existing.claimed_at >= staleBefore) return { state: "pending" };
    const reclaimed = d
      .prepare(
        `UPDATE brief_requests SET claimed_at = ?
         WHERE local_date = ? AND state = 'pending' AND claimed_at = ?`,
      )
      .run(input.at, input.localDate, existing.claimed_at);
    return reclaimed.changes === 1 ? { state: "claimed" } : { state: "pending" };
  });
  return tx.immediate();
}

export function completeBriefRequest(
  input: {
    localDate: string;
    at: string;
    text?: string;
    reason?: string;
  },
  d: DatabaseT.Database = db,
): { message: ChatMessage | null; reason?: string } {
  const tx = d.transaction(() => {
    const row = d
      .prepare(
        "SELECT state, claimed_at, message_id, reason FROM brief_requests WHERE local_date = ?",
      )
      .get(input.localDate) as BriefRequestRow | undefined;
    if (!row) throw new Error("brief request is not claimed");
    if (row.state !== "pending") {
      return {
        message: row.message_id === null ? null : getMessage(row.message_id, d),
        ...(row.reason ? { reason: row.reason } : {}),
      };
    }

    let message: ChatMessage | null = null;
    if (input.text !== undefined) {
      const info = d
        .prepare(
          "INSERT INTO messages (sender, at, text, record_ids, kind) VALUES ('bot', ?, ?, '[]', 'brief')",
        )
        .run(input.at, input.text);
      message = getMessage(Number(info.lastInsertRowid), d);
      if (!message) throw new Error("failed to create brief message");
    }
    const state = message ? "completed" : "skipped";
    d.prepare(
      `UPDATE brief_requests
       SET state = ?, completed_at = ?, message_id = ?, reason = ?
       WHERE local_date = ? AND state = 'pending'`,
    ).run(
      state,
      input.at,
      message?.id ?? null,
      input.reason ?? null,
      input.localDate,
    );
    return {
      message,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  });
  return tx.immediate();
}

// True if a brief message already exists with `at` in [startIso, endIso).
export const hasBriefInRange = (startIso: string, endIso: string): boolean => {
  const row = db
    .prepare(
      "SELECT 1 FROM messages WHERE kind = 'brief' AND at >= ? AND at < ? LIMIT 1",
    )
    .get(startIso, endIso);
  return row !== undefined;
};

export const getKv = (k: string): string | null => {
  const row = db.prepare("SELECT v FROM kv WHERE k=?").get(k) as
    { v: string } | undefined;
  return row?.v ?? null;
};

export const setKv = (k: string, v: string): void => {
  db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").run(k, v);
};

export const isSeeded = (): boolean => {
  const row = db.prepare("SELECT v FROM kv WHERE k=?").get("seeded") as
    { v: string } | undefined;
  return row?.v === "1";
};

export const markSeeded = (): void => {
  db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").run(
    "seeded",
    "1",
  );
};

export interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: "administrator" | "caregiver";
}

export const countUsers = (): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
