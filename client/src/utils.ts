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
