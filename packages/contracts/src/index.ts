export const RECORD_TYPES = [
  "feed",
  "sleep",
  "diaper",
  "meds",
  "play",
  "mood",
  "other",
] as const;

export const KNOWN_RECORD_TYPES = RECORD_TYPES;
export type RecordType = (typeof RECORD_TYPES)[number];
export type KnownRecordType = Exclude<RecordType, "other">;

export interface FeedMeta {
  volume_oz?: number;
  side?: "left" | "right" | "both" | "bottle";
  mins?: number;
  [key: string]: unknown;
}

export interface SleepMeta {
  mins?: number;
  where?: string | null;
  [key: string]: unknown;
}

export interface DiaperMeta {
  kind?: "wet" | "dirty" | "both";
  [key: string]: unknown;
}

export interface MedsMeta {
  name?: string;
  dose?: string;
  [key: string]: unknown;
}

export interface PlayMeta {
  mins?: number;
  [key: string]: unknown;
}

export interface MoodMeta {
  kind?: "fussy" | "happy";
  [key: string]: unknown;
}

export interface OtherMeta {
  category: string;
  [key: string]: unknown;
}

// Kept as a common view for display code. RoutineRecord remains discriminated
// by `type`, while this view lets generic UI inspect optional metadata safely.
export interface RecordMeta {
  volume_oz?: number;
  side?: "left" | "right" | "both" | "bottle";
  mins?: number;
  where?: string | null;
  kind?: "wet" | "dirty" | "both" | "fussy" | "happy";
  name?: string;
  dose?: string;
  category?: string;
  [key: string]: unknown;
}

interface RecordBase<T extends RecordType, M extends object> {
  id: number;
  type: T;
  at: string;
  title: string;
  detail: string;
  meta: M;
  user?: { id: number; displayName: string } | null;
}

export type FeedRecord = RecordBase<"feed", FeedMeta>;
export type SleepRecord = RecordBase<"sleep", SleepMeta>;
export type DiaperRecord = RecordBase<"diaper", DiaperMeta>;
export type MedsRecord = RecordBase<"meds", MedsMeta>;
export type PlayRecord = RecordBase<"play", PlayMeta>;
export type MoodRecord = RecordBase<"mood", MoodMeta>;
export type OtherRecord = RecordBase<"other", OtherMeta>;

export type RoutineRecord =
  | FeedRecord
  | SleepRecord
  | DiaperRecord
  | MedsRecord
  | PlayRecord
  | MoodRecord
  | OtherRecord;

export type RoutineRecordDraft = Omit<RoutineRecord, "id" | "user">;

export type MessageKind = "chat" | "brief";

export interface ChatMessage {
  id: number;
  from: "user" | "bot";
  at: string;
  text: string;
  recordIds: number[];
  kind?: MessageKind;
}

export type UserRole = "administrator" | "caregiver";

