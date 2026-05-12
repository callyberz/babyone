import { useState } from "react";
import type { RecordType, RoutineRecord } from "../types";
import { categories } from "../types";
import { fmtDay, fmtTime } from "../utils";

type Filter = "all" | RecordType;

export function TodayScreen({
  records,
  openRecord,
}: {
  records: RoutineRecord[];
  openRecord: (r: RoutineRecord) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = records.filter((r) => filter === "all" || r.type === filter);

  const groups: { day: string; label: string; items: RoutineRecord[] }[] = [];
  let last: string | null = null;
  filtered.forEach((r) => {
    const day = new Date(r.at).toDateString();
    if (day !== last) {
      groups.push({ day, label: fmtDay(r.at), items: [] });
      last = day;
    }
    groups[groups.length - 1].items.push(r);
  });

  const filters: [Filter, string][] = [
    ["all", "All"],
    ...(
      Object.entries(categories) as [
        RecordType,
        (typeof categories)[RecordType],
      ][]
    ).map(([k, v]) => [k, v.label] as [Filter, string]),
  ];

  return (
    <div className="content-pad">
      <div className="chart-tabs" style={{ flexWrap: "wrap" }}>
        {filters.map(([k, label]) => (
          <button
            key={k}
            className={`chart-tab ${filter === k ? "active" : ""}`}
            onClick={() => setFilter(k)}
          >
            {k !== "all" && (
              <span style={{ marginRight: 6 }}>
                {categories[k as RecordType].icon}
              </span>
            )}
            {label}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="section-h">{g.label}</div>
          <div className="tl">
            {g.items.map((r) => {
              const cat = categories[r.type];
              return (
                <div className="tl-item" key={r.id}>
                  <div className="tl-dot" style={{ borderColor: cat.tint }} />
                  <div className="tl-time">{fmtTime(r.at)}</div>
                  <div className="tl-card" onClick={() => openRecord(r)}>
                    <div
                      className="tl-ico"
                      style={{ background: `${cat.tint}22`, color: cat.tint }}
                    >
                      {cat.icon}
                    </div>
                    <div className="tl-body">
                      <div className="tl-title">{r.title}</div>
                      {r.detail && <div className="tl-detail">{r.detail}</div>}
                    </div>
                    <div className="tl-tag">{cat.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!filtered.length && (
        <div className="empty">No records yet for this filter.</div>
      )}
    </div>
  );
}
