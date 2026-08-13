import type { RoutineRecord } from "./types.js";

const nowIso = (d = new Date()) => d.toISOString();

export interface RuleBasedResult {
  replyText: string;
  draft?: Omit<RoutineRecord, "id">;
}

export function ruleBasedParse(
  text: string,
  now = new Date(),
  tzOffsetMin: number | null = null,
): RuleBasedResult {
  const t = text.toLowerCase().trim();

  const extractMinutes = (): number | null => {
    const m = t.match(/(\d+)\s*(?:min|mins|minute|minutes|m\b)/);
    if (m) return parseInt(m[1]);
    const h = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour|hours)/);
    if (h) return Math.round(parseFloat(h[1]) * 60);
    return null;
  };
  const extractBottleVolume = (): {
    display: string;
    volumeOz: number;
  } | null => {
    const match = t.match(/(\d+(?:\.\d+)?)\s*(oz|ounce|ounces|ml)\b/);
    if (!match) return null;
    const amount = parseFloat(match[1]);
    const unit = match[2];
    if (unit === "ml") {
      // Record aggregation currently uses ounces, but preserve the unit the
      // caregiver entered in the human-readable title.
      return {
        display: `${amount} ml`,
        volumeOz: Number((amount / 29.5735295625).toFixed(3)),
      };
    }
    return { display: `${amount} oz`, volumeOz: amount };
  };
  const extractSide = (): "both" | "left" | "right" | null => {
    if (/\bboth\b/.test(t)) return "both";
    if (/\bleft\b/.test(t)) return "left";
    if (/\bright\b/.test(t)) return "right";
    return null;
  };
  const extractTime = (): string => {
    const m = t.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (m) {
      let hr = parseInt(m[1]);
      const min = m[2] ? parseInt(m[2]) : 0;
      if (m[3] === "pm" && hr < 12) hr += 12;
      if (m[3] === "am" && hr === 12) hr = 0;

      if (typeof tzOffsetMin === "number" && Number.isFinite(tzOffsetMin)) {
        const offsetMs = tzOffsetMin * 60_000;
        const localNow = new Date(now.getTime() - offsetMs);
        let localTargetMs = Date.UTC(
          localNow.getUTCFullYear(),
          localNow.getUTCMonth(),
          localNow.getUTCDate(),
          hr,
          min,
        );
        if (localTargetMs > localNow.getTime()) {
          localTargetMs -= 24 * 60 * 60 * 1000;
        }
        return new Date(localTargetMs + offsetMs).toISOString();
      }

      const d = new Date(now);
      d.setHours(hr, min, 0, 0);
      if (d > now) d.setDate(d.getDate() - 1);
      return d.toISOString();
    }
    return nowIso(now);
  };

  type NewRec = Omit<RoutineRecord, "id">;

  if (/diaper|poop|pee|pooped|wet|dirty|nappy/.test(t)) {
    const dirty = /poop|pooped|dirty|stool/.test(t);
    const draft: NewRec = {
      type: "diaper",
      at: extractTime(),
      title: `Diaper — ${dirty ? "dirty" : "wet"}`,
      detail: "",
      meta: { kind: dirty ? "dirty" : "wet" },
    };
    return {
      draft,
      replyText: dirty
        ? "Logged a dirty diaper."
        : "Logged a wet diaper.",
    };
  }

  if (/sleep|slept|nap|napped|asleep|woke/.test(t)) {
    const mins = extractMinutes() ?? 45;
    const where = /bassinet/.test(t)
      ? "bassinet"
      : /crib/.test(t)
        ? "crib"
        : /stroller/.test(t)
          ? "stroller"
          : /contact|on me/.test(t)
            ? "contact"
            : null;
    const draft: NewRec = {
      type: "sleep",
      at: extractTime(),
      title: `Sleep — ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}`,
      detail: where ? `In ${where}` : "",
      meta: { mins, where },
    };
    return {
      draft,
      replyText: `Logged ${mins} minutes of sleep.`,
    };
  }

  if (
    /bottle|formula|oz|ounce|ml/.test(t) &&
    !/breast|nursed|nursing/.test(t)
  ) {
    const volume = extractBottleVolume() ?? {
      display: "3 oz",
      volumeOz: 3,
    };
    const draft: NewRec = {
      type: "feed",
      at: extractTime(),
      title: `Bottle — ${volume.display}`,
      detail: /formula/.test(t) ? "Formula" : "",
      meta: { volume_oz: volume.volumeOz, side: "bottle" },
    };
    return {
      draft,
      replyText: `Logged a ${volume.display} bottle.`,
    };
  }

  if (/breast|nursed|nursing|fed|feed|latch/.test(t)) {
    const mins = extractMinutes() ?? 18;
    const side = extractSide() ?? "both";
    const draft: NewRec = {
      type: "feed",
      at: extractTime(),
      title: `Breastfed — ${mins} min ${side === "both" ? "both" : side}`,
      detail: "",
      meta: { mins, side },
    };
    return {
      draft,
      replyText: `Logged a ${mins}-minute feed.`,
    };
  }

  if (/tummy|rolled|lifted|head|play/.test(t)) {
    const mins = extractMinutes() ?? 3;
    const draft: NewRec = {
      type: "play",
      at: extractTime(),
      title: `Tummy time — ${mins} min`,
      detail: /lift/.test(t) ? "Head-lift attempt!" : "",
      meta: { mins },
    };
    return {
      draft,
      replyText: /lift|rolled|smiled/.test(t)
        ? "That's a milestone — saved it. 🎉"
        : `${mins} minutes of tummy time logged.`,
    };
  }

  if (/fussy|cried|crying|happy|smile|smiled|content|calm/.test(t)) {
    const positive = /happy|smile|content|calm/.test(t);
    const draft: NewRec = {
      type: "mood",
      at: extractTime(),
      title: positive ? "Happy mood" : "Fussy spell",
      detail: "",
      meta: { kind: positive ? "happy" : "fussy" },
    };
    return {
      draft,
      replyText: positive
        ? "Happy mood logged."
        : "Fussy mood logged.",
    };
  }

  if (/vitamin|drops|tylenol|medicine|\bmed\b|gas drops/.test(t)) {
    const draft: NewRec = {
      type: "meds",
      at: extractTime(),
      title: /vitamin/.test(t) ? "Vitamin D drops" : "Medication",
      detail: "",
      meta: {},
    };
    return {
      draft,
      replyText: "Medication entry logged.",
    };
  }

  if (/how|what|when|why|did|was|\?/.test(t)) {
    return {
      replyText:
        "Hmm — try asking something like 'how much sleep last night' or 'how many diapers today' and I'll pull the numbers.",
    };
  }

  return {
    replyText:
      "Got it. I'm not sure how to log that exactly — could you say it as a time + activity? e.g. 'fed 3oz at 2pm' or 'nap 45 min'.",
  };
}
