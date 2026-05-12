import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  ChatMessage,
  RoutineRecord,
  RecordMeta,
  RecordType,
} from "./types.js";

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
    record_ids  TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at ASC);

  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
`);

interface RecordRow {
  id: number;
  type: string;
  at: string;
  title: string;
  detail: string;
  meta: string;
}

interface MessageRow {
  id: number;
  sender: "user" | "bot";
  at: string;
  text: string;
  record_ids: string;
}

const rowToRecord = (r: RecordRow): RoutineRecord => ({
  id: r.id,
  type: r.type as RecordType,
  at: r.at,
  title: r.title,
  detail: r.detail,
  meta: JSON.parse(r.meta) as RecordMeta,
});

const rowToMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  from: r.sender,
  at: r.at,
  text: r.text,
  recordIds: JSON.parse(r.record_ids) as number[],
});

export const listRecords = (): RoutineRecord[] =>
  (
    db.prepare("SELECT * FROM records ORDER BY at DESC").all() as RecordRow[]
  ).map(rowToRecord);

export const findRecords = (opts: {
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
}): RoutineRecord[] => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.since) {
    where.push("at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    where.push("at <= ?");
    params.push(opts.until);
  }
  if (opts.type) {
    where.push("type = ?");
    params.push(opts.type);
  }
  const sql =
    "SELECT * FROM records" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY at DESC LIMIT ?";
  params.push(opts.limit ?? 20);
  return (db.prepare(sql).all(...params) as RecordRow[]).map(rowToRecord);
};

export const getRecord = (id: number): RoutineRecord | null => {
  const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id) as
    | RecordRow
    | undefined;
  return row ? rowToRecord(row) : null;
};

export const insertRecord = (r: Omit<RoutineRecord, "id">): RoutineRecord => {
  const info = db
    .prepare(
      "INSERT INTO records (type, at, title, detail, meta) VALUES (?, ?, ?, ?, ?)",
    )
    .run(r.type, r.at, r.title, r.detail ?? "", JSON.stringify(r.meta ?? {}));
  return { ...r, id: Number(info.lastInsertRowid) };
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
  const info = db
    .prepare(
      "INSERT INTO messages (sender, at, text, record_ids) VALUES (?, ?, ?, ?)",
    )
    .run(m.from, m.at, m.text, JSON.stringify(m.recordIds ?? []));
  return { ...m, id: Number(info.lastInsertRowid) };
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
