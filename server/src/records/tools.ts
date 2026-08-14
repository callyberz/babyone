import {
  RECORD_TYPES,
  normaliseRecordType,
  validateRecordDraft,
  type RecordMeta,
  type RecordType,
  type RoutineRecord,
} from "@babyone/contracts";
import {
  deleteRecord,
  findDuplicateRecord,
  findRecords,
  getRecord,
  insertRecord,
  updateRecord,
} from "../db.js";

export interface RecordToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const RECORD_TOOLS: RecordToolDefinition[] = [
  {
    name: "log_record",
    description:
      "Create one routine entry. Call once per event. Use other with meta.category when no canonical type fits.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...RECORD_TYPES] },
        at: {
          type: "string",
          description:
            "Parent-local ISO-8601 wall-clock time without a timezone suffix. Omit to use now.",
        },
        title: { type: "string" },
        detail: { type: "string" },
        meta: {
          type: "object",
          description:
            "feed: volume_oz/side/mins; sleep: mins/where; diaper: kind; play: mins; mood: kind; meds: name/dose; other: category (required).",
          additionalProperties: true,
        },
      },
      required: ["type", "title", "meta"],
    },
  },
  {
    name: "update_record",
    description:
      "Modify an existing routine entry. Provide id and fields to change; meta is shallow-merged.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        type: { type: "string", enum: [...RECORD_TYPES] },
        at: { type: "string" },
        title: { type: "string" },
        detail: { type: "string" },
        meta: { type: "object", additionalProperties: true },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_record",
    description: "Permanently remove a routine entry when intent is unambiguous.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "find_records",
    description: "Search routine history.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string" },
        until: { type: "string" },
        type: { type: "string", enum: [...RECORD_TYPES] },
        limit: { type: "number" },
      },
    },
  },
];

