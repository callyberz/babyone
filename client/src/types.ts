export type RecordType = "feed" | "sleep" | "diaper" | "meds" | "play" | "mood";

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
  weight: string;
}

export interface Category {
  icon: string;
  label: string;
  tint: string;
}

export const categories: Record<RecordType, Category> = {
  feed: { icon: "🍼", label: "Feeding", tint: "var(--cat-feed)" },
  sleep: { icon: "🌙", label: "Sleep", tint: "var(--cat-sleep)" },
  diaper: { icon: "💧", label: "Diaper", tint: "var(--cat-diaper)" },
  meds: { icon: "💊", label: "Meds", tint: "var(--cat-meds)" },
  play: { icon: "🧸", label: "Tummy time", tint: "var(--cat-play)" },
  mood: { icon: "🫧", label: "Mood", tint: "var(--cat-mood)" },
};
