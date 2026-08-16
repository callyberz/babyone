import {
  MAX_RECORD_DETAIL_LENGTH,
  MAX_RECORD_QUANTITY,
  MAX_RECORD_TITLE_LENGTH,
  validateRecordDraft,
} from "@babyone/contracts";
import { useEffect, useRef, useState } from "react";
import type { RoutineRecord } from "../types";
import { getCategory } from "../types";
import { Icon } from "./icons";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function keepFocusInDialog(
  event: KeyboardEvent,
  dialog: HTMLElement | null,
): void {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!dialog.contains(active) || !focusable.includes(active as HTMLElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

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
  const initialDate = new Date(record.at);
  const [time, setTime] = useState(
    `${String(initialDate.getHours()).padStart(2, "0")}:${String(initialDate.getMinutes()).padStart(2, "0")}`,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const cat = getCategory(draft.type);
  const busy = saving || deleting;

  useEffect(
    () => () => {
      returnFocusRef.current?.focus();
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onClose();
        return;
      }
      keepFocusInDialog(event, dialogRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const setField = <K extends keyof RoutineRecord>(k: K, v: RoutineRecord[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const setMeta = (k: string, v: unknown) =>
    setDraft(
      (d) => ({ ...d, meta: { ...d.meta, [k]: v } }) as RoutineRecord,
    );

  const timeValid = /^\d{2}:\d{2}$/.test(time);
  const validation = validateRecordDraft(draft);
  const issues = validation.ok ? [] : validation.issues;
  const titleInvalid = issues.some((issue) => issue.startsWith("title"));
  const detailInvalid = issues.some((issue) => issue.startsWith("detail"));
  const quantityInvalid = issues.some(
    (issue) =>
      issue.startsWith("meta.volume_oz") || issue.startsWith("meta.mins"),
  );
  const formValid = timeValid && validation.ok;

  const onTimeChange = (value: string) => {
    setTime(value);
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    const [hours, minutes] = value.split(":").map(Number);
    const date = new Date(draft.at);
    date.setHours(hours, minutes, 0, 0);
    if (!Number.isNaN(date.getTime())) setField("at", date.toISOString());
  };

  const save = async () => {
    if (!timeValid || !validation.ok || busy) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...validation.value,
        id: draft.id,
        user: draft.user,
      } as RoutineRecord);
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

  const setOptionalNumber = (key: string, value: string) => {
    setMeta(key, value === "" ? undefined : Number(value));
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-modal-title"
        aria-describedby="record-modal-description"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmingDelete) void save();
        }}
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
              aria-hidden="true"
            >
              {cat.icon}
            </div>
            <h2 id="record-modal-title">Edit {cat.label.toLowerCase()}</h2>
          </div>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="Close record editor"
            disabled={busy}
          >
            <Icon.close />
          </button>
        </div>
        <div className="modal-sub" id="record-modal-description">
          Update the details for this {cat.label.toLowerCase()} record.
        </div>

        <div className="modal-field">
          <label htmlFor="record-title">Title</label>
          <input
            id="record-title"
            required
            autoFocus
            maxLength={MAX_RECORD_TITLE_LENGTH}
            aria-invalid={titleInvalid || undefined}
            aria-describedby={titleInvalid ? "record-modal-validation" : undefined}
            value={draft.title}
            onChange={(event) => setField("title", event.target.value)}
          />
        </div>

        <div className="modal-field">
          <label htmlFor="record-time">Time</label>
          <input
            id="record-time"
            type="time"
            required
            aria-invalid={!timeValid || undefined}
            aria-describedby={!timeValid ? "record-modal-validation" : undefined}
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
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
                min="0"
                max={MAX_RECORD_QUANTITY}
                step="any"
                inputMode="decimal"
                aria-invalid={quantityInvalid || undefined}
                aria-describedby={
                  quantityInvalid ? "record-modal-validation" : undefined
                }
                value={(draft.meta?.volume_oz as number | undefined) ?? ""}
                onChange={(event) =>
                  setOptionalNumber("volume_oz", event.target.value)
                }
              />
            </div>
            <div className="modal-field">
              <label htmlFor="record-side">Side</label>
              <select
                id="record-side"
                value={(draft.meta?.side as string) ?? "bottle"}
                onChange={(event) => setMeta("side", event.target.value)}
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
              min="0"
              max={MAX_RECORD_QUANTITY}
              step="any"
              inputMode="decimal"
              aria-invalid={quantityInvalid || undefined}
              aria-describedby={
                quantityInvalid ? "record-modal-validation" : undefined
              }
              value={(draft.meta?.mins as number | undefined) ?? ""}
              onChange={(event) =>
                setOptionalNumber("mins", event.target.value)
              }
            />
          </div>
        )}
        {draft.type === "diaper" && (
          <div className="modal-field">
            <label htmlFor="record-kind">Kind</label>
            <select
              id="record-kind"
              value={(draft.meta?.kind as string) ?? "wet"}
              onChange={(event) => setMeta("kind", event.target.value)}
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
            maxLength={MAX_RECORD_DETAIL_LENGTH}
            aria-invalid={detailInvalid || undefined}
            aria-describedby={detailInvalid ? "record-modal-validation" : undefined}
            value={draft.detail ?? ""}
            onChange={(event) => setField("detail", event.target.value)}
          />
        </div>

        {error && (
          <div className="modal-error" role="alert">
            {error}
          </div>
        )}
        {!formValid && (
          <div
            className="modal-hint"
            id="record-modal-validation"
            aria-live="polite"
          >
            {!timeValid ? "time is required" : issues[0]}
          </div>
        )}

        <div className="modal-foot">
          {confirmingDelete ? (
            <div className="delete-confirm">
              <span>Delete this record?</span>
              <button
                className="btn"
                type="button"
                autoFocus
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Keep it
              </button>
              <button
                className="btn btn-ghost"
                type="button"
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
                type="button"
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
              <button className="btn" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !formValid}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
