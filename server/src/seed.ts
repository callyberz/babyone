import {
  insertMessage,
  insertRecord,
  isSeeded,
  markSeeded,
  db as defaultDb,
} from "./db.js";
import type { RoutineRecord } from "./types.js";
import type DatabaseT from "better-sqlite3";
import { hashPassword } from "./auth/passwords.js";

export interface AdminCreds {
  email: string;
  password: string;
  displayName: string;
}

export function readAdminCredsFromEnv(): AdminCreds | null {
  const email = process.env.BABYONE_ADMIN_EMAIL;
  const password = process.env.BABYONE_ADMIN_PASSWORD;
  const displayName = process.env.BABYONE_ADMIN_NAME;
  if (!email || !password || !displayName) return null;
  return { email: email.toLowerCase(), password, displayName };
}

export async function bootstrapAdmin(
  db: DatabaseT.Database,
  creds: AdminCreds | null,
): Promise<number | null> {
  const existing = (
    db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }
  ).c;
  if (existing > 0) return null;

  if (!creds) {
    console.error(
      "[babyone] No users in DB and BABYONE_ADMIN_* env vars not set. " +
        "Set BABYONE_ADMIN_EMAIL, BABYONE_ADMIN_PASSWORD, and BABYONE_ADMIN_NAME, then restart.",
    );
    process.exit(1);
    return null;
  }

  const hash = await hashPassword(creds.password);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(creds.email, hash, creds.displayName, new Date().toISOString());
  const id = Number(info.lastInsertRowid);
  console.log(
    `[babyone] Created admin user ${creds.email}. ` +
      "You can unset BABYONE_ADMIN_* env vars now.",
  );
  return id;
}

export function backfillRecordsUser(
  db: DatabaseT.Database,
  adminId: number,
): void {
  db.prepare("UPDATE records SET user_id = ? WHERE user_id IS NULL").run(
    adminId,
  );
}

export async function bootstrapAuth(): Promise<void> {
  const creds = readAdminCredsFromEnv();
  const id = await bootstrapAdmin(defaultDb, creds);
  if (id !== null) backfillRecordsUser(defaultDb, id);
  else {
    // Ensure no orphan records (no-op after first run).
    const first = defaultDb
      .prepare("SELECT id FROM users ORDER BY id LIMIT 1")
      .get() as { id: number } | undefined;
    if (first) backfillRecordsUser(defaultDb, first.id);
  }
}

const now = () => new Date();
const hoursAgo = (h: number, m = 0) => {
  const d = now();
  d.setHours(d.getHours() - h);
  d.setMinutes(d.getMinutes() - m);
  return d.toISOString();
};

