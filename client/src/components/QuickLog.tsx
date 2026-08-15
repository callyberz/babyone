import { useEffect, useState } from "react";
import type { RoutineRecordDraft } from "@babyone/contracts";
import { useCreateRecord, useDeleteRecord } from "../queries";
import { createRequestId } from "../requestId";
import { categories } from "../types";
import { Icon } from "./icons";

type ModalKind = "bottle" | "nursing" | "sleep" | "play" | "meds";
type InstantKind = "wet" | "dirty" | "happy" | "fussy";
type QuickKind = ModalKind | InstantKind;

interface QuickAttempt {
  record: RoutineRecordDraft;
  message: string;
  requestId: string;
}

interface InstantAttempt extends QuickAttempt {
  kind: InstantKind;
}

const actions: Array<{
  kind: QuickKind;
  label: string;
  icon: string;
}> = [
  { kind: "bottle", label: "Bottle", icon: categories.feed.icon },
  { kind: "nursing", label: "Nursing", icon: "🤱" },
  { kind: "wet", label: "Wet diaper", icon: "💧" },
  { kind: "dirty", label: "Dirty diaper", icon: "💩" },
  { kind: "sleep", label: "Sleep", icon: categories.sleep.icon },
  { kind: "play", label: "Tummy time", icon: categories.play.icon },
  { kind: "meds", label: "Medication", icon: categories.meds.icon },
  { kind: "happy", label: "Happy", icon: "😊" },
  { kind: "fussy", label: "Fussy", icon: "😣" },
];

const isInstantKind = (kind: QuickKind): kind is InstantKind =>
  kind === "wet" ||
  kind === "dirty" ||
  kind === "happy" ||
  kind === "fussy";

const makeInstantAttempt = (kind: InstantKind): InstantAttempt => {
  const at = new Date().toISOString();
  if (kind === "wet" || kind === "dirty") {
    const label = kind === "wet" ? "Wet" : "Dirty";
    return {
      kind,
      requestId: createRequestId(),
      record: {
        type: "diaper",
        at,
        title: `Diaper — ${kind}`,
        detail: "",
        meta: { kind },
      },
      message: `${label} diaper logged just now.`,
    };
  }

  const happy = kind === "happy";
  return {
    kind,
    requestId: createRequestId(),
    record: {
      type: "mood",
      at,
      title: happy ? "Happy mood" : "Fussy spell",
      detail: "",
      meta: { kind },
    },
    message: `${happy ? "Happy" : "Fussy"} mood logged just now.`,
  };
};

