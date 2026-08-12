import { useState } from "react";
import { validateBaby } from "@babyone/contracts";
import type { Baby } from "../types";
import { Icon } from "./icons";

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

  const candidate: Baby = {
    ...draft,
    weightValue: weight.trim() === "" ? null : Number(weight),
  };
  const validation = validateBaby(
    candidate,
    new Date().toLocaleDateString("en-CA"),
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-h">
          <h2>Baby profile</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon.close />
          </button>
        </div>
        <div className="modal-sub">
          Keep age and handoff details accurate for every caregiver.
        </div>

        <div className="modal-field">
          <label htmlFor="baby-name">Name</label>
          <input
            id="baby-name"
            maxLength={60}
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
            max={new Date().toLocaleDateString("en-CA")}
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
              max="999"
              step="0.01"
              placeholder="Not recorded"
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

        {error && <div className="modal-error">{error}</div>}
        {!validation.ok && <div className="modal-hint">{validation.issues[0]}</div>}

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={!validation.ok || saving}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
