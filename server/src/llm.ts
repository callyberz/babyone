import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { ParseResult, RoutineRecord } from "./types.js";
import { ruleBasedParse } from "./parser.js";
import { findRecords, getRecord, insertRecord } from "./db.js";
import { callMcpTool, getAnthropicToolSchemas } from "./mcp/client.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_ITERATIONS = 5;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM = readFileSync(
  resolve(__dirname, "./prompts/caretaker-system.md"),
  "utf8",
).trim();

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

async function fallbackPath(
  text: string,
  now: Date,
  loggerId: number | null,
): Promise<ParseResult> {
  const out = ruleBasedParse(text, now);
  if (!out.draft)
    return { replyText: out.replyText, created: [], updated: [], deleted: [] };
  const rec = insertRecord({ ...out.draft, userId: loggerId });
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
    if (id != null) {
      const rec = getRecord(id);
      if (rec) ctx.created.push(rec);
    }
  } else if (name === "update_record") {
    const id = extractIdFromText(outcome.text);
    if (id != null) {
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
): Promise<ParseResult> {
  if (!client) return fallbackPath(text, now, loggerId);

  const ctx: ToolRunContext = { now, created: [], updated: [], deleted: [] };

  let toolSchemas: Anthropic.Messages.Tool[];
  try {
    const raw = await getAnthropicToolSchemas();

    console.log("raw", raw);
    toolSchemas = raw.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })) as Anthropic.Messages.Tool[];
  } catch (err) {
    console.warn(
      "[llm] could not load MCP tool schemas, falling back to rule-based:",
      (err as Error).message,
    );
    return fallbackPath(text, now, loggerId);
  }

  const firstUserContent = `now: ${now.toISOString()}\n${summariseTodaysRecords(now)}\nparent said: ${text}`;

  console.log({ firstUserContent });

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
        tools: toolSchemas,
        messages,
      });

      const textParts = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (textParts) finalText = textParts;

      console.log(
        "[llm] iter",
        i,
        "stop_reason:",
        res.stop_reason,
        "text:",
        textParts.slice(0, 80),
      );
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
        // Injected server-side, not part of the schema Claude sees, so the
        // model can't spoof attribution. The MCP server reads this field to
        // stamp records.user_id.
        if (tu.name === "log_record" && loggerId != null) {
          args._loggerId = loggerId;
        }
        console.log("[llm] tool_use:", tu.name, JSON.stringify(args));
        try {
          const outcome = await callMcpTool(tu.name, args);
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
    return fallbackPath(text, now, loggerId);
  }
}

export const llmEnabled = !!client;
