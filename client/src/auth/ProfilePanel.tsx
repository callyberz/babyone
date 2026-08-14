import { useEffect, useId, useState } from "react";
import type { User } from "@babyone/contracts";
import { useUpdateProfile } from "./useAuth";

export function ProfilePanel({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [saved, setSaved] = useState(false);
  const formId = useId();
  const inputId = useId();
  const update = useUpdateProfile();

  useEffect(() => setDisplayName(user.displayName), [user.displayName]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaved(false);
    try {
      await update.mutateAsync(displayName);
      setSaved(true);
      setOpen(false);
    } catch {
      // The mutation error remains visible below for a corrected retry.
    }
  };

  return (
    <div className="caregiver-access profile-panel">
      <button
        className="btn btn-small"
        type="button"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          setSaved(false);
          update.reset();
          setDisplayName(user.displayName);
          setOpen((value) => !value);
        }}
      >
        Edit my profile
      </button>
      {open && (
        <form id={formId} className="caregiver-access-list" onSubmit={submit}>
          <label htmlFor={inputId}>Display name</label>
          <input
            id={inputId}
            value={displayName}
            maxLength={80}
            autoComplete="name"
            disabled={update.isPending}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <div className="profile-actions">
            <button
              className="btn btn-small"
              type="submit"
              disabled={update.isPending || !displayName.trim()}
            >
              {update.isPending ? "Saving…" : "Save name"}
            </button>
            <button
              className="btn btn-small"
              type="button"
              disabled={update.isPending}
              onClick={() => {
                update.reset();
                setDisplayName(user.displayName);
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {saved && <div role="status">Profile updated.</div>}
      {update.error && (
        <div className="auth-error" role="alert">
          {(update.error as Error).message}
        </div>
      )}
    </div>
  );
}