export function seedIfEmpty(): void {
  if (isSeeded()) return;

  const recs: Omit<RoutineRecord, "id">[] = [
    {
      type: "feed",
      at: hoursAgo(0, 45),
      title: "Bottle — 3 oz formula",
      detail: "Finished most; slow pace",
      meta: { volume_oz: 3, side: "bottle" },
    },
    {
      type: "diaper",
      at: hoursAgo(1, 20),
      title: "Diaper — wet",
      detail: "Regular, pale yellow",
      meta: { kind: "wet" },
    },
    {
      type: "sleep",
      at: hoursAgo(2, 30),
      title: "Nap — 58 min",
      detail: "Swaddled in bassinet",
      meta: { mins: 58, where: "bassinet" },
    },
    {
      type: "feed",
      at: hoursAgo(4, 15),
      title: "Breastfed — 18 min L",
      detail: "Left side only; fell asleep",
      meta: { mins: 18, side: "left" },
    },
    {
      type: "diaper",
      at: hoursAgo(5, 0),
      title: "Diaper — dirty",
      detail: "Mustard color, soft",
      meta: { kind: "dirty" },
    },
    {
      type: "play",
      at: hoursAgo(6, 10),
      title: "Tummy time — 4 min",
      detail: "Lifted head briefly!",
      meta: { mins: 4 },
    },
    {
      type: "mood",
      at: hoursAgo(7, 0),
      title: "Fussy spell",
      detail: "~15 min; resolved with holding",
      meta: { kind: "fussy" },
    },
    {
      type: "feed",
      at: hoursAgo(8, 20),
      title: "Breastfed — 22 min both",
      detail: "Good latch; full feed",
      meta: { mins: 22, side: "both" },
    },
    {
      type: "sleep",
      at: hoursAgo(10, 0),
      title: "Long sleep — 3 h 20 m",
      detail: "Overnight stretch",
      meta: { mins: 200, where: "bassinet" },
    },
    {
      type: "meds",
      at: hoursAgo(13, 30),
      title: "Vitamin D drops",
      detail: "1 mL, post-feed",
      meta: { name: "Vit D", dose: "1 mL" },
    },
    // Yesterday
    {
      type: "feed",
      at: hoursAgo(15, 0),
      title: "Bottle — 2.5 oz",
      detail: "Spit-up after",
      meta: { volume_oz: 2.5 },
    },
    {
      type: "diaper",
      at: hoursAgo(16, 30),
      title: "Diaper — wet",
      detail: "",
      meta: { kind: "wet" },
    },
    {
      type: "sleep",
      at: hoursAgo(18, 0),
      title: "Nap — 42 min",
      detail: "Contact nap",
      meta: { mins: 42 },
    },
    {
      type: "feed",
      at: hoursAgo(20, 0),
      title: "Breastfed — 20 min",
      detail: "",
      meta: { mins: 20, side: "right" },
    },
    {
      type: "diaper",
      at: hoursAgo(22, 0),
      title: "Diaper — dirty",
      detail: "Normal",
      meta: { kind: "dirty" },
    },
    {
      type: "sleep",
      at: hoursAgo(26, 0),
      title: "Night sleep — 2 h 50 m",
      detail: "Stirred once",
      meta: { mins: 170 },
    },
    {
      type: "feed",
      at: hoursAgo(28, 30),
      title: "Breastfed — 24 min",
      detail: "",
      meta: { mins: 24, side: "both" },
    },
    {
      type: "play",
      at: hoursAgo(30, 0),
      title: "Tummy time — 3 min",
      detail: "",
      meta: { mins: 3 },
    },
    {
      type: "mood",
      at: hoursAgo(32, 0),
      title: "Smiled at mobile",
      detail: "First real social smile!",
      meta: { kind: "happy" },
    },
    {
      type: "feed",
      at: hoursAgo(34, 0),
      title: "Bottle — 3 oz",
      detail: "",
      meta: { volume_oz: 3 },
    },
    {
      type: "sleep",
      at: hoursAgo(36, 0),
      title: "Nap — 1 h 10 m",
      detail: "Stroller nap",
      meta: { mins: 70 },
    },
  ];

  // Lighter days 3–7
  for (let day = 2; day <= 6; day++) {
    const base = day * 24;
    const feeds = 7 + Math.floor(Math.random() * 2);
    for (let f = 0; f < feeds; f++) {
      const mins = 15 + Math.round(Math.random() * 15);
      const oz = +(2 + Math.random() * 2).toFixed(1);
      recs.push({
        type: "feed",
        at: hoursAgo(base + f * 3 + Math.random() * 1.5),
        title:
          Math.random() > 0.5 ? "Breastfed — ~20 min" : `Bottle — ${oz} oz`,
        detail: "",
        meta: { mins, volume_oz: 2 + Math.round(Math.random() * 3) },
      });
    }
    const sleeps = 4 + Math.floor(Math.random() * 2);
    for (let s = 0; s < sleeps; s++) {
      recs.push({
        type: "sleep",
        at: hoursAgo(base + s * 4 + Math.random() * 2),
        title: `Sleep — ${(1 + Math.random() * 2.5).toFixed(1)} h`,
        detail: "",
        meta: { mins: Math.round(60 + Math.random() * 180) },
      });
    }
    const diapers = 6 + Math.floor(Math.random() * 3);
    for (let dp = 0; dp < diapers; dp++) {
      const dirty = Math.random() > 0.6;
      recs.push({
        type: "diaper",
        at: hoursAgo(base + dp * 3 + Math.random()),
        title: dirty ? "Diaper — dirty" : "Diaper — wet",
        detail: "",
        meta: { kind: dirty ? "dirty" : "wet" },
      });
    }
    recs.push({
      type: "meds",
      at: hoursAgo(base + 6),
      title: "Vitamin D drops",
      detail: "1 mL",
      meta: {},
    });
  }

  const inserted = recs.map(insertRecord);
  const byOffset = (offset: number) => inserted[offset]?.id ?? 0;

  const chat = [
    {
      from: "bot" as const,
      at: hoursAgo(9, 0),
      text: "Morning! ☀️ Clement slept about 3h 20m last night — a little longer than the night before. Ready for today?",
      recordIds: [],
    },
    {
      from: "user" as const,
      at: hoursAgo(8, 22),
      text: "Just finished nursing, both sides, about 22 minutes",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(8, 22),
      text: "Logged it. Nice full feed — next one likely around 10:30am. I'll nudge you.",
      recordIds: [byOffset(7)],
    },
    {
      from: "user" as const,
      at: hoursAgo(7, 2),
      text: "He's been fussy for 15 min, finally settled",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(7, 2),
      text: "Noted. That's his 2nd fussy spell today — both after longer wake windows. Want me to suggest a shorter wake window next?",
      recordIds: [byOffset(6)],
    },
    {
      from: "user" as const,
      at: hoursAgo(6, 12),
      text: "Did 4 min of tummy time, he lifted his head!",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(6, 12),
      text: "Amazing 🎉 First head-lift this week! Added to milestones.",
      recordIds: [byOffset(5)],
    },
    {
      from: "user" as const,
      at: hoursAgo(4, 18),
      text: "Breastfed left side 18 min, fell asleep on me",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(4, 18),
      text: "Got it. Short-ish feed — keep an eye on the next diaper in case he's still hungry.",
      recordIds: [byOffset(3)],
    },
    {
      from: "user" as const,
      at: hoursAgo(2, 33),
      text: "Nap ended, 58 min in the bassinet",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(2, 33),
      text: "Logged. That's a solid nap — total daytime sleep so far today is 2h 40m.",
      recordIds: [byOffset(2)],
    },
    {
      from: "user" as const,
      at: hoursAgo(1, 22),
      text: "wet diaper",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(1, 22),
      text: "Done. 6th diaper today — hydration is looking great.",
      recordIds: [byOffset(1)],
    },
    {
      from: "user" as const,
      at: hoursAgo(0, 48),
      text: "3 oz formula, slow but finished most of it",
      recordIds: [],
    },
    {
      from: "bot" as const,
      at: hoursAgo(0, 48),
      text: "Logged 3 oz. He's averaging every ~2h 40m today.",
      recordIds: [byOffset(0)],
    },
  ];
  chat.forEach(insertMessage);
  markSeeded();
}
