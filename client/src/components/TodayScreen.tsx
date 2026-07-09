import { useState } from "react";
import type { RecordType, RoutineRecord, KnownRecordType } from "../types";
import { categories, getCategory } from "../types";
import { fmtDay, fmtTime, recordChips } from "../utils";

type Filter = "all" | RecordType;

export function TodayScreen({
  records,
  openRecord,
  isAdmin,
  onBulkDelete,
}: {
  records: RoutineRecord[];
  openRecord: (r: RoutineRecord) => void;
  isAdmin?: boolean;
  onBulkDelete?: (ids: number[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const stopSelecting = () => {
    setSelecting(false);
    setConfirming(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = records.filter((r) => filter === "all" || r.type === filter);

  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id)));

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
        KnownRecordType,
        (typeof categories)[KnownRecordType],
      ][]
    ).map(([k, v]) => [k, v.label] as [Filter, string]),
  ];

  return (
    <div className="content-pad">
      <div
        className="chart-tabs"
        style={{ flexWrap: "wrap", justifyContent: "space-between" }}
      >
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {filters.map(([k, label]) => (
            <button
              key={k}
              className={`chart-tab ${filter === k ? "active" : ""}`}
              onClick={() => setFilter(k)}
            >
              {k !== "all" && (
                <span style={{ marginRight: 6 }}>
                  {categories[k as KnownRecordType].icon}
                </span>
              )}
              {label}
            </button>
          ))}
        </div>
        {isAdmin && !selecting && (
          <button className="btn btn-ghost" onClick={() => setSelecting(true)}>
            Select
          </button>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="section-h">{g.label}</div>
          <div className="tl">
            {g.items.map((r) => {
              const cat = getCategory(r.type);
              const chips = recordChips(r);
              return (
                <div className="tl-item" key={r.id}>
                  <div className="tl-dot" style={{ borderColor: cat.tint }} />
                  <div className="tl-time">{fmtTime(r.at)}</div>
                  <div
                    className="tl-card"
                    onClick={() =>
                      selecting ? toggleSelected(r.id) : openRecord(r)
                    }
                  >
                    {selecting && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleSelected(r.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div
                      className="tl-ico"
                      style={{ background: `${cat.tint}22`, color: cat.tint }}
                    >
                      {cat.icon}
                    </div>
                    <div className="tl-body">
                      <div className="tl-title">{r.title}</div>
                      {chips.length > 0 && (
                        <div className="tl-chips">
                          {chips.map((c, i) => (
                            <span
                              className="tl-chip"
                              key={i}
                              style={{
                                background: `${cat.tint}1f`,
                                color: cat.tint,
                              }}
                            >
                              {c.icon && (
                                <span className="tl-chip-ico">{c.icon}</span>
                              )}
                              {c.text}
                            </span>
                          ))}
                        </div>
                      )}
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
      {selecting && (
        <div className="composer">
          <div
            className="composer-inner"
            style={{ justifyContent: "space-between" }}
          >
            {confirming ? (
              <>
                <span>
                  Delete {selected.size} record
                  {selected.size === 1 ? "" : "s"}? This can't be undone.
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--warn)" }}
                    onClick={() => {
                      onBulkDelete?.([...selected]);
                      stopSelecting();
                    }}
                  >
                    Confirm delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>{selected.size} selected</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={toggleSelectAll}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                  <button className="btn" onClick={stopSelecting}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--warn)" }}
                    disabled={selected.size === 0}
                    onClick={() => setConfirming(true)}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
