import Anthropic from "@anthropic-ai/sdk";
import type { ParseResult, RecordType, RoutineRecord } from "./types.js";
import { ruleBasedParse } from "./parser.js";
import {
  deleteRecord,
  findRecords,
  getRecord,
  insertRecord,
  updateRecord,
} from "./db.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_ITERATIONS = 5;

const SYSTEM = `You are Clement — a warm, casual "smart friend" who helps a new parent log their newborn's routines.

You operate the parent's routine log via tools. Voice rules:
- Reply briefly — one or two friendly, casual sentences. No clinical tone, no bullet lists, no markdown.
- Match the parent's energy. Celebrate milestones. Don't be saccharine.

Tools:
- log_record — create a new routine entry. Use this when the parent describes something that happened ("fed 3oz at 2pm", "wet diaper", "nap 45 min"). One message can describe multiple events ("fed 3oz and changed a wet diaper") — call log_record once per event.
- update_record — fix a recent entry. Use when the parent corrects themselves ("actually that nap was 50 min", "the feed was 4oz not 3"). Use the id from "today's logs" provided in the user message, or call find_records first.
- delete_record — remove an entry. ONLY when the parent's intent is unambiguous ("scratch that", "delete the 2pm feed", "ignore the last log"). If they say something vague like "fix that" or "remove one", ASK which one in your reply text instead of calling the tool. After deleting, mention what you removed.
- find_records — search older history. Use for questions like "what did he eat yesterday" or when you need to update/delete something not in today's logs.

Behavior rules:
- If the user is just chatting or asking a question, do not call any write tool. Reply in plain text.
- For times, prefer the "now" timestamp the user provides; only set "at" yourself if the parent named a specific time.
- After tool calls, your final text reply is what the parent sees — keep it conversational and acknowledge what you did ("got it — 3oz logged" / "fixed that nap to 50 min").
- Never invent record ids. Use ids from today's-logs context or from find_records results.`;

interface ToolDef {
  schema: Anthropic.Messages.Tool;
  handler: (
    input: unknown,
    ctx: ToolCtx,
  ) => Promise<{ result: unknown; isError?: boolean }>;
}

interface ToolCtx {
  now: Date;
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}

const RECORD_TYPES: RecordType[] = [
  "feed",
  "sleep",
  "diaper",
  "meds",
  "play",
  "mood",
];

const tools: Record<string, ToolDef> = {
  log_record: {
    schema: {
      name: "log_record",
      description:
        "Create a new routine entry for the baby. Call once per event — if the parent describes multiple things, call this multiple times.",
      input_schema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: RECORD_TYPES,
            description: "The kind of routine entry.",
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
              "Type-specific metadata. feed: { volume_oz?, side? (left|right|both|bottle), mins? }. sleep: { mins, where? (bassinet|crib|stroller|contact) }. diaper: { kind: wet|dirty|both }. play: { mins }. mood: { kind: happy|fussy }. meds: { name?, dose? }.",
            additionalProperties: true,
          },
        },
        required: ["type", "title"],
      },
    },
    handler: async (input, ctx) => {
      const i = input as {
        type: RecordType;
        at?: string;
        title: string;
        detail?: string;
        meta?: Record<string, unknown>;
      };
      const rec = insertRecord({
        type: i.type,
        at: i.at ?? ctx.now.toISOString(),
        title: i.title,
        detail: i.detail ?? "",
        meta: i.meta ?? {},
      });
      ctx.created.push(rec);
      return {
        result: { id: rec.id, type: rec.type, at: rec.at, title: rec.title },
      };
    },
  },

  update_record: {
    schema: {
      name: "update_record",
      description:
        "Modify an existing routine entry. Provide id and any subset of fields to change. meta is shallow-merged with the existing meta.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Record id to update." },
          type: { type: "string", enum: RECORD_TYPES },
          at: { type: "string", description: "ISO-8601 timestamp." },
          title: { type: "string" },
          detail: { type: "string" },
          meta: { type: "object", additionalProperties: true },
        },
        required: ["id"],
      },
    },
    handler: async (input, ctx) => {
      const i = input as {
        id: number;
        type?: RecordType;
        at?: string;
        title?: string;
        detail?: string;
        meta?: Record<string, unknown>;
      };
      const existing = getRecord(i.id);
      if (!existing)
        return {
          result: `No record with id ${i.id}.`,
          isError: true,
        };
      const merged: RoutineRecord = {
        id: existing.id,
        type: i.type ?? existing.type,
        at: i.at ?? existing.at,
        title: i.title ?? existing.title,
        detail: i.detail ?? existing.detail,
        meta: i.meta ? { ...existing.meta, ...i.meta } : existing.meta,
      };
      const saved = updateRecord(merged);
      ctx.updated.push(saved);
      return { result: { id: saved.id, title: saved.title, at: saved.at } };
    },
  },

  delete_record: {
    schema: {
      name: "delete_record",
      description:
        "Permanently remove a routine entry. Only call when the parent's intent is unambiguous; otherwise ask them to clarify in your reply text.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Record id to delete." },
        },
        required: ["id"],
      },
    },
    handler: async (input, ctx) => {
      const i = input as { id: number };
      const existing = getRecord(i.id);
      if (!existing)
        return { result: `No record with id ${i.id}.`, isError: true };
      deleteRecord(i.id);
      ctx.deleted.push(i.id);
      return {
        result: `Deleted #${i.id} (${existing.title}).`,
      };
    },
  },

  find_records: {
    schema: {
      name: "find_records",
      description:
        "Search recent routine entries. Use to look up older logs not already in the today's-logs context, or to answer questions about history.",
      input_schema: {
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
          type: { type: "string", enum: RECORD_TYPES },
          limit: { type: "number", description: "Max rows (default 20)." },
        },
      },
    },
    handler: async (input) => {
      const i = input as {
        since?: string;
        until?: string;
        type?: RecordType;
        limit?: number;
      };
      const rows = findRecords({
        since: i.since,
        until: i.until,
        type: i.type,
        limit: i.limit,
      });
      return {
        result: rows.map((r) => ({
          id: r.id,
          type: r.type,
          at: r.at,
          title: r.title,
        })),
      };
    },
  },
};