export function QuickLog({ babyName }: { babyName: string }) {
  const create = useCreateRecord();
  const remove = useDeleteRecord();
  const [editing, setEditing] = useState<ModalKind | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [instantAttempt, setInstantAttempt] =
    useState<InstantAttempt | null>(null);
  const [lastQuickLog, setLastQuickLog] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const busy = create.isPending || remove.isPending;

  const save = async ({ record, message, requestId }: QuickAttempt) => {
    const created = await create.mutateAsync({ record, requestId });
    setEditing(null);
    setInstantAttempt(null);
    setLastQuickLog({ id: created.id, title: created.title });
    setFeedback(message);
  };

  const logInstant = async (kind: InstantKind) => {
    const attempt =
      instantAttempt?.kind === kind
        ? instantAttempt
        : makeInstantAttempt(kind);
    setInstantAttempt(attempt);
    try {
      await save(attempt);
    } catch {
      // Keep the exact attempt so an explicit retry remains idempotent. The
      // shared mutation error is rendered below.
    }
  };

  const undoLast = async () => {
    const target = lastQuickLog;
    if (!target || busy) return;
    remove.reset();
    setFeedback(null);
    try {
      await remove.mutateAsync(target.id);
      setLastQuickLog((current) =>
        current?.id === target.id ? null : current,
      );
      setFeedback(`${target.title} removed.`);
    } catch {
      // Keep the undo target available so the caregiver can retry.
    }
  };

  return (
    <div className="panel quick-log-panel">
      <div className="panel-h">
        <div>
          <h3>Quick log</h3>
          <div className="panel-sub">Save the common stuff without typing.</div>
        </div>
      </div>
      <div className="quick-actions">
        {actions.map((action) => (
          <button
            className="quick-action"
            key={action.kind}
            type="button"
            disabled={busy}
            onClick={() => {
              create.reset();
              remove.reset();
              setFeedback(null);
              if (isInstantKind(action.kind)) {
                void logInstant(action.kind);
              } else {
                setInstantAttempt(null);
                setEditing(action.kind);
              }
            }}
          >
            <span aria-hidden="true">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>
      {(feedback || lastQuickLog || (create.isPending && !editing)) && (
        <div className="quick-feedback" role="status" aria-live="polite">
          <span>
            {remove.isPending
              ? "Removing the last quick log…"
              : create.isPending && !editing
                ? "Logging…"
                : feedback}
          </span>
          {lastQuickLog && (
            <button
              className="quick-undo"
              type="button"
              disabled={busy}
              aria-label={`Undo ${lastQuickLog.title}`}
              onClick={() => void undoLast()}
            >
              {remove.isPending ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      )}
      {create.error && !editing && (
        <div className="modal-error" role="alert">
          {(create.error as Error).message}
        </div>
      )}
      {remove.error && (
        <div className="modal-error" role="alert">
          {(remove.error as Error).message}
        </div>
      )}
      {editing && (
        <QuickLogModal
          kind={editing}
          babyName={babyName}
          saving={create.isPending}
          error={create.error instanceof Error ? create.error.message : null}
          onClose={() => {
            if (!create.isPending) setEditing(null);
          }}
          onSave={save}
        />
      )}
    </div>
  );
}

function QuickLogModal({
  kind,
  babyName,
  saving,
  error,
  onClose,
  onSave,
}: {
  kind: ModalKind;
  babyName: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (attempt: QuickAttempt) => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    kind === "bottle"
      ? "3"
      : kind === "play"
        ? "5"
        : kind === "sleep"
          ? "45"
          : "15",
  );
  const [side, setSide] = useState<"left" | "right" | "both">("both");
  const [where, setWhere] = useState("");
  const [medication, setMedication] = useState("");
  const [dose, setDose] = useState("");
  const [notes, setNotes] = useState("");
  const [attempt, setAttempt] = useState<QuickAttempt | null>(null);
  const value = Number(amount);
  const valid =
    kind === "meds"
      ? medication.trim().length > 0
      : Number.isFinite(value) && value > 0;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const changed = (update: () => void) => {
    setAttempt(null);
    update();
  };

  const build = (): Omit<QuickAttempt, "requestId"> => {
    const at = new Date().toISOString();
    if (kind === "bottle") {
      return {
        record: {
          type: "feed",
          at,
          title: `Bottle — ${value} oz`,
          detail: notes,
          meta: { volume_oz: value, side: "bottle" },
        },
        message: `${value} oz bottle logged just now.`,
      };
    }
    if (kind === "nursing") {
      return {
        record: {
          type: "feed",
          at,
          title: `Breastfed — ${value} min ${side}`,
          detail: notes,
          meta: { mins: value, side },
        },
        message: `${value}-minute nursing session logged just now.`,
      };
    }
    if (kind === "sleep") {
      return {
        record: {
          type: "sleep",
          at,
          title: `Sleep — ${value} min`,
          detail: notes,
          meta: { mins: value, where: where.trim() || null },
        },
        message: `${value} minutes of sleep logged just now.`,
      };
    }
    if (kind === "meds") {
      const name = medication.trim();
      return {
        record: {
          type: "meds",
          at,
          title: name,
          detail: notes,
          meta: { name, dose: dose.trim() },
        },
        message: `${name} logged just now.`,
      };
    }
    return {
      record: {
        type: "play",
        at,
        title: `Tummy time — ${value} min`,
        detail: notes,
        meta: { mins: value },
      },
      message: `${value} minutes of tummy time logged just now.`,
    };
  };

  const submit = () => {
    if (!valid || saving) return;
    const next =
      attempt ?? { ...build(), requestId: createRequestId() };
    setAttempt(next);
    void onSave(next).catch(() => undefined);
  };

  const heading = {
    bottle: "Log a bottle",
    nursing: "Log nursing",
    sleep: "Log sleep",
    play: "Log tummy time",
    meds: "Log medication",
  }[kind];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-log-modal-title"
        aria-describedby="quick-log-modal-description"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="modal-h">
          <h2 id="quick-log-modal-title">{heading}</h2>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="Close quick log"
            disabled={saving}
          >
            <Icon.close />
          </button>
        </div>
        <div className="modal-sub" id="quick-log-modal-description">
          This will be logged for {babyName} at the current time.
        </div>

        {kind === "meds" ? (
          <>
            <div className="modal-field">
              <label htmlFor="quick-medication">Medication</label>
              <input
                id="quick-medication"
                value={medication}
                maxLength={200}
                onChange={(event) =>
                  changed(() => setMedication(event.target.value))
                }
                placeholder="Vitamin D, acetaminophen…"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="modal-field">
              <label htmlFor="quick-dose">Dose (optional)</label>
              <input
                id="quick-dose"
                value={dose}
                maxLength={500}
                onChange={(event) => changed(() => setDose(event.target.value))}
                placeholder="1 drop, 2.5 mL…"
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <div className="modal-field">
            <label htmlFor="quick-amount">
              {kind === "bottle" ? "Volume (oz)" : "Duration (minutes)"}
            </label>
            <input
              id="quick-amount"
              type="number"
              min="0.1"
              step={kind === "bottle" ? "0.5" : "1"}
              value={amount}
              onChange={(event) => changed(() => setAmount(event.target.value))}
              autoFocus
            />
          </div>
        )}
        {kind === "nursing" && (
          <div className="modal-field">
            <label htmlFor="quick-side">Side</label>
            <select
              id="quick-side"
              value={side}
              onChange={(event) =>
                changed(() => setSide(event.target.value as typeof side))
              }
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="both">Both</option>
            </select>
          </div>
        )}
        {kind === "sleep" && (
          <div className="modal-field">
            <label htmlFor="quick-where">Where (optional)</label>
            <input
              id="quick-where"
              placeholder="Bassinet, crib, contact…"
              value={where}
              maxLength={500}
              onChange={(event) => changed(() => setWhere(event.target.value))}
            />
          </div>
        )}
        <div className="modal-field">
          <label htmlFor="quick-notes">Notes (optional)</label>
          <textarea
            id="quick-notes"
            rows={2}
            value={notes}
            maxLength={4000}
            onChange={(event) => changed(() => setNotes(event.target.value))}
          />
        </div>
        {error && (
          <div className="modal-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!valid || saving}
          >
            {saving ? "Logging…" : error && attempt ? "Retry log" : "Log now"}
          </button>
        </div>
      </form>
    </div>
  );
}
