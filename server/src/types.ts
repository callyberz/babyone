export type RecordType = string;

export const KNOWN_RECORD_TYPES = [
  "feed",
  "sleep",
  "diaper",
  "meds",
  "play",
  "mood",
] as const;

export interface RecordMeta {
  volume_oz?: number;
  side?: "left" | "right" | "both" | "bottle";
  mins?: number;
  where?: string | null;
  kind?: "wet" | "dirty" | "both" | "fussy" | "happy";
  name?: string;
  dose?: string;
  [k: string]: unknown;
}

export interface RoutineRecord {
  id: number;
  type: RecordType;
  at: string; // ISO
  title: string;
  detail: string;
  meta: RecordMeta;
}

export type MessageKind = "chat" | "brief";

export interface ChatMessage {
  id: number;
  from: "user" | "bot";
  at: string;
  text: string;
  recordIds: number[];
  kind?: MessageKind;
}

export interface ParseResult {
  replyText: string;
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}

export function normaliseRecordType(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
