import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import type { ParseResult, RoutineRecord } from "./types.js";
import { ruleBasedParse } from "./parser.js";
import { findRecords, getRecord } from "./db.js";
import {
  callRecordTool,
  handleLogRecord,
  RECORD_TOOLS,
} from "./records/tools.js";
import {
  anthropicClient as client,
  getLlmStatus,
  LLM_CONFIG,
  markLlmDegraded,
  markLlmHealthy,
} from "./llm/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM = readFileSync(
  resolve(__dirname, "./prompts/caretaker-system.md"),
  "utf8",
).trim();

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

// Builds the initial message array for a chat turn: prior conversation turns
// followed by the current turn. Leading assistant turns are dropped because
// the Anthropic Messages API requires the first message to have role "user".
export function buildInitialMessages(
  history: ConversationTurn[],
  firstUserContent: string,
): Anthropic.Messages.MessageParam[] {
  let start = 0;
  while (start < history.length && history[start]!.role === "assistant") {
    start += 1;
  }
  const messages: Anthropic.Messages.MessageParam[] = history
    .slice(start)
    .map((t) => ({ role: t.role, content: t.text }));
  messages.push({ role: "user", content: firstUserContent });
  return messages;
}

interface ToolRunContext {
  now: Date;
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}

function startOfToday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDayStart(now: Date, tzOffsetMin: number | null): Date {
  if (typeof tzOffsetMin !== "number" || !Number.isFinite(tzOffsetMin)) {
    return startOfToday(now);
  }
  const offsetMs = tzOffsetMin * 60_000;
  const localNow = new Date(now.getTime() - offsetMs);
  return new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate(),
    ) + offsetMs,
  );
}

function formatLocalClock(at: string, tzOffsetMin: number | null): string {
  const instant = new Date(at);
  if (typeof tzOffsetMin !== "number" || !Number.isFinite(tzOffsetMin)) {
    const hh = String(instant.getHours()).padStart(2, "0");
    const mm = String(instant.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const local = new Date(instant.getTime() - tzOffsetMin * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function summariseTodaysRecords(
  now: Date,
  tzOffsetMin: number | null = null,
): string {
  const since = localDayStart(now, tzOffsetMin).toISOString();
  const todays = findRecords({ since, limit: 50 });
  if (todays.length === 0) return "today's logs: (none yet)";
  const lines = todays
    .slice()
    .reverse()
    .map((r) => {
      const clock = formatLocalClock(r.at, tzOffsetMin);
      return `  #${r.id} ${r.type} ${clock} — ${r.title}`;
    });
  return ["today's logs (ids you can update/delete):", ...lines].join("\n");
}

async function fallbackPath(
  text: string,
  now: Date,
  loggerId: number | null,
  tzOffsetMin: number | null,
): Promise<ParseResult> {
  const out = ruleBasedParse(text, now, tzOffsetMin);
  if (!out.draft)
    return { replyText: out.replyText, created: [], updated: [], deleted: [] };
  const handled = handleLogRecord(out.draft, { loggerId, now });
  if (handled.isError) {
    return {
      replyText: "I couldn't safely create that record. Please add a little more detail.",
      created: [],
      updated: [],
      deleted: [],
    };
  }
  const id =
    handled.result &&
    typeof handled.result === "object" &&
    "id" in handled.result &&
    typeof handled.result.id === "number"
      ? handled.result.id
      : null;
  const rec = id == null ? null : getRecord(id);
  if (!rec) {
    return {
      replyText: "I couldn't safely create that record. Please try again.",
      created: [],
      updated: [],
      deleted: [],
    };
  }
  return {
    replyText: out.replyText,
    created: [rec],
    updated: [],
    deleted: [],
  };
}

function extractIdFromText(text: string): number | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.id === "number") return parsed.id;
  } catch {
    /* not JSON */
  }
  return null;
}

function trackToolEffect(
  name: string,
  args: Record<string, unknown>,
  outcome: { text: string; isError: boolean },
  ctx: ToolRunContext,
): void {
  if (outcome.isError) return;
  if (name === "log_record") {
    const id = extractIdFromText(outcome.text);
    if (id != null && !ctx.created.some((r) => r.id === id)) {
      const rec = getRecord(id);
      if (rec) ctx.created.push(rec);
    }
  } else if (name === "update_record") {
    const id = extractIdFromText(outcome.text);
    if (id != null && !ctx.updated.some((r) => r.id === id)) {
      const rec = getRecord(id);
      if (rec) ctx.updated.push(rec);
    }
  } else if (name === "delete_record") {
    const argId = typeof args.id === "number" ? args.id : null;
    if (argId != null) ctx.deleted.push(argId);
  }
}

export async function llmParse(
  text: string,
  now = new Date(),
  loggerId: number | null = null,
  tzOffsetMin: number | null = null,
  history: ConversationTurn[] = [],
): Promise<ParseResult> {
  if (!client) return fallbackPath(text, now, loggerId, tzOffsetMin);

  const ctx: ToolRunContext = { now, created: [], updated: [], deleted: [] };

  const toolSchemas = RECORD_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  })) as Anthropic.Messages.Tool[];

  const localNowLine =
    typeof tzOffsetMin === "number" && Number.isFinite(tzOffsetMin)
      ? `local now: ${new Date(now.getTime() - tzOffsetMin * 60_000).toISOString().slice(0, 19)}\n`
      : "";

  const firstUserContent = `now: ${now.toISOString()}\n${localNowLine}${summariseTodaysRecords(now, tzOffsetMin)}\nparent said: ${text}`;

  const messages = buildInitialMessages(history, firstUserContent);

  let finalText = "";
  try {
    for (let i = 0; i < LLM_CONFIG.maxToolIterations; i++) {
      const res = await client.messages.create({
        model: LLM_CONFIG.model,
        max_tokens: LLM_CONFIG.chatMaxTokens,
        system: SYSTEM,
        tools: toolSchemas,
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
        const args = (tu.input ?? {}) as Record<string, unknown>;
        try {
          const outcome = callRecordTool(tu.name, args, {
            loggerId,
            tzOffsetMin,
            now,
          });
          trackToolEffect(tu.name, args, outcome, ctx);
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: outcome.text,
            is_error: outcome.isError,
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

    markLlmHealthy();
    return {
      replyText: finalText,
      created: ctx.created,
      updated: ctx.updated,
      deleted: ctx.deleted,
    };
  } catch (err) {
    markLlmDegraded("chat_request_failed");
    // Tool calls write synchronously as each model iteration completes. If a
    // later model request fails, reparsing the original message can repeat or
    // contradict changes that are already durable.
    if (ctx.created.length || ctx.updated.length || ctx.deleted.length) {
      const effects: string[] = [];
      if (ctx.created.length) effects.push(`logged ${ctx.created.length}`);
      if (ctx.updated.length) effects.push(`updated ${ctx.updated.length}`);
      if (ctx.deleted.length) effects.push(`deleted ${ctx.deleted.length}`);
      return {
        replyText: `I saved the changes (${effects.join(", ")}), but couldn't finish the reply.`,
        created: ctx.created,
        updated: ctx.updated,
        deleted: ctx.deleted,
      };
    }
    return fallbackPath(text, now, loggerId, tzOffsetMin);
  }
}

export const llmEnabled = !!client;
export { getLlmStatus };
