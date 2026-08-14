import { useMemo, useState } from "react";
import type { RecordType, RoutineRecord } from "../types";
import { getCategory } from "../types";
import { fmtDay, fmtTime } from "../utils";
import { Icon } from "./icons";

export function CalendarScreen({
  records,
  openRecord,
  babyName = "your baby",
}: {
  records: RoutineRecord[];
  openRecord: (r: RoutineRecord) => void;
  babyName?: string;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selected, setSelected] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const monthEnd = new Date(cursor);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0);
  const startOffset = cursor.getDay();
  const totalCells = Math.ceil((startOffset + monthEnd.getDate()) / 7) * 7;

  const byDay = useMemo(() => {
    const m = new Map<number, RoutineRecord[]>();
    records.forEach((r) => {
      const d = new Date(r.at);
      d.setHours(0, 0, 0, 0);
      const k = d.getTime();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return m;
  }, [records]);

  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(cursor);
    d.setDate(d.getDate() + (i - startOffset));
    cells.push(d);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sel = byDay.get(selected.getTime()) ?? [];
  const sumByType: Partial<Record<RecordType, number>> = {};
  sel.forEach((r) => {
    sumByType[r.type] = (sumByType[r.type] ?? 0) + 1;
  });

  const monthLabel = cursor.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="content-pad">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 className="serif" style={{ margin: 0, fontSize: 24 }}>
          {monthLabel}
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const c = new Date(cursor);
              c.setMonth(c.getMonth() - 1);
              setCursor(c);
            }}
          >
            <Icon.back />
          </button>
          <button
            className="btn"
            onClick={() => {
              const d = new Date();
              d.setDate(1);
              d.setHours(0, 0, 0, 0);
              setCursor(d);
              const t = new Date();
              t.setHours(0, 0, 0, 0);
              setSelected(t);
            }}
          >
            Today
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const c = new Date(cursor);
              c.setMonth(c.getMonth() + 1);
              setCursor(c);
            }}
          >
            <Icon.fwd />
          </button>
        </div>
      </div>

      <div className="cal-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div className="cal-head" key={d}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = d.getTime() === today.getTime();
          const isSel = d.getTime() === selected.getTime();
          const recs = byDay.get(d.getTime()) ?? [];
          const types = [...new Set(recs.map((r) => r.type))].slice(0, 6);
          return (
            <div
              key={i}
              className={`cal-day ${inMonth ? "" : "muted"} ${isToday ? "today" : ""} ${
                isSel && !isToday ? "selected" : ""
              }`}
              onClick={() => setSelected(new Date(d))}
            >
              <div className="d">{d.getDate()}</div>
              <div className="cal-dots">
                {types.map((t) => (
                  <span
                    key={t}
                    className="cal-dot"
                    style={{
                      background: isToday
                        ? "var(--accent-ink)"
                        : getCategory(t).tint,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-h">
        {fmtDay(selected)} — {sel.length}{" "}
        {sel.length === 1 ? "record" : "records"}
      </div>
      {sel.length === 0 ? (
        <div className="empty">
          No records logged for {babyName} this day.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {Object.entries(sumByType).map(([t, n]) => {
            const cat = getCategory(t);
            return (
              <div className="stat-card" key={t}>
                <div className="lbl">
                  <span
                    className="stat-swatch"
                    style={{ background: cat.tint }}
                  />{" "}
                  {cat.label}
                </div>
                <div className="val">{n}</div>
                <div className="sub">{n === 1 ? "entry" : "entries"}</div>
              </div>
            );
          })}
        </div>
      )}

      {sel.length > 0 && (
        <>
          <div className="section-h">Entries</div>
          <div className="tl">
            {sel.map((r) => {
              const cat = getCategory(r.type);
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
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
