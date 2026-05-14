import { useState } from "react";
import { BabyInputSchema, type Baby } from "@babyone/shared";
import { Icon } from "./icons";

const validate = (b: Baby): string | null => {
  const result = BabyInputSchema.safeParse(b);
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid");
};

export function BabyProfileModal({
  baby,
  onClose,
  onSave,
}: {
  baby: Baby;
  onClose: () => void;
  onSave: (b: Baby) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Baby>({ ...baby });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof Baby>(k: K, v: Baby[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const onSubmit = async () => {
    const v = validate(draft);
    if (v) {
      setErr(v);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>Edit baby</h2>
          <button className="modal-close" onClick={onClose}>
            <Icon.close />
          </button>
        </div>

        <div className="modal-field">
          <label>Name</label>
          <input
            value={draft.name}
            onChange={(e) => setField("name", e.target.value)}
            maxLength={60}
          />
        </div>

        <div className="modal-field">
          <label>Birthdate</label>
          <input
            type="date"
            value={draft.birthdate}
            onChange={(e) => setField("birthdate", e.target.value)}
          />
        </div>

        <div className="modal-field">
          <label>Weight</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              step="0.1"
              min="0"
              value={
                Number.isFinite(draft.weightValue) ? draft.weightValue : ""
              }
              onChange={(e) =>
                setField("weightValue", parseFloat(e.target.value))
              }
              style={{ flex: 1 }}
            />
            <select
              value={draft.weightUnit}
              onChange={(e) =>
                setField("weightUnit", e.target.value as "lb" | "kg")
              }
            >
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>

        {err && (
          <div className="modal-field" style={{ color: "var(--warn)" }}>
            {err}
          </div>
        )}

        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={saving || validate(draft) !== null}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
