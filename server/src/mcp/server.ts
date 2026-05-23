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

const TOOLS: Tool[] = [
  {
    name: "log_record",
    description:
      "Create a new routine entry for the baby. Call once per event — if the parent describes multiple things, call this multiple times.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Short snake_case category derived from what the parent said. Prefer canonical types (feed, sleep, diaper, meds, play, mood) when they clearly fit. Otherwise invent a new short snake_case label (e.g. 'bath', 'tummy_time', 'doctor_visit'). Never call this tool with an empty or vague type — ask the parent in text instead.",
        },
        at: {
          type: "string",
          description:
            "ISO-8601 timestamp the event happened. Omit to use now.",
        },
        title: {
          type: "string",
          description:
            'Short human title (e.g. "Bottle — 3 oz", "Nap — 45 min", "Diaper — wet").',
        },
        detail: {
          type: "string",
          description: "Optional short detail string.",
        },
        meta: {
          type: "object",
          description:
            "Type-specific metadata. feed: { volume_oz?, side? (left|right|both|bottle), mins? }. sleep: { mins, where? (bassinet|crib|stroller|contact) }. diaper: { kind: wet|dirty|both }. play: { mins }. mood: { kind: happy|fussy }. meds: { name?, dose? }. For novel types, include whatever fields make sense.",
          additionalProperties: true,
        },
      },
      required: ["type", "title"],
    },
  },
  {
    name: "update_record",
    description:
      "Modify an existing routine entry. Provide id and any subset of fields to change. meta is shallow-merged with the existing meta.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Record id to update." },
        type: {
          type: "string",
          description:
            "Short snake_case category. Same rules as log_record.type.",
        },
        at: { type: "string", description: "ISO-8601 timestamp." },
        title: { type: "string" },
        detail: { type: "string" },
        meta: { type: "object", additionalProperties: true },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_record",
    description:
      "Permanently remove a routine entry. Only call when the parent's intent is unambiguous; otherwise ask them to clarify in your reply text.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Record id to delete." },
      },
      required: ["id"],
    },
  },
  {
    name: "find_records",
    description:
      "Search recent routine entries. Use to look up older logs not already in the today's-logs context, or to answer questions about history.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO-8601 lower bound (inclusive).",
        },
        until: {
          type: "string",
          description: "ISO-8601 upper bound (inclusive).",
        },
        type: {
          type: "string",
          description: "Filter by exact stored type string.",
        },
        limit: { type: "number", description: "Max rows (default 20)." },
      },
    },
  },
];

interface LogRecordInput {
  type: string;
  at?: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
  // Injected by the chat backend from the session — NOT part of the public
  // tool schema, so the LLM can't supply it. Attribution for records.user_id.
  _loggerId?: number | null;
}

interface UpdateRecordInput {
  id: number;
  type?: string;
  at?: string;
  title?: string;
  detail?: string;
  meta?: Record<string, unknown>;
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
    at: input.at ?? new Date().toISOString(),
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
    at: input.at ?? existing.at,
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
