export type {
  ChatMessage,
  KnownRecordType,
  RecordMeta,
  RecordType,
  RoutineRecord,
  User,
} from "@babyone/contracts";

import type { KnownRecordType } from "@babyone/contracts";

export interface Baby {
  name: string;
  age: string;
  weight?: string;
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
