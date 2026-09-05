import { useState } from "react";
import type { RecordType, RoutineRecord, KnownRecordType } from "../types";
import { categories, getCategory } from "../types";
import { fmtDay, fmtTime, recordChips } from "../utils";
import { Icon } from "./icons";

type Filter = "all" | RecordType;
type CaregiverFilter = "all" | "unattributed" | `user:${number}`;

const caregiverKey = (record: RoutineRecord): CaregiverFilter =>
  record.user ? `user:${record.user.id}` : "unattributed";

export function TodayScreen({
  records,
  openRecord,
  isAdmin,
  onBulkDelete,
  babyName = "your baby",
}: {
  records: RoutineRecord[];
  openRecord: (r: RoutineRecord) => void;
  isAdmin?: boolean;
  onBulkDelete?: (ids: number[]) => Promise<void>;
  babyName?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [caregiver, setCaregiver] = useState<CaregiverFilter>("all");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const stopSelecting = () => {
    setSelecting(false);
    setConfirming(false);
    setDeleteError(null);
    setSelected(new Set());
  };

  const deleteSelected = async () => {
    if (!onBulkDelete || deleting || selected.size === 0) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onBulkDelete([...selected]);
      stopSelecting();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete these records",
      );
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelected = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = records.filter((r) => {
    if (filter !== "all" && r.type !== filter) return false;
    if (caregiver !== "all" && caregiverKey(r) !== caregiver) return false;
    if (!normalizedQuery) return true;

    const metaValues = Object.values(r.meta ?? {}).filter(
      (value): value is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof value),
    );
    const searchable = [
      r.title,
      r.detail,
      r.type,
      getCategory(r.type).label,
      r.user?.displayName,
      ...recordChips(r).map((chip) => chip.text),
      ...metaValues.map(String),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  });

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
  const caregivers = new Map<number, string>();
  let hasUnattributed = false;
  records.forEach((record) => {
    if (record.user) caregivers.set(record.user.id, record.user.displayName);
    else hasUnattributed = true;
  });
  const caregiverOptions = [...caregivers.entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  return (
    <div className="content-pad">
      <div className="timeline-search-row">
        <div className="timeline-search">
          <Icon.search aria-hidden="true" />
          <label className="sr-only" htmlFor="timeline-search">
            Search timeline
          </label>
          <input
            id="timeline-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, notes, medication…"
          />
          {query && (
            <button
              type="button"
              className="timeline-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <Icon.close aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="timeline-result-count" role="status" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "record" : "records"}
        </div>
      </div>
      <div
        className="chart-tabs"
        style={{ flexWrap: "wrap", justifyContent: "space-between" }}
      >
        <div className="cluster-wrap">
          {filters.map(([k, label]) => (
            <button
              key={k}
              className={`chart-tab ${filter === k ? "active" : ""}`}
              type="button"
              aria-pressed={filter === k}
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
        <div className="timeline-filter-actions">
          <label className="timeline-caregiver-filter">
            <span>Caregiver</span>
            <select
              aria-label="Filter by caregiver"
              value={caregiver}
              onChange={(event) =>
                setCaregiver(event.target.value as CaregiverFilter)
              }
            >
              <option value="all">Everyone</option>
              {caregiverOptions.map(([id, name]) => (
                <option value={`user:${id}`} key={id}>
                  {name}
                </option>
              ))}
              {hasUnattributed && (
                <option value="unattributed">Unattributed</option>
              )}
            </select>
          </label>
          {isAdmin && !selecting && (
            <button className="btn btn-ghost" onClick={() => setSelecting(true)}>
              Select
            </button>
          )}
        </div>
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
                  <button
                    type="button"
                    className="tl-card"
                    aria-label={
                      selecting
                        ? `${selected.has(r.id) ? "Deselect" : "Select"} ${r.title} at ${fmtTime(r.at)}`
                        : `Edit ${r.title} at ${fmtTime(r.at)}`
                    }
                    aria-pressed={selecting ? selected.has(r.id) : undefined}
                    onClick={() => (selecting ? toggleSelected(r.id) : openRecord(r))}
                  >
                    {selecting && (
                      <span
                        className={`record-select-mark ${selected.has(r.id) ? "selected" : ""}`}
                        aria-hidden="true"
                      >
                        {selected.has(r.id) ? "✓" : ""}
                      </span>
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
                      <div className="tl-attribution">
                        Logged by {r.user?.displayName ?? "an earlier caregiver"}
                      </div>
                    </div>
                    <div className="tl-tag">{cat.label}</div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!filtered.length && records.length > 0 && (
        <div className="empty timeline-empty">
          <div>No records match your search and filter.</div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery("");
              setFilter("all");
              setCaregiver("all");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      {!records.length && (
        <div className="empty">No records logged for {babyName} yet.</div>
      )}
      {selecting && (
        <div className="composer">
          <div
            className="composer-inner"
            style={{ justifyContent: "space-between" }}
          >
            {confirming ? (
              <>
                <div>
                  <span>
                    Delete {selected.size} record
                    {selected.size === 1 ? "" : "s"}? This can't be undone.
                  </span>
                  {deleteError && (
                    <div className="modal-error" role="alert">
                      {deleteError}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setConfirming(false);
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--warn)" }}
                    onClick={() => void deleteSelected()}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting…" : "Confirm delete"}
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
