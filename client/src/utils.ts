import type { Baby, RecordMeta } from "./types";

export const getBabyDisplayName = (
  baby: Pick<Baby, "name"> | null | undefined,
): string => baby?.name.trim() || "your baby";

export const getBabyInitial = (
  baby: Pick<Baby, "name"> | null | undefined,
): string =>
  [...(baby?.name.trim() || "B")][0]?.toLocaleUpperCase() ?? "B";

export const toDate = (s: string | Date) =>
  s instanceof Date ? s : new Date(s);

export const fmtTime = (s: string | Date) =>
  toDate(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const fmtAgo = (s: string | Date) => {
  const d = toDate(s);
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const formatTimezone = (s?: string | Date) => {
  const d = s ? toDate(s) : new Date();
  const parts = new Intl.DateTimeFormat([], {
    timeZoneName: "long",
  }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
};

export const fmtDuration = (mins: number) => {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
};

export const formatBabyAge = (birthdate: string, now = new Date()) => {
  const [year, month, day] = birthdate.split("-").map(Number);
  const born = new Date(year, month - 1, day);
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.floor((current.getTime() - born.getTime()) / 86400000));
  if (days === 0) return "newborn";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 63) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30.44);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.floor(days / 365.2425);
  const months = Math.floor((days - years * 365.2425) / 30.44);
  return `${years} year${years === 1 ? "" : "s"}${months ? ` ${months} month${months === 1 ? "" : "s"}` : ""}`;
};

export const formatBabyWeight = (baby: Pick<Baby, "weightValue" | "weightUnit">) =>
  baby.weightValue == null ? null : `${Number(baby.weightValue.toFixed(2))} ${baby.weightUnit}`;

export interface RecordChip {
  icon?: string;
  text: string;
}

const SIDE_LABEL: Record<string, string> = {
  left: "left side",
  right: "right side",
  both: "both sides",
  bottle: "bottle",
};

const DIAPER_CHIP: Record<string, RecordChip> = {
  wet: { icon: "💧", text: "wet" },
  dirty: { icon: "💩", text: "dirty" },
  both: { icon: "💧💩", text: "both" },
};

const MOOD_CHIP: Record<string, RecordChip> = {
  happy: { icon: "😊", text: "happy" },
  fussy: { icon: "😣", text: "fussy" },
};

// Maps a record's structured meta into glanceable chips for the timeline.
// Pure: only reads record.type and record.meta, returns [] when nothing to show.
export const recordChips = (r: {
  type: string;
  meta?: RecordMeta | null;
}): RecordChip[] => {
  const meta = r.meta ?? {};
  const chips: RecordChip[] = [];
  const mins = typeof meta.mins === "number" ? meta.mins : undefined;

  switch (r.type) {
    case "sleep": {
      if (mins != null) chips.push({ icon: "⏱", text: fmtDuration(mins) });
      if (typeof meta.where === "string" && meta.where)
        chips.push({ icon: "😴", text: meta.where });
      break;
    }
    case "feed": {
      const isBottle = meta.side === "bottle" || meta.volume_oz != null;
      if (isBottle) {
        if (typeof meta.volume_oz === "number" && meta.volume_oz > 0)
          chips.push({ icon: "🍼", text: `${meta.volume_oz} oz` });
        if (mins != null) chips.push({ icon: "⏱", text: fmtDuration(mins) });
      } else {
        if (mins != null) chips.push({ icon: "⏱", text: fmtDuration(mins) });
        if (typeof meta.side === "string" && SIDE_LABEL[meta.side])
          chips.push({ icon: "🤱", text: SIDE_LABEL[meta.side] });
      }
      break;
    }
    case "diaper": {
      const chip = typeof meta.kind === "string" && DIAPER_CHIP[meta.kind];
      if (chip) chips.push(chip);
      break;
    }
    case "meds": {
      if (typeof meta.name === "string" && meta.name)
        chips.push({ icon: "💊", text: meta.name });
      if (typeof meta.dose === "string" && meta.dose)
        chips.push({ text: meta.dose });
      break;
    }
    case "play": {
      if (mins != null) chips.push({ icon: "⏱", text: fmtDuration(mins) });
      break;
    }
    case "mood": {
      const chip = typeof meta.kind === "string" && MOOD_CHIP[meta.kind];
      if (chip) chips.push(chip);
      break;
    }
  }
  return chips;
};

export const fmtDay = (s: string | Date) => {
  const d = toDate(s);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};