export interface LogRecordInput {
  type: string;
  at?: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface UpdateRecordInput {
  id: number;
  type?: string;
  at?: string;
  title?: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface DeleteRecordInput {
  id: number;
}

export interface FindRecordsInput {
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
}

export interface RecordToolContext {
  loggerId?: number | null;
  tzOffsetMin?: number | null;
  now?: Date;
}

export interface RecordToolResult {
  result: unknown;
  isError?: boolean;
}

export interface RecordToolOutcome {
  text: string;
  isError: boolean;
}

const HAS_TZ_MARKER = /Z$|[+-]\d{2}:\d{2}$/;
const MAX_QUERY_TIMESTAMP_LENGTH = 64;

function normalizeQueryTimestamp(
  value: unknown,
): string | undefined | false {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_QUERY_TIMESTAMP_LENGTH ||
    !HAS_TZ_MARKER.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  return new Date(value).toISOString();
}

export function resolveLocalTimestamp(
  at: string | undefined,
  tzOffsetMin: number | null | undefined,
): string | undefined {
  if (!at) return undefined;
  if (HAS_TZ_MARKER.test(at) || typeof tzOffsetMin !== "number") return at;
  const localAsUtcMs = Date.parse(`${at}Z`);
  if (Number.isNaN(localAsUtcMs)) return at;
  return new Date(localAsUtcMs + tzOffsetMin * 60_000).toISOString();
}

export function handleLogRecord(
  input: LogRecordInput,
  context: RecordToolContext = {},
): RecordToolResult {
  const type = normaliseRecordType(input.type);
  if (!type) {
    return {
      result: `Refusing to log: type must be one of ${RECORD_TYPES.join(", ")}.`,
      isError: true,
    };
  }
  const at =
    resolveLocalTimestamp(input.at, context.tzOffsetMin) ??
    (context.now ?? new Date()).toISOString();
  const validation = validateRecordDraft({
    type,
    at,
    title: input.title,
    detail: input.detail ?? "",
    meta: input.meta ?? {},
  });
  if (!validation.ok) {
    return { result: validation.issues.join("; "), isError: true };
  }

  const existing = findDuplicateRecord({
    type,
    at,
    title: validation.value.title,
  });
  if (existing) {
    return {
      result: {
        id: existing.id,
        type: existing.type,
        at: existing.at,
        title: existing.title,
        deduped: true,
      },
    };
  }
  const record = insertRecord({
    ...validation.value,
    userId: context.loggerId ?? null,
  });
  return {
    result: {
      id: record.id,
      type: record.type,
      at: record.at,
      title: record.title,
    },
  };
}

export function handleUpdateRecord(
  input: UpdateRecordInput,
  context: RecordToolContext = {},
): RecordToolResult {
  if (!Number.isInteger(input.id)) {
    return { result: "Record id must be an integer.", isError: true };
  }
  const existing = getRecord(input.id);
  if (!existing) {
    return { result: `No record with id ${input.id}.`, isError: true };
  }
  const type =
    input.type === undefined ? existing.type : normaliseRecordType(input.type);
  if (!type) {
    return {
      result: `Refusing to update: type must be one of ${RECORD_TYPES.join(", ")}.`,
      isError: true,
    };
  }
  const validation = validateRecordDraft({
    type,
    at:
      resolveLocalTimestamp(input.at, context.tzOffsetMin) ?? existing.at,
    title: input.title ?? existing.title,
    detail: input.detail ?? existing.detail,
    meta: input.meta
      ? { ...(existing.meta as RecordMeta), ...input.meta }
      : existing.meta,
  });
  if (!validation.ok) {
    return { result: validation.issues.join("; "), isError: true };
  }
  const saved = updateRecord({
    ...validation.value,
    id: existing.id,
    user: existing.user,
  } as RoutineRecord);
  return { result: { id: saved.id, title: saved.title, at: saved.at } };
}

export function handleDeleteRecord(input: DeleteRecordInput): RecordToolResult {
  if (!Number.isInteger(input.id)) {
    return { result: "Record id must be an integer.", isError: true };
  }
  const existing = getRecord(input.id);
  if (!existing) {
    return { result: `No record with id ${input.id}.`, isError: true };
  }
  deleteRecord(input.id);
  return { result: `Deleted #${input.id} (${existing.title}).` };
}

export function handleFindRecords(input: FindRecordsInput): RecordToolResult {
  const type = input.type ? normaliseRecordType(input.type) : undefined;
  if (input.type && !type) {
    return { result: "Unknown record type filter.", isError: true };
  }
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return {
      result: "Limit must be a whole number between 1 and 100.",
      isError: true,
    };
  }
  const since = normalizeQueryTimestamp(input.since);
  const until = normalizeQueryTimestamp(input.until);
  if (since === false || until === false) {
    return {
      result: "Since and until must be ISO-8601 timestamps with timezone offsets.",
      isError: true,
    };
  }
  const rows = findRecords({
    since,
    until,
    type: type || undefined,
    limit,
  });
  return {
    result: rows.map((record) => ({
      id: record.id,
      type: record.type,
      at: record.at,
      title: record.title,
      user: record.user,
    })),
  };
}

export function executeRecordTool(
  name: string,
  args: Record<string, unknown>,
  context: RecordToolContext = {},
): RecordToolResult {
  try {
    switch (name) {
      case "log_record":
        return handleLogRecord(args as unknown as LogRecordInput, context);
      case "update_record":
        return handleUpdateRecord(args as unknown as UpdateRecordInput, context);
      case "delete_record":
        return handleDeleteRecord(args as unknown as DeleteRecordInput);
      case "find_records":
        return handleFindRecords(args as unknown as FindRecordsInput);
      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
  } catch (error) {
    return { result: `Tool error: ${(error as Error).message}`, isError: true };
  }
}

export function callRecordTool(
  name: string,
  args: Record<string, unknown>,
  context: RecordToolContext = {},
): RecordToolOutcome {
  const handled = executeRecordTool(name, args, context);
  return {
    text:
      typeof handled.result === "string"
        ? handled.result
        : JSON.stringify(handled.result),
    isError: Boolean(handled.isError),
  };
}
