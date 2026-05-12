export type RecordType = "feed" | "sleep" | "diaper" | "meds" | "play" | "mood";

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

export interface ChatMessage {
  id: number;
  from: "user" | "bot";
  at: string;
  text: string;
  recordIds: number[];
}

export interface ParseResult {
  replyText: string;
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}
