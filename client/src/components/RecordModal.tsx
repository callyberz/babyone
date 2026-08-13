import { useEffect, useState } from "react";
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
  onSave: (r: RoutineRecord) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RoutineRecord>({ ...record });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cat = getCategory(draft.type);
  const busy = saving || deleting;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

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

  const save = async () => {
    if (busy) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this record");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(draft.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this record",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
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
            <h2 id="record-modal-title">Edit {cat.label.toLowerCase()}</h2>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <Icon.close />
          </button>
        </div>

        <div className="modal-field">
          <label htmlFor="record-title">Title</label>
          <input
            id="record-title"
            value={draft.title}
            onChange={(e) => setField("title", e.target.value)}
          />
        </div>

        <div className="modal-field">
          <label htmlFor="record-time">Time</label>
          <input
            id="record-time"
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
              <label htmlFor="record-volume">Volume (oz)</label>
              <input
                id="record-volume"
                type="number"
                step="0.5"
                value={(draft.meta?.volume_oz as number) ?? ""}
                onChange={(e) =>
                  setMeta("volume_oz", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="modal-field">
              <label htmlFor="record-side">Side</label>
              <select
                id="record-side"
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
            <label htmlFor="record-duration">Duration (min)</label>
            <input
              id="record-duration"
              type="number"
              value={(draft.meta?.mins as number) ?? 0}
              onChange={(e) => setMeta("mins", parseInt(e.target.value) || 0)}
            />
          </div>
        )}
        {draft.type === "diaper" && (
          <div className="modal-field">
            <label htmlFor="record-kind">Kind</label>
            <select
              id="record-kind"
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
          <label htmlFor="record-notes">Notes</label>
          <textarea
            id="record-notes"
            rows={3}
            value={draft.detail ?? ""}
            onChange={(e) => setField("detail", e.target.value)}
          />
        </div>

        {error && (
          <div className="modal-error" role="alert">
            {error}
          </div>
        )}

        <div className="modal-foot">
          {confirmingDelete ? (
            <div className="delete-confirm">
              <span>Delete this record?</span>
              <button
                className="btn"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Keep it
              </button>
              <button
                className="btn btn-ghost"
                style={{ color: "var(--warn)" }}
                onClick={() => void remove()}
                disabled={busy}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                style={{ color: "var(--warn)" }}
                onClick={() => {
                  setError(null);
                  setConfirmingDelete(true);
                }}
                disabled={busy}
              >
                Delete
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void save()}
                disabled={busy || draft.title.trim() === ""}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
