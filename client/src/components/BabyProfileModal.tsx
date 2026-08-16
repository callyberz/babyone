import { useEffect, useRef, useState } from "react";
import { validateBaby } from "@babyone/contracts";
import type { Baby } from "../types";
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

export function BabyProfileModal({
  baby,
  onClose,
  onSave,
}: {
  baby: Baby;
  onClose: () => void;
  onSave: (baby: Baby) => Promise<void>;
}) {
  const [draft, setDraft] = useState(baby);
  const [weight, setWeight] = useState(
    baby.weightValue == null ? "" : String(baby.weightValue),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

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
        if (!saving) onClose();
        return;
      }
      keepFocusInDialog(event, dialogRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const candidate: Baby = {
    ...draft,
    weightValue: weight.trim() === "" ? null : Number(weight),
  };
  const today = new Date().toLocaleDateString("en-CA");
  const validation = validateBaby(candidate, today);
  const issues = validation.ok ? [] : validation.issues;
  const nameInvalid = issues.some((issue) => issue.startsWith("name"));
  const birthdateInvalid = issues.some((issue) =>
    issue.startsWith("birthdate"),
  );
  const weightInvalid = issues.some((issue) =>
    issue.startsWith("weightValue"),
  );

  const save = async () => {
    if (!validation.ok || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(validation.value);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the profile",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="baby-profile-modal-title"
        aria-describedby="baby-profile-modal-description"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="modal-h">
          <h2 id="baby-profile-modal-title">Baby profile</h2>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="Close baby profile"
            disabled={saving}
          >
            <Icon.close />
          </button>
        </div>
        <div className="modal-sub" id="baby-profile-modal-description">
          Keep age and handoff details accurate for every caregiver.
        </div>

        <div className="modal-field">
          <label htmlFor="baby-name">Name</label>
          <input
            id="baby-name"
            required
            autoFocus
            maxLength={60}
            aria-invalid={nameInvalid || undefined}
            aria-describedby={nameInvalid ? "baby-profile-validation" : undefined}
            value={draft.name}
            onChange={(event) =>
              setDraft((value) => ({ ...value, name: event.target.value }))
            }
          />
        </div>
        <div className="modal-field">
          <label htmlFor="baby-birthdate">Birthdate</label>
          <input
            id="baby-birthdate"
            type="date"
            required
            max={today}
            aria-invalid={birthdateInvalid || undefined}
            aria-describedby={
              birthdateInvalid ? "baby-profile-validation" : undefined
            }
            value={draft.birthdate}
            onChange={(event) =>
              setDraft((value) => ({ ...value, birthdate: event.target.value }))
            }
          />
        </div>
        <div className="modal-field">
          <label htmlFor="baby-weight">Current weight (optional)</label>
          <div className="field-row">
            <input
              id="baby-weight"
              type="number"
              min="0.01"
              max="999.99"
              step="0.01"
              inputMode="decimal"
              placeholder="Not recorded"
              aria-invalid={weightInvalid || undefined}
              aria-describedby={
                weightInvalid ? "baby-profile-validation" : undefined
              }
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
            <select
              aria-label="Weight unit"
              value={draft.weightUnit}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  weightUnit: event.target.value as Baby["weightUnit"],
                }))
              }
            >
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="modal-error" role="alert">
            {error}
          </div>
        )}
        {!validation.ok && (
          <div
            className="modal-hint"
            id="baby-profile-validation"
            aria-live="polite"
          >
            {validation.issues[0]}
          </div>
        )}

        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!validation.ok || saving}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
