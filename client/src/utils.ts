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

export const formatBabyAge = (
  birthdate: string,
  now: Date = new Date(),
): string => {
  const birth = new Date(`${birthdate}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  birth.setHours(0, 0, 0, 0);
  const days = Math.max(
    0,
    Math.round((today.getTime() - birth.getTime()) / 86400000),
  );

  if (days === 0) return "newborn";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;

  if (days < 365) {
    const weeks = Math.floor(days / 7);
    if (weeks < 9) return `${weeks} week${weeks === 1 ? "" : "s"}`;
    const months = Math.floor(days / 30.44);
    return `${months} month${months === 1 ? "" : "s"}`;
  }

  const years = Math.floor(days / 365.25);
  const remainingDays = days - Math.floor(years * 365.25);
  const months = Math.floor(remainingDays / 30.44);
  if (months === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"} ${months} month${months === 1 ? "" : "s"}`;
};

export const formatBabyWeight = (b: {
  weightValue: number;
  weightUnit: "lb" | "kg";
}): string => {
  const v = Number(b.weightValue.toFixed(2));
  return `${v} ${b.weightUnit}`;
};
