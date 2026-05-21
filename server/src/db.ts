import Database from "better-sqlite3";
import type DatabaseT from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  ChatMessage,
  MessageKind,
  RoutineRecord,
  RecordMeta,
  RecordType,
} from "./types.js";

export function applyAuthSchema(d: DatabaseT.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
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

db.exec(`
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

applyAuthSchema(db);

// Migrate pre-existing databases whose `messages` table predates the `kind` column.
const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as {
  name: string;
}[];
if (!messageColumns.some((col) => col.name === "kind")) {
  db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");
}

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
  type: r.type as RecordType,
  at: r.at,
  title: r.title,
  detail: r.detail,
  meta: JSON.parse(r.meta) as RecordMeta,
  user:
    r.user_id !== null && r.user_display_name !== null
      ? { id: r.user_id, displayName: r.user_display_name }
      : null,
});

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

export const getRecord = (id: number): RoutineRecord | null => {
  const row = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(id) as
    | RecordRow
    | undefined;
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
  return r;
};

export const deleteRecord = (id: number): void => {
  db.prepare("DELETE FROM records WHERE id=?").run(id);
};

export const listMessages = (): ChatMessage[] =>
  (
    db.prepare("SELECT * FROM messages ORDER BY at ASC").all() as MessageRow[]
  ).map(rowToMessage);

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
    | { v: string }
    | undefined;
  return row?.v ?? null;
};

export const setKv = (k: string, v: string): void => {
  db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").run(k, v);
};

export const isSeeded = (): boolean => {
  const row = db.prepare("SELECT v FROM kv WHERE k=?").get("seeded") as
    | { v: string }
    | undefined;
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
}

export const countUsers = (): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
