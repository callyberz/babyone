import Database from "better-sqlite3";
import type DatabaseT from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { KNOWN_RECORD_TYPES } from "./types.js";
import type {
  Baby,
  ChatMessage,
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
  const messageColumns = d.prepare("PRAGMA table_info(messages)").all() as {
    name: string;
  }[];
  if (!messageColumns.some((column) => column.name === "kind")) {
    d.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");
  }
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

export const listRecords = (): RoutineRecord[] =>
  (db.prepare(`${BASE_SELECT} ORDER BY r.at DESC`).all() as RecordRow[]).map(
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

export const listMessages = (): ChatMessage[] =>
  (
    db.prepare("SELECT * FROM messages ORDER BY at ASC").all() as MessageRow[]
  ).map(rowToMessage);

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
