import Anthropic from "@anthropic-ai/sdk";
import type { RoutineRecord } from "./types.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BriefWindow {
  yesterdayStart: string;
  yesterdayEnd: string;
  baselineStart: string;
}

// localDate is the client's *today* (YYYY-MM-DD) in its local timezone.
// tzOffsetMin is Date#getTimezoneOffset() — minutes WEST of UTC (e.g. 240 for UTC-4).
export function computeBriefWindow(
  localDate: string,
  tzOffsetMin: number,
): BriefWindow {
  const [y, m, d] = localDate.split("-").map(Number);
  // Local midnight of `localDate`, expressed as a UTC instant.
  const todayStartMs = Date.UTC(y, m - 1, d) + tzOffsetMin * 60 * 1000;
  const yesterdayStart = new Date(todayStartMs - DAY_MS);
  const yesterdayEnd = new Date(todayStartMs);
  const baselineStart = new Date(todayStartMs - 8 * DAY_MS);
  return {
    yesterdayStart: yesterdayStart.toISOString(),
    yesterdayEnd: yesterdayEnd.toISOString(),
    baselineStart: baselineStart.toISOString(),
  };
}

export interface DayAgg {
  totalRecords: number;
  feeds: number;
  ozTotal: number;
  sleepMins: number;
  longestSleepMins: number;
  diapers: number;
  diaperWet: number;
  diaperDirty: number;
  playMins: number;
  longestFeedGapHours: number;
  other: Record<string, number>;
}

const emptyAgg = (): DayAgg => ({
  totalRecords: 0,
  feeds: 0,
  ozTotal: 0,
  sleepMins: 0,
  longestSleepMins: 0,
  diapers: 0,
  diaperWet: 0,
  diaperDirty: 0,
  playMins: 0,
  longestFeedGapHours: 0,
  other: {},
});

const CANONICAL = new Set(["feed", "sleep", "diaper", "meds", "play", "mood"]);

export function aggregateDay(records: RoutineRecord[]): DayAgg {
  const agg = emptyAgg();
  agg.totalRecords = records.length;

  const feedTimes: number[] = [];
  for (const r of records) {
    const mins = (r.meta?.mins as number) ?? 0;
    if (r.type === "feed") {
      agg.feeds++;
      agg.ozTotal += (r.meta?.volume_oz as number) ?? 0;
      feedTimes.push(new Date(r.at).getTime());
    } else if (r.type === "sleep") {
      agg.sleepMins += mins;
      agg.longestSleepMins = Math.max(agg.longestSleepMins, mins);
    } else if (r.type === "diaper") {
      agg.diapers++;
      const kind = r.meta?.kind;
      if (kind === "wet" || kind === "both") agg.diaperWet++;
      if (kind === "dirty" || kind === "both") agg.diaperDirty++;
    } else if (r.type === "play") {
      agg.playMins += mins;
    } else if (!CANONICAL.has(r.type)) {
      agg.other[r.type] = (agg.other[r.type] ?? 0) + 1;
    }
  }

  feedTimes.sort((a, b) => a - b);
  for (let i = 1; i < feedTimes.length; i++) {
    const gapHours = (feedTimes[i] - feedTimes[i - 1]) / (60 * 60 * 1000);
    agg.longestFeedGapHours = Math.max(agg.longestFeedGapHours, gapHours);
  }

  return agg;
}

export function aggregateBaseline(
  records: RoutineRecord[],
  windowStart: Date,
  windowEnd: Date,
): { days: DayAgg[]; avg: DayAgg } {
  const startMs = windowStart.getTime();
  const dayCount = Math.max(
    1,
    Math.round((windowEnd.getTime() - startMs) / DAY_MS),
  );
  const buckets: RoutineRecord[][] = Array.from({ length: dayCount }, () => []);
  for (const r of records) {
    const idx = Math.floor((new Date(r.at).getTime() - startMs) / DAY_MS);
    if (idx >= 0 && idx < dayCount) buckets[idx].push(r);
  }

  const days = buckets.map(aggregateDay);
  const avg = emptyAgg();
  for (const d of days) {
    avg.totalRecords += d.totalRecords;
    avg.feeds += d.feeds;
    avg.ozTotal += d.ozTotal;
    avg.sleepMins += d.sleepMins;
    avg.longestSleepMins += d.longestSleepMins;
    avg.diapers += d.diapers;
    avg.diaperWet += d.diaperWet;
    avg.diaperDirty += d.diaperDirty;
    avg.playMins += d.playMins;
    avg.longestFeedGapHours += d.longestFeedGapHours;
  }
  const n = days.length;
  avg.totalRecords /= n;
  avg.feeds /= n;
  avg.ozTotal /= n;
  avg.sleepMins /= n;
  avg.longestSleepMins /= n;
  avg.diapers /= n;
  avg.diaperWet /= n;
  avg.diaperDirty /= n;
  avg.playMins /= n;
  avg.longestFeedGapHours /= n;

  return { days, avg };
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

const SYSTEM = `You are Clement, a warm casual friend helping a new parent. Write a 2-4 sentence morning brief comparing yesterday to a 7-day average. Mention 1-2 concrete numbers and one gentle observation. No bullets, no markdown, no clinical tone, no medical advice. Plain text only.`;

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
      longestFeedGapHours: round(yesterday.longestFeedGapHours),
      other: yesterday.other,
    },
    baseline7dAvg: {
      feeds: round(baselineAvg.feeds),
      ozTotal: round(baselineAvg.ozTotal),
      sleepHours: round(baselineAvg.sleepMins / 60),
      diapers: round(baselineAvg.diapers),
      playMins: round(baselineAvg.playMins),
      longestFeedGapHours: round(baselineAvg.longestFeedGapHours),
    },
  };

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallbackText(yesterday, baselineAvg);
  } catch (err) {
    console.warn(
      "[brief] LLM call failed, using fallback:",
      (err as Error).message,
    );
    return fallbackText(yesterday, baselineAvg);
  }
}