export interface User {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface Baby {
  name: string;
  birthdate: string;
  weightValue: number | null;
  weightUnit: "lb" | "kg";
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  issues: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validateBaby(
  input: unknown,
  today = new Date().toISOString().slice(0, 10),
): ValidationResult<Baby> {
  if (!isObject(input)) {
    return { ok: false, issues: ["profile must be an object"] };
  }

  const issues: string[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) issues.push("name must be a non-empty string");
  if (name.length > 60) issues.push("name must be 60 characters or fewer");

  const birthdate = input.birthdate;
  if (
    typeof birthdate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)
  ) {
    issues.push("birthdate must use YYYY-MM-DD");
  } else {
    const parsed = new Date(`${birthdate}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== birthdate
    ) {
      issues.push("birthdate must be a valid date");
    } else if (birthdate > today) {
      issues.push("birthdate cannot be in the future");
    }
  }

  const weightValue = input.weightValue;
  if (
    weightValue !== null &&
    (typeof weightValue !== "number" ||
      !Number.isFinite(weightValue) ||
      weightValue <= 0 ||
      weightValue >= 1000)
  ) {
    issues.push("weightValue must be empty or a number greater than 0");
  }
  if (input.weightUnit !== "lb" && input.weightUnit !== "kg") {
    issues.push("weightUnit must be lb or kg");
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      name,
      birthdate: birthdate as string,
      weightValue: weightValue as number | null,
      weightUnit: input.weightUnit as "lb" | "kg",
    },
  };
}

const TYPE_SET = new Set<string>(RECORD_TYPES);
const SIDE_SET = new Set(["left", "right", "both", "bottle"]);
const DIAPER_KIND_SET = new Set(["wet", "dirty", "both"]);
const MOOD_KIND_SET = new Set(["fussy", "happy"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function optionalNonNegativeNumber(
  meta: Record<string, unknown>,
  key: string,
  issues: string[],
): void {
  const value = meta[key];
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isFinite(value) || value < 0)
  ) {
    issues.push(`meta.${key} must be a non-negative number`);
  }
}

function optionalString(
  meta: Record<string, unknown>,
  key: string,
  issues: string[],
  nullable = false,
): void {
  const value = meta[key];
  if (
    value !== undefined &&
    !(typeof value === "string" || (nullable && value === null))
  ) {
    issues.push(`meta.${key} must be ${nullable ? "a string or null" : "a string"}`);
  }
}

export function validateRecordDraft(
  input: unknown,
): ValidationResult<RoutineRecordDraft> {
  if (!isObject(input)) return { ok: false, issues: ["record must be an object"] };

  const issues: string[] = [];
  const type = input.type;
  if (typeof type !== "string" || !TYPE_SET.has(type)) {
    issues.push(`type must be one of: ${RECORD_TYPES.join(", ")}`);
  }
  let canonicalAt = "";
  if (
    typeof input.at !== "string" ||
    input.at.length === 0 ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.at) ||
    Number.isNaN(Date.parse(input.at))
  ) {
    issues.push("at must be a valid ISO-8601 timestamp with a timezone offset");
  } else {
    // SQLite compares our timestamps as TEXT, so every accepted representation
    // must be normalized before it reaches persistence. Mixed offsets otherwise
    // sort lexicographically rather than chronologically.
    canonicalAt = new Date(input.at).toISOString();
  }
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    issues.push("title must be a non-empty string");
  }
  if (input.detail !== undefined && typeof input.detail !== "string") {
    issues.push("detail must be a string");
  }
  if (!isObject(input.meta)) issues.push("meta must be an object");

  if (typeof type === "string" && TYPE_SET.has(type) && isObject(input.meta)) {
    const meta = input.meta;
    switch (type as RecordType) {
      case "feed":
        optionalNonNegativeNumber(meta, "volume_oz", issues);
        optionalNonNegativeNumber(meta, "mins", issues);
        if (meta.side !== undefined && !SIDE_SET.has(String(meta.side))) {
          issues.push("meta.side must be left, right, both, or bottle");
        }
        break;
      case "sleep":
      case "play":
        optionalNonNegativeNumber(meta, "mins", issues);
        if (type === "sleep") optionalString(meta, "where", issues, true);
        break;
      case "diaper":
        if (
          meta.kind !== undefined &&
          !DIAPER_KIND_SET.has(String(meta.kind))
        ) {
          issues.push("meta.kind must be wet, dirty, or both");
        }
        break;
      case "mood":
        if (meta.kind !== undefined && !MOOD_KIND_SET.has(String(meta.kind))) {
          issues.push("meta.kind must be fussy or happy");
        }
        break;
      case "meds":
        optionalString(meta, "name", issues);
        optionalString(meta, "dose", issues);
        break;
      case "other":
        if (
          typeof meta.category !== "string" ||
          meta.category.trim().length === 0
        ) {
          issues.push("meta.category must be a non-empty string for other records");
        }
        break;
    }
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      type: type as RecordType,
      at: canonicalAt,
      title: (input.title as string).trim(),
      detail: (input.detail as string | undefined) ?? "",
      meta: input.meta as RecordMeta,
    } as RoutineRecordDraft,
  };
}

export function normaliseRecordType(input: unknown): RecordType | "" {
  if (typeof input !== "string") return "";
  const value = input.trim().toLowerCase();
  return TYPE_SET.has(value) ? (value as RecordType) : "";
}

export interface DayAggregate {
  totalRecords: number;
  feeds: number;
  ozTotal: number;
  sleepMins: number;
  sleepSessions: number;
  longestSleepMins: number;
  diapers: number;
  diaperWet: number;
  diaperDirty: number;
  playMins: number;
  other: Record<string, number>;
}

export const emptyAggregate = (): DayAggregate => ({
  totalRecords: 0,
  feeds: 0,
  ozTotal: 0,
  sleepMins: 0,
  sleepSessions: 0,
  longestSleepMins: 0,
  diapers: 0,
  diaperWet: 0,
  diaperDirty: 0,
  playMins: 0,
  other: {},
});

export function aggregateRecords(records: RoutineRecord[]): DayAggregate {
  const aggregate = emptyAggregate();
  aggregate.totalRecords = records.length;
  for (const record of records) {
    switch (record.type) {
      case "feed":
        aggregate.feeds += 1;
        aggregate.ozTotal += record.meta.volume_oz ?? 0;
        break;
      case "sleep": {
        const mins = record.meta.mins ?? 0;
        aggregate.sleepMins += mins;
        aggregate.sleepSessions += 1;
        aggregate.longestSleepMins = Math.max(aggregate.longestSleepMins, mins);
        break;
      }
      case "diaper":
        aggregate.diapers += 1;
        if (record.meta.kind === "wet" || record.meta.kind === "both") {
          aggregate.diaperWet += 1;
        }
        if (record.meta.kind === "dirty" || record.meta.kind === "both") {
          aggregate.diaperDirty += 1;
        }
        break;
      case "play":
        aggregate.playMins += record.meta.mins ?? 0;
        break;
      case "other": {
        const category = record.meta.category;
        aggregate.other[category] = (aggregate.other[category] ?? 0) + 1;
        break;
      }
      case "meds":
      case "mood":
        break;
    }
  }
  return aggregate;
}

export interface AggregateBucket extends DayAggregate {
  start: Date;
  label: string;
}

export function aggregateLocalDays(
  records: RoutineRecord[],
  days: number,
  now = new Date(),
): AggregateBucket[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const buckets: AggregateBucket[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const start = new Date(today);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const aggregate = aggregateRecords(
      records.filter((record) => {
        const at = new Date(record.at);
        return at >= start && at < end;
      }),
    );
    buckets.push({
      ...aggregate,
      start,
      label: start.toLocaleDateString([], { weekday: "short" }),
    });
  }
  return buckets;
}

export function aggregateFixedDays(
  records: RoutineRecord[],
  windowStart: Date,
  windowEnd: Date,
): { days: DayAggregate[]; average: DayAggregate } {
  const dayMs = 24 * 60 * 60 * 1000;
  const startMs = windowStart.getTime();
  const dayCount = Math.max(
    1,
    Math.round((windowEnd.getTime() - startMs) / dayMs),
  );
  const groups: RoutineRecord[][] = Array.from({ length: dayCount }, () => []);
  for (const record of records) {
    const index = Math.floor((new Date(record.at).getTime() - startMs) / dayMs);
    if (index >= 0 && index < dayCount) groups[index]!.push(record);
  }
  const days = groups.map(aggregateRecords);
  const average = emptyAggregate();
  for (const day of days) {
    average.totalRecords += day.totalRecords;
    average.feeds += day.feeds;
    average.ozTotal += day.ozTotal;
    average.sleepMins += day.sleepMins;
    average.sleepSessions += day.sleepSessions;
    average.longestSleepMins += day.longestSleepMins;
    average.diapers += day.diapers;
    average.diaperWet += day.diaperWet;
    average.diaperDirty += day.diaperDirty;
    average.playMins += day.playMins;
    for (const [category, count] of Object.entries(day.other)) {
      average.other[category] = (average.other[category] ?? 0) + count;
    }
  }
  const divisor = days.length;
  for (const key of [
    "totalRecords",
    "feeds",
    "ozTotal",
    "sleepMins",
    "sleepSessions",
    "longestSleepMins",
    "diapers",
    "diaperWet",
    "diaperDirty",
    "playMins",
  ] as const) {
    average[key] /= divisor;
  }
  for (const category of Object.keys(average.other)) {
    average.other[category]! /= divisor;
  }
  return { days, average };
}
