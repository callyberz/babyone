import { useState } from "react";
import type { RoutineRecord } from "../types";
import { getCategory } from "../types";
import { Icon } from "./icons";

export function RecordModal({
  record,
  onClose,
  onSave,
  onDelete,
}: {
  record: RoutineRecord;
  onClose: () => void;
  onSave: (r: RoutineRecord) => void;
  onDelete: (id: number) => void;
}) {
  const [draft, setDraft] = useState<RoutineRecord>({ ...record });
  const cat = getCategory(draft.type);

  const setField = <K extends keyof RoutineRecord>(k: K, v: RoutineRecord[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const setMeta = (k: string, v: unknown) =>
    setDraft(
      (d) => ({ ...d, meta: { ...d.meta, [k]: v } }) as RoutineRecord,
    );

  const atDate = new Date(draft.at);
  const timeStr = `${String(atDate.getHours()).padStart(2, "0")}:${String(atDate.getMinutes()).padStart(2, "0")}`;
  const onTimeChange = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    const d = new Date(draft.at);
    d.setHours(h, m, 0, 0);
    setField("at", d.toISOString());
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="cluster">
            <div
              className="tl-ico"
              style={{
                background: `${cat.tint}22`,
                color: cat.tint,
                width: 32,
                height: 32,
                fontSize: 16,
                borderRadius: 9,
              }}
            >
              {cat.icon}
            </div>
            <h2>{cat.label}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>
            <Icon.close />
          </button>
        </div>

        <div className="modal-field">
          <label>Title</label>
          <input
            value={draft.title}
            onChange={(e) => setField("title", e.target.value)}
          />
        </div>

        <div className="modal-field">
          <label>Time</label>
          <input
            type="time"
            value={timeStr}
            onChange={(e) => onTimeChange(e.target.value)}
          />
        </div>
        {record.user?.displayName && (
          <div className="logged-by">Logged by {record.user.displayName}</div>
        )}

        {draft.type === "feed" && (
          <>
            <div className="modal-field">
              <label>Volume (oz)</label>
              <input
                type="number"
                step="0.5"
                value={(draft.meta?.volume_oz as number) ?? ""}
                onChange={(e) =>
                  setMeta("volume_oz", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="modal-field">
              <label>Side</label>
              <select
                value={(draft.meta?.side as string) ?? "bottle"}
                onChange={(e) => setMeta("side", e.target.value)}
              >
                <option value="bottle">Bottle</option>
                <option value="left">Left breast</option>
                <option value="right">Right breast</option>
                <option value="both">Both breasts</option>
              </select>
            </div>
          </>
        )}
        {draft.type === "sleep" && (
          <div className="modal-field">
            <label>Duration (min)</label>
            <input
              type="number"
              value={(draft.meta?.mins as number) ?? 0}
              onChange={(e) => setMeta("mins", parseInt(e.target.value) || 0)}
            />
          </div>
        )}
        {draft.type === "diaper" && (
          <div className="modal-field">
            <label>Kind</label>
            <select
              value={(draft.meta?.kind as string) ?? "wet"}
              onChange={(e) => setMeta("kind", e.target.value)}
            >
              <option value="wet">Wet</option>
              <option value="dirty">Dirty</option>
              <option value="both">Both</option>
            </select>
          </div>
        )}

        <div className="modal-field">
          <label>Notes</label>
          <textarea
            rows={3}
            value={draft.detail ?? ""}
            onChange={(e) => setField("detail", e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button
            className="btn btn-ghost"
            style={{ color: "var(--warn)" }}
            onClick={() => onDelete(draft.id)}
          >
            Delete
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
