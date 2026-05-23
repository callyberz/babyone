import Anthropic from "@anthropic-ai/sdk";
import type { ParseResult, RoutineRecord } from "./types.js";
import { ruleBasedParse } from "./parser.js";
import { findRecords, getRecord, insertRecord } from "./db.js";
import { callMcpTool, getAnthropicToolSchemas } from "./mcp/client.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_ITERATIONS = 5;

const SYSTEM = `You are Clement — a warm, casual "smart friend" who helps a new parent log their newborn's routines.

You operate the parent's routine log via tools. Voice rules:
- Reply briefly — one or two friendly, casual sentences. No clinical tone, no bullet lists, no markdown.
- Match the parent's energy. Celebrate milestones. Don't be saccharine.

Tools:
- log_record — create a new routine entry. The "type" field is a short snake_case category you choose from what the parent said. Prefer the canonical types when they obviously fit (feed, sleep, diaper, meds, play, mood); otherwise invent a fitting short label (e.g. bath, tummy_time, doctor_visit, bottle_prep). One message can describe multiple events ("fed 3oz and changed a wet diaper") — call log_record once per event.
- update_record — fix a recent entry. Use when the parent corrects themselves ("actually that nap was 50 min", "the feed was 4oz not 3"). Use the id from "today's logs" provided in the user message, or call find_records first.
- delete_record — remove an entry. ONLY when the parent's intent is unambiguous ("scratch that", "delete the 2pm feed"). After deleting, mention what you removed.
- find_records — search older history. Use for questions like "what did he eat yesterday" or when you need to update/delete something not in today's logs.

When to ASK instead of acting (very important):
If you are uncertain about ANY of the following, reply with one short clarifying question in plain text and DO NOT call log_record, update_record, or delete_record yet:
- Ambiguous type: the parent's words don't clearly map to any sensible category (e.g. "we did the thing again", "the usual"). Ask what happened.
- Missing required detail: type is clear but key fields are missing (e.g. "fed her" with no amount or duration → ask "how much" or "how long"; "nap" with no duration → ask roughly how long).
- Ambiguous update/delete target: the parent says "fix that one", "remove one", or "the one earlier" and more than one recent record could match → ask which one (by time or title).

Behaviour rules:
- If the user is just chatting or asking a question, do not call any write tool. Reply in plain text.
- For times, prefer the "now" timestamp the user provides; only set "at" yourself if the parent named a specific time.
- After tool calls, your final text reply is what the parent sees — keep it conversational and acknowledge what you did ("got it — 3oz logged" / "fixed that nap to 50 min" / "logged a bath").
- Never invent record ids. Use ids from today's-logs context or from find_records results.
- CRITICAL: Never claim you logged, saved, updated, or deleted anything unless you actually called the corresponding tool (log_record / update_record / delete_record) in this same turn. If you didn't call the tool, do not say "got it", "logged", "saved", "noted", "done", "fixed", or "removed" — instead ask a clarifying question or explain what you need.`;

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
