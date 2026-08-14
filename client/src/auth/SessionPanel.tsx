import { useId, useState } from "react";
import type { AuthSession } from "../api";
import { useRevokeSession, useSessions } from "./useAuth";

function deviceName(userAgent: string): string {
  if (!userAgent) return "Unknown browser";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /CriOS\//.test(userAgent)
        ? "Chrome"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const device = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh|Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return device ? `${browser} on ${device}` : browser;
}

function signedInLabel(session: AuthSession): string {
  const value = new Date(session.createdAt);
  return Number.isNaN(value.getTime())
    ? "Sign-in time unavailable"
    : `Signed in ${value.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year:
          value.getFullYear() === new Date().getFullYear()
            ? undefined
            : "numeric",
      })}`;
}

export function SessionPanel() {
  const [open, setOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const listId = useId();
  const sessions = useSessions(open);
  const revoke = useRevokeSession();

  const revokeSession = async (session: AuthSession) => {
    try {
      await revoke.mutateAsync(session.id);
      setConfirmingId(null);
    } catch {
      // The mutation error remains visible below so the action can be retried.
    }
  };

  return (
    <div className="caregiver-access session-panel">
      <button
        className="btn btn-small"
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        Signed-in devices
      </button>
      {open && (
        <div id={listId} className="caregiver-access-list">
          {sessions.isLoading && <div role="status">Loading devices…</div>}
          {sessions.error && (
            <div className="auth-error" role="alert">
              {(sessions.error as Error).message}
            </div>
          )}
          {sessions.data?.map((session) => (
            <div className="caregiver-access-row" key={session.id}>
              <div>
                <strong>
                  {deviceName(session.userAgent)}
                  {session.current ? " · This device" : ""}
                </strong>
                <span>{signedInLabel(session)}</span>
              </div>
              {!session.current &&
                (confirmingId === session.id ? (
                  <div className="session-revoke-confirm">
                    <span>Sign out this device?</span>
                    <button
                      className="btn btn-small"
                      type="button"
                      disabled={revoke.isPending}
                      onClick={() => void revokeSession(session)}
                    >
                      {revoke.isPending ? "Signing out…" : "Confirm"}
                    </button>
                    <button
                      className="btn btn-small"
                      type="button"
                      disabled={revoke.isPending}
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-small"
                    type="button"
                    aria-label={`Sign out ${deviceName(session.userAgent)}`}
                    onClick={() => {
                      revoke.reset();
                      setConfirmingId(session.id);
                    }}
                  >
                    Sign out
                  </button>
                ))}
            </div>
          ))}
          {sessions.data?.length === 0 && <div>No active devices found.</div>}
          {revoke.error && (
            <div className="auth-error" role="alert">
              {(revoke.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
