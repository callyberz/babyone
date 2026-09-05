import { useId, useState } from "react";
import {
  useCreateInvite,
  usePendingInvites,
  useRevokeInvite,
} from "./useAuth";

const formatExpiry = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export function InvitePanel() {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const create = useCreateInvite();
  const pendingInvites = usePendingInvites(open);
  const revoke = useRevokeInvite();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const [revokedMessage, setRevokedMessage] = useState<string>();
  const createdInvite = create.data;

  const generateInvite = async () => {
    setCopied(false);
    setCopyError(undefined);
    setRevokedMessage(undefined);
    try {
      await create.mutateAsync();
      setOpen(true);
    } catch {
      // The mutation's error is rendered below.
    }
  };

  const copyInvite = async () => {
    if (!createdInvite) return;
    setCopyError(undefined);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(createdInvite.url);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Could not copy the invite link. Select and copy it manually.");
    }
  };

  const revokeInvite = async (id: string) => {
    setRevokedMessage(undefined);
    try {
      await revoke.mutateAsync(id);
      if (create.data?.id === id) {
        create.reset();
        setCopied(false);
      }
      setRevokedMessage("Invite revoked.");
    } catch {
      // The mutation's error is rendered below.
    }
  };

  return (
    <section className="invite-panel" aria-label="Caregiver invitations">
      <button
        className="btn"
        type="button"
        onClick={() => void generateInvite()}
        disabled={create.isPending}
      >
        {create.isPending ? "Generating…" : "Invite caregiver"}
      </button>
      {createdInvite && (
        <div className="invite-result" aria-live="polite">
          <code>{createdInvite.url}</code>
          <button
            className="btn btn-small"
            type="button"
            onClick={() => void copyInvite()}
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
          <div className="invite-hint">
            Expires{" "}
            <time dateTime={createdInvite.expiresAt}>
              {formatExpiry(createdInvite.expiresAt)}
            </time>
          </div>
          {copyError && (
            <div className="auth-error" role="alert">
              {copyError}
            </div>
          )}
        </div>
      )}
      {create.error && (
        <div className="auth-error" role="alert">
          {(create.error as Error).message}
        </div>
      )}

      <button
        className="btn btn-small"
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide pending invites" : "Manage pending invites"}
      </button>
      {open && (
        <div className="pending-invites" id={listId}>
          <h3>Pending invites</h3>
          {pendingInvites.isLoading && (
            <div className="invite-hint" role="status">
              Loading pending invites…
            </div>
          )}
          {pendingInvites.error && (
            <div className="auth-error" role="alert">
              {(pendingInvites.error as Error).message}
            </div>
          )}
          {pendingInvites.data?.length === 0 && (
            <div className="invite-hint">No pending invites.</div>
          )}
          {pendingInvites.data && pendingInvites.data.length > 0 && (
            <ul
              className="pending-invite-list"
              aria-label="Pending caregiver invites"
            >
              {pendingInvites.data.map((invite) => {
                const expiry = formatExpiry(invite.expiresAt);
                const revoking =
                  revoke.isPending && revoke.variables === invite.id;
                return (
                  <li className="pending-invite-row" key={invite.id}>
                    <div>
                      <strong>Created by {invite.createdBy.displayName}</strong>
                      <span>
                        Expires{" "}
                        <time dateTime={invite.expiresAt}>{expiry}</time>
                      </span>
                    </div>
                    <button
                      className="btn btn-small"
                      type="button"
                      aria-label={`Revoke invite created by ${invite.createdBy.displayName}, expiring ${expiry}`}
                      disabled={revoke.isPending}
                      onClick={() => void revokeInvite(invite.id)}
                    >
                      {revoking ? "Revoking…" : "Revoke"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {revokedMessage && <div role="status">{revokedMessage}</div>}
          {revoke.error && (
            <div className="auth-error" role="alert">
              {(revoke.error as Error).message}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
