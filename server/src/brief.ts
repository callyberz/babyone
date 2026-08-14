import type Anthropic from "@anthropic-ai/sdk";
import {
  aggregateFixedDays,
  aggregateRecords,
  type DayAggregate,
  type RoutineRecord,
} from "@babyone/contracts";
import {
  anthropicClient as client,
  LLM_CONFIG,
  markLlmDegraded,
  markLlmHealthy,
} from "./llm/config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BriefWindow {
  yesterdayStart: string;
  yesterdayEnd: string;
  baselineStart: string;
  todayEnd: string;
}

function zonedParts(at: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zonedMidnight(localDate: string, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const targetWallMs = Date.UTC(year, month - 1, day);
  let candidateMs = targetWallMs;
  // Offset can change around the target (DST). Re-evaluate until the instant's
  // wall-clock representation matches the requested local midnight.
  for (let i = 0; i < 4; i += 1) {
    const part = zonedParts(new Date(candidateMs), timeZone);
    const representedWallMs = Date.UTC(
      part.year!,
      part.month! - 1,
      part.day!,
      part.hour!,
      part.minute!,
      part.second!,
    );
    const next = candidateMs + (targetWallMs - representedWallMs);
    if (next === candidateMs) return new Date(next);
    candidateMs = next;
  }
  return new Date(candidateMs);
}

function addCalendarDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

// localDate is the client's *today* (YYYY-MM-DD) in its local timezone.
// tzOffsetMin is Date#getTimezoneOffset() — minutes WEST of UTC (e.g. 240 for UTC-4).
export function computeBriefWindow(
  localDate: string,
  tzOffsetMin: number,
  timeZone?: string | null,
): BriefWindow {
  if (timeZone) {
    const yesterdayDate = addCalendarDays(localDate, -1);
    const baselineDate = addCalendarDays(localDate, -8);
    const tomorrowDate = addCalendarDays(localDate, 1);
    return {
      yesterdayStart: zonedMidnight(yesterdayDate, timeZone).toISOString(),
      yesterdayEnd: zonedMidnight(localDate, timeZone).toISOString(),
      baselineStart: zonedMidnight(baselineDate, timeZone).toISOString(),
      todayEnd: zonedMidnight(tomorrowDate, timeZone).toISOString(),
    };
  }
  const [y, m, d] = localDate.split("-").map(Number);
  // Local midnight of `localDate`, expressed as a UTC instant.
  const todayStartMs = Date.UTC(y, m - 1, d) + tzOffsetMin * 60 * 1000;
  const yesterdayStart = new Date(todayStartMs - DAY_MS);
  const yesterdayEnd = new Date(todayStartMs);
  const baselineStart = new Date(todayStartMs - 8 * DAY_MS);
  const todayEnd = new Date(todayStartMs + DAY_MS);
  return {
    yesterdayStart: yesterdayStart.toISOString(),
    yesterdayEnd: yesterdayEnd.toISOString(),
    baselineStart: baselineStart.toISOString(),
    todayEnd: todayEnd.toISOString(),
  };
}

export type DayAgg = DayAggregate;
export const aggregateDay = aggregateRecords;

export function aggregateBaseline(
  records: RoutineRecord[],
  windowStart: Date,
  windowEnd: Date,
): { days: DayAgg[]; avg: DayAgg } {
  const { days, average } = aggregateFixedDays(records, windowStart, windowEnd);
  return { days, avg: average };
}

const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function fallbackText(y: DayAgg, avg: DayAgg): string {
  return (
    `Yesterday: ${y.feeds} feeds (${round(y.ozTotal)}oz), ` +
    `${round(y.sleepMins / 60)}h sleep, ${y.diapers} diapers. ` +
    `7-day average: ${round(avg.feeds)} feeds, ${round(avg.sleepMins / 60)}h sleep, ` +
    `${round(avg.diapers)} diapers.`
  );
}

const SYSTEM = `You are BabyOne, a warm casual friend helping a new parent. Write a 2-4 sentence morning brief comparing yesterday to a 7-day average. Mention 1-2 concrete numbers and one gentle observation. No bullets, no markdown, no clinical tone, no medical advice. Plain text only.`;

export async function generateBriefText(
  yesterday: DayAgg,
  baselineAvg: DayAgg,
): Promise<string> {
  if (!client) return fallbackText(yesterday, baselineAvg);

  const payload = {
    yesterday: {
      feeds: yesterday.feeds,
      ozTotal: round(yesterday.ozTotal),
      sleepHours: round(yesterday.sleepMins / 60),
      longestSleepHours: round(yesterday.longestSleepMins / 60),
      diapers: yesterday.diapers,
      diaperWet: yesterday.diaperWet,
      diaperDirty: yesterday.diaperDirty,
      playMins: yesterday.playMins,
      other: yesterday.other,
    },
    baseline7dAvg: {
      feeds: round(baselineAvg.feeds),
      ozTotal: round(baselineAvg.ozTotal),
      sleepHours: round(baselineAvg.sleepMins / 60),
      diapers: round(baselineAvg.diapers),
      playMins: round(baselineAvg.playMins),
    },
  };

  try {
    const res = await client.messages.create({
      model: LLM_CONFIG.model,
      max_tokens: LLM_CONFIG.briefMaxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    markLlmHealthy();
    return text || fallbackText(yesterday, baselineAvg);
  } catch (err) {
    markLlmDegraded("brief_request_failed");
    return fallbackText(yesterday, baselineAvg);
  }
}
