import { useState } from "react";
import type { RoutineRecordDraft } from "@babyone/contracts";
import { useCreateRecord } from "../queries";
import { categories } from "../types";
import { Icon } from "./icons";

type QuickKind = "bottle" | "nursing" | "sleep" | "play";

const actions = [
  { kind: "bottle" as const, label: "Bottle", icon: categories.feed.icon },
  { kind: "nursing" as const, label: "Nursing", icon: "🤱" },
  { kind: "wet" as const, label: "Wet diaper", icon: "💧" },
  { kind: "dirty" as const, label: "Dirty diaper", icon: "💩" },
  { kind: "sleep" as const, label: "Sleep", icon: categories.sleep.icon },
  { kind: "play" as const, label: "Tummy time", icon: categories.play.icon },
];

export function QuickLog({ babyName }: { babyName: string }) {
  const create = useCreateRecord();
  const [editing, setEditing] = useState<QuickKind | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const save = async (record: RoutineRecordDraft, message: string) => {
    await create.mutateAsync(record);
    setEditing(null);
    setFeedback(message);
  };

  const logDiaper = async (kind: "wet" | "dirty") => {
    setFeedback(null);
    try {
      await save(
        {
          type: "diaper",
          at: new Date().toISOString(),
          title: `Diaper — ${kind}`,
          detail: "",
          meta: { kind },
        },
        `${kind === "wet" ? "Wet" : "Dirty"} diaper logged just now.`,
      );
    } catch {
      // The shared mutation error is rendered below.
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
            disabled={create.isPending}
            onClick={() => {
              create.reset();
              setFeedback(null);
              if (action.kind === "wet" || action.kind === "dirty") {
                void logDiaper(action.kind);
              } else {
                setEditing(action.kind);
              }
            }}
          >
            <span>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>
      {feedback && <div className="quick-feedback">{feedback}</div>}
      {create.error && !feedback && (
        <div className="modal-error">{(create.error as Error).message}</div>
      )}
      {editing && (
        <QuickLogModal
          kind={editing}
          babyName={babyName}
          saving={create.isPending}
          error={create.error instanceof Error ? create.error.message : null}
          onClose={() => setEditing(null)}
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
  kind: QuickKind;
  babyName: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (record: RoutineRecordDraft, message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(kind === "bottle" ? "3" : kind === "play" ? "5" : kind === "sleep" ? "45" : "15");
  const [side, setSide] = useState<"left" | "right" | "both">("both");
  const [where, setWhere] = useState("");
  const [notes, setNotes] = useState("");
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  const build = (): { record: RoutineRecordDraft; message: string } => {
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

  const heading = {
    bottle: "Log a bottle",
    nursing: "Log nursing",
    sleep: "Log sleep",
    play: "Log tummy time",
  }[kind];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-h">
          <h2>{heading}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon.close />
          </button>
        </div>
        <div className="modal-sub">This will be logged for {babyName} at the current time.</div>

        <div className="modal-field">
          <label htmlFor="quick-amount">{kind === "bottle" ? "Volume (oz)" : "Duration (minutes)"}</label>
          <input
            id="quick-amount"
            type="number"
            min="0.1"
            step={kind === "bottle" ? "0.5" : "1"}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            autoFocus
          />
        </div>
        {kind === "nursing" && (
          <div className="modal-field">
            <label htmlFor="quick-side">Side</label>
            <select id="quick-side" value={side} onChange={(event) => setSide(event.target.value as typeof side)}>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="both">Both</option>
            </select>
          </div>
        )}
        {kind === "sleep" && (
          <div className="modal-field">
            <label htmlFor="quick-where">Where (optional)</label>
            <input id="quick-where" placeholder="Bassinet, crib, contact…" value={where} onChange={(event) => setWhere(event.target.value)} />
          </div>
        )}
        <div className="modal-field">
          <label htmlFor="quick-notes">Notes (optional)</label>
          <textarea id="quick-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!valid || saving}
            onClick={() => {
              const value = build();
              void onSave(value.record, value.message).catch(() => undefined);
            }}
          >
            {saving ? "Logging…" : "Log now"}
          </button>
        </div>
      </div>
    </div>
  );
}
