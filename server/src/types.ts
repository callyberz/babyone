export type RecordType = string;

export const KNOWN_RECORD_TYPES = [
  "feed",
  "sleep",
  "diaper",
  "meds",
  "play",
  "mood",
] as const;

export type {
  Baby,
  ChatMessage,
  ParseResult,
  RecordMeta,
  RoutineRecord,
} from "@babyone/shared";

export function normaliseRecordType(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