const TOOL_SCHEMAS: Anthropic.Messages.Tool[] = Object.values(tools).map(
  (t) => t.schema,
);

function startOfToday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function summariseTodaysRecords(now: Date): string {
  const since = startOfToday(now).toISOString();
  const todays = findRecords({ since, limit: 50 });
  if (todays.length === 0) return "today's logs: (none yet)";
  const lines = todays
    .slice()
    .reverse()
    .map((r) => {
      const t = new Date(r.at);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return `  #${r.id} ${r.type} ${hh}:${mm} — ${r.title}`;
    });
  return ["today's logs (ids you can update/delete):", ...lines].join("\n");
}

async function fallbackPath(text: string, now: Date): Promise<ParseResult> {
  const out = ruleBasedParse(text, now);
  if (!out.draft)
    return { replyText: out.replyText, created: [], updated: [], deleted: [] };
  const rec = insertRecord(out.draft);
  return {
    replyText: out.replyText,
    created: [rec],
    updated: [],
    deleted: [],
  };
}

export async function llmParse(
  text: string,
  now = new Date(),
): Promise<ParseResult> {
  if (!client) return fallbackPath(text, now);

  const ctx: ToolCtx = { now, created: [], updated: [], deleted: [] };

  const firstUserContent = `now: ${now.toISOString()}\n${summariseTodaysRecords(now)}\nparent said: ${text}`;
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: firstUserContent },
  ];

  let finalText = "";
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: TOOL_SCHEMAS,
        messages,
      });

      const textParts = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (textParts) finalText = textParts;

      if (res.stop_reason !== "tool_use") break;

      const toolUses = res.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) break;

      messages.push({
        role: "assistant",
        content: res.content as Array<
          | Anthropic.Messages.TextBlockParam
          | Anthropic.Messages.ToolUseBlockParam
        >,
      });

      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const tool = tools[tu.name];
        if (!tool) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Unknown tool: ${tu.name}`,
            is_error: true,
          });
          continue;
        }
        try {
          const { result, isError } = await tool.handler(tu.input, ctx);
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content:
              typeof result === "string" ? result : JSON.stringify(result),
            is_error: isError,
          });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Tool error: ${(err as Error).message}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    if (!finalText) {
      const summary: string[] = [];
      if (ctx.created.length) summary.push(`logged ${ctx.created.length}`);
      if (ctx.updated.length) summary.push(`updated ${ctx.updated.length}`);
      if (ctx.deleted.length) summary.push(`deleted ${ctx.deleted.length}`);
      finalText = summary.length
        ? `Got it — ${summary.join(", ")}.`
        : "Got it.";
    }

    return {
      replyText: finalText,
      created: ctx.created,
      updated: ctx.updated,
      deleted: ctx.deleted,
    };
  } catch (err) {
    console.warn(
      "[llm] tool-use loop failed, falling back to rule-based:",
      (err as Error).message,
    );
    return fallbackPath(text, now);
  }
}

export const llmEnabled = !!client;
