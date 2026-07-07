import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  deleteRecord,
  findRecords,
  getRecord,
  insertRecord,
  updateRecord,
} from "../db.js";
import {
  normaliseRecordType,
  type RecordType,
  type RoutineRecord,
} from "../types.js";
import { TOOLS } from "./tools.js";

interface LogRecordInput {
  type: string;
  at?: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
  // Injected by the chat backend from the session — NOT part of the public
  // tool schema, so the LLM can't supply it. Attribution for records.user_id.
  _loggerId?: number | null;
  // Injected by the chat backend — the parent's Date#getTimezoneOffset() at
  // send time. Lets us treat `at` as the parent's local wall-clock time
  // instead of trusting the model to convert to UTC itself.
  _tzOffsetMin?: number;
}

interface UpdateRecordInput {
  id: number;
  type?: string;
  at?: string;
  title?: string;
  detail?: string;
  meta?: Record<string, unknown>;
  _tzOffsetMin?: number;
}

interface DeleteRecordInput {
  id: number;
}

interface FindRecordsInput {
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
}

type ToolHandlerResult = { result: unknown; isError?: boolean };

function asJsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

// The model reports `at` as the parent's local wall-clock time
// ("2026-07-06T14:35:00", no offset) — it's a text-parsing task the model is
// good at, not arithmetic it's prone to botch. We do the UTC conversion here,
// deterministically, the same way brief.ts turns a local date into a UTC
// window: localAsUtcMs + tzOffsetMin*60000.
const HAS_TZ_MARKER = /Z$|[+-]\d{2}:\d{2}$/;

function resolveAt(
  at: string | undefined,
  tzOffsetMin: number | undefined,
): string | undefined {
  if (!at) return undefined;
  if (HAS_TZ_MARKER.test(at) || typeof tzOffsetMin !== "number") return at;
  const localAsUtcMs = Date.parse(`${at}Z`);
  if (Number.isNaN(localAsUtcMs)) return at;
  return new Date(localAsUtcMs + tzOffsetMin * 60_000).toISOString();
}

function handleLogRecord(input: LogRecordInput): ToolHandlerResult {
  const type = normaliseRecordType(input.type);
  if (!type) {
    return {
      result:
        "Refusing to log: empty or invalid type. Ask the parent to clarify what was logged.",
      isError: true,
    };
  }
  if (!input.title || typeof input.title !== "string") {
    return {
      result: "Refusing to log: missing title.",
      isError: true,
    };
  }
  const rec = insertRecord({
    type,
    at: resolveAt(input.at, input._tzOffsetMin) ?? new Date().toISOString(),
    title: input.title,
    detail: input.detail ?? "",
    meta: input.meta ?? {},
    userId: input._loggerId ?? null,
  });
  return {
    result: { id: rec.id, type: rec.type, at: rec.at, title: rec.title },
  };
}

function handleUpdateRecord(input: UpdateRecordInput): ToolHandlerResult {
  const existing = getRecord(input.id);
  if (!existing) {
    return { result: `No record with id ${input.id}.`, isError: true };
  }
  let nextType: RecordType = existing.type;
  if (input.type !== undefined) {
    const normalised = normaliseRecordType(input.type);
    if (!normalised) {
      return {
        result: "Refusing to update: empty or invalid type.",
        isError: true,
      };
    }
    nextType = normalised;
  }
  const merged: RoutineRecord = {
    id: existing.id,
    type: nextType,
    at: resolveAt(input.at, input._tzOffsetMin) ?? existing.at,
    title: input.title ?? existing.title,
    detail: input.detail ?? existing.detail,
    meta: input.meta ? { ...existing.meta, ...input.meta } : existing.meta,
  };
  const saved = updateRecord(merged);
  return { result: { id: saved.id, title: saved.title, at: saved.at } };
}

function handleDeleteRecord(input: DeleteRecordInput): ToolHandlerResult {
  const existing = getRecord(input.id);
  if (!existing) {
    return { result: `No record with id ${input.id}.`, isError: true };
  }
  deleteRecord(input.id);
  return { result: `Deleted #${input.id} (${existing.title}).` };
}

function handleFindRecords(input: FindRecordsInput): ToolHandlerResult {
  const rows = findRecords({
    since: input.since,
    until: input.until,
    type: input.type ? normaliseRecordType(input.type) : undefined,
    limit: input.limit,
  });
  return {
    result: rows.map((r) => ({
      id: r.id,
      type: r.type,
      at: r.at,
      title: r.title,
    })),
  };
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: "babyone-routines", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    let handled: ToolHandlerResult;
    try {
      switch (name) {
        case "log_record":
          handled = handleLogRecord((args ?? {}) as unknown as LogRecordInput);
          break;
        case "update_record":
          handled = handleUpdateRecord(
            (args ?? {}) as unknown as UpdateRecordInput,
          );
          break;
        case "delete_record":
          handled = handleDeleteRecord(
            (args ?? {}) as unknown as DeleteRecordInput,
          );
          break;
        case "find_records":
          handled = handleFindRecords(
            (args ?? {}) as unknown as FindRecordsInput,
          );
          break;
        default:
          handled = { result: `Unknown tool: ${name}`, isError: true };
      }
    } catch (err) {
      handled = {
        result: `Tool error: ${(err as Error).message}`,
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: asJsonText(handled.result) }],
      isError: handled.isError,
    };
  });

  return server;
}

const isDirectRun = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const here = new URL(import.meta.url).pathname;
    return (
      entry === here ||
      entry.endsWith("/mcp/server.js") ||
      entry.endsWith("/mcp/server.ts")
    );
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("[mcp-server] failed to start:", err);
    process.exit(1);
  });
}
