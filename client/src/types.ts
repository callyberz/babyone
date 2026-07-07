export type RecordType = string;

export const KNOWN_RECORD_TYPES = [
  "feed",
  "sleep",
  "diaper",
  "meds",
  "play",
  "mood",
] as const;

export type KnownRecordType = (typeof KNOWN_RECORD_TYPES)[number];

export interface RecordMeta {
  volume_oz?: number;
  side?: "left" | "right" | "both" | "bottle";
  mins?: number;
  where?: string | null;
  kind?: "wet" | "dirty" | "both" | "fussy" | "happy";
  name?: string;
  dose?: string;
  [k: string]: unknown;
}

export interface RoutineRecord {
  id: number;
  type: RecordType;
  at: string;
  title: string;
  detail: string;
  meta: RecordMeta;
  user?: { id: number; displayName: string } | null;
}

export interface ChatMessage {
  id: number;
  from: "user" | "bot";
  at: string;
  text: string;
  recordIds: number[];
}

export interface Baby {
  name: string;
  age: string;
  weight?: string;
}

export interface User {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface Category {
  icon: string;
  label: string;
  tint: string;
}

export const categories: Record<KnownRecordType, Category> = {
  feed: { icon: "🍼", label: "Feeding", tint: "var(--cat-feed)" },
  sleep: { icon: "🌙", label: "Sleep", tint: "var(--cat-sleep)" },
  diaper: { icon: "💧", label: "Diaper", tint: "var(--cat-diaper)" },
  meds: { icon: "💊", label: "Meds", tint: "var(--cat-meds)" },
  play: { icon: "🧸", label: "Tummy time", tint: "var(--cat-play)" },
  mood: { icon: "🫧", label: "Mood", tint: "var(--cat-mood)" },
};

export const OTHER_CATEGORY: Category = {
  icon: "✨",
  label: "Other",
  tint: "var(--cat-other, #94a3b8)",
};

export function getCategory(type: string): Category {
  return (
    (categories as Record<string, Category>)[type] ?? {
      ...OTHER_CATEGORY,
      label: prettifyTypeLabel(type),
    }
  );
}

function prettifyTypeLabel(type: string): string {
  if (!type) return OTHER_CATEGORY.label;
  return type
    .split("_")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
