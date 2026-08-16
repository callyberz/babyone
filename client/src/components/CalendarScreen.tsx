import { useMemo, useState } from "react";
import type { RecordType, RoutineRecord } from "../types";
import { getCategory } from "../types";
import { fmtDay, fmtTime } from "../utils";
import { Icon } from "./icons";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(value: Date) {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

function sameMonth(a: Date, b: Date) {
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

function fullDateLabel(date: Date) {
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function shortDateLabel(date: Date) {
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function recordCount(count: number) {
  return `${count} ${count === 1 ? "record" : "records"}`;
}

function recordBreakdown(records: RoutineRecord[]) {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const label = getCategory(record.type).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
}

export function CalendarScreen({
  records,
  openRecord,
  babyName = "your baby",
}: {
  records: RoutineRecord[];
  openRecord: (r: RoutineRecord) => void;
  babyName?: string;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));

  const monthEnd = new Date(cursor);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0);
  const startOffset = cursor.getDay();
  const totalCells = Math.ceil((startOffset + monthEnd.getDate()) / 7) * 7;

  const byDay = useMemo(() => {
    const grouped = new Map<number, RoutineRecord[]>();
    records.forEach((record) => {
      const timestamp = new Date(record.at);
      if (Number.isNaN(timestamp.getTime())) return;
      const key = startOfDay(timestamp).getTime();
      const day = grouped.get(key) ?? [];
      day.push(record);
      grouped.set(key, day);
    });
    return grouped;
  }, [records]);

  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(cursor);
    date.setDate(date.getDate() + (i - startOffset));
    cells.push(date);
  }

  const today = startOfDay(new Date());
  const selectedRecords = [...(byDay.get(selected.getTime()) ?? [])].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id - b.id,
  );
  const sumByType: Partial<Record<RecordType, number>> = {};
  selectedRecords.forEach((record) => {
    sumByType[record.type] = (sumByType[record.type] ?? 0) + 1;
  });

  const monthDays = [...byDay.entries()]
    .filter(([key]) => sameMonth(new Date(key), cursor))
    .sort(([a], [b]) => a - b);
  const monthRecordCount = monthDays.reduce(
    (total, [, dayRecords]) => total + dayRecords.length,
    0,
  );
  const busiestDay = monthDays.reduce<(typeof monthDays)[number] | null>(
    (busiest, day) =>
      !busiest || day[1].length > busiest[1].length ? day : busiest,
    null,
  );

  const monthLabel = cursor.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const monthHeadingId = "calendar-month-heading";
  const monthSummaryId = "calendar-month-summary-heading";

  const moveMonth = (offset: number) => {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + offset);
    setCursor(next);
    setSelected(new Date(next));
  };

  const goToToday = () => {
    const date = startOfDay(new Date());
    setCursor(startOfMonth(date));
    setSelected(date);
  };

  return (
    <div className="content-pad">
      <div className="cal-toolbar">
        <h2
          className="serif"
          id={monthHeadingId}
          aria-live="polite"
        >
          {monthLabel}
        </h2>
        <div className="cal-nav" aria-label="Calendar navigation">
          <button
            type="button"
            className="btn btn-ghost cal-nav-button"
            aria-label="Previous month"
            onClick={() => moveMonth(-1)}
          >
            <Icon.back aria-hidden="true" focusable="false" />
          </button>
          <button
            type="button"
            className="btn"
            aria-label={`Go to today, ${fullDateLabel(today)}`}
            onClick={goToToday}
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn-ghost cal-nav-button"
            aria-label="Next month"
            onClick={() => moveMonth(1)}
          >
            <Icon.fwd aria-hidden="true" focusable="false" />
          </button>
        </div>
      </div>

      <div className="cal-grid" aria-labelledby={monthHeadingId}>
        {WEEKDAYS.map((day) => (
          <div className="cal-head" key={day}>
            {day}
          </div>
        ))}
        {cells.map((date) => {
          const inMonth = sameMonth(date, cursor);
          const isToday = date.getTime() === today.getTime();
          const isSelected = date.getTime() === selected.getTime();
          const dayRecords = byDay.get(date.getTime()) ?? [];
          const types = [...new Set(dayRecords.map((record) => record.type))];
          const breakdown = recordBreakdown(dayRecords);
          const label = [
            fullDateLabel(date),
            isToday ? "today" : "",
            recordCount(dayRecords.length),
            breakdown,
            isSelected ? "selected" : "",
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <button
              type="button"
              key={date.getTime()}
              className={`cal-day ${inMonth ? "" : "muted"} ${isToday ? "today" : ""} ${
                isSelected ? "selected" : ""
              }`}
              aria-label={label}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => setSelected(new Date(date))}
            >
              <span className="d" aria-hidden="true">
                {date.getDate()}
              </span>
              {dayRecords.length > 0 && (
                <span className="cal-day-count" aria-hidden="true">
                  {dayRecords.length} {dayRecords.length === 1 ? "log" : "logs"}
                </span>
              )}
              <span className="cal-dots" aria-hidden="true">
                {types.map((type) => (
                  <span
                    key={type}
                    className="cal-dot"
                    style={{
                      background: isToday
                        ? "var(--accent-ink)"
                        : getCategory(type).tint,
                    }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <section
        className="cal-month-summary"
        aria-labelledby={monthSummaryId}
        aria-live="polite"
      >
        <div>
          <h3 id={monthSummaryId}>{monthLabel} overview</h3>
          <p>
            {monthRecordCount === 0
              ? `No activity logged for ${babyName} this month.`
              : `${recordCount(monthRecordCount)} across ${monthDays.length} active ${
                  monthDays.length === 1 ? "day" : "days"
                }.`}
          </p>
        </div>
        <dl>
          <div>
            <dt>Records</dt>
            <dd>{monthRecordCount}</dd>
          </div>
          <div>
            <dt>Active days</dt>
            <dd>{monthDays.length}</dd>
          </div>
          <div>
            <dt>Busiest day</dt>
            <dd>
              {busiestDay
                ? `${shortDateLabel(new Date(busiestDay[0]))} · ${recordCount(
                    busiestDay[1].length,
                  )}`
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <div className="section-h" role="status" aria-live="polite">
        {fmtDay(selected)} — {recordCount(selectedRecords.length)}
      </div>
      {selectedRecords.length === 0 ? (
        <div className="empty">
          No records logged for {babyName} this day.
        </div>
      ) : (
        <div className="cal-selected-summary">
          {Object.entries(sumByType).map(([type, count]) => {
            const category = getCategory(type);
            return (
              <div className="stat-card" key={type}>
                <div className="lbl">
                  <span
                    className="stat-swatch"
                    style={{ background: category.tint }}
                  />{" "}
                  {category.label}
                </div>
                <div className="val">{count}</div>
                <div className="sub">{count === 1 ? "entry" : "entries"}</div>
              </div>
            );
          })}
        </div>
      )}

      {selectedRecords.length > 0 && (
        <>
          <div className="section-h">Entries</div>
          <div className="tl">
            {selectedRecords.map((record) => {
              const category = getCategory(record.type);
              return (
                <div className="tl-item" key={record.id}>
                  <div className="tl-dot" style={{ borderColor: category.tint }} />
                  <div className="tl-time">{fmtTime(record.at)}</div>
                  <button
                    type="button"
                    className="tl-card"
                    aria-label={`Edit ${record.title} at ${fmtTime(record.at)}`}
                    onClick={() => openRecord(record)}
                  >
                    <div
                      className="tl-ico"
                      style={{
                        background: `${category.tint}22`,
                        color: category.tint,
                      }}
                      aria-hidden="true"
                    >
                      {category.icon}
                    </div>
                    <div className="tl-body">
                      <div className="tl-title">{record.title}</div>
                      {record.detail && <div className="tl-detail">{record.detail}</div>}
                    </div>
                    <div className="tl-tag">{category.label}</div>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
