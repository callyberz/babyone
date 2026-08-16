import { useId, useState } from "react";
import { useChangePassword } from "./useAuth";

export function PasswordPanel() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formId = useId();
  const currentId = useId();
  const nextId = useId();
  const confirmationId = useId();
  const change = useChangePassword();

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setValidationError(null);
    change.reset();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError(null);
    setSuccess(null);
    if (newPassword.length < 8) {
      setValidationError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmation) {
      setValidationError("New passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setValidationError("Choose a password different from the current one.");
      return;
    }
    try {
      const result = await change.mutateAsync({
        currentPassword,
        newPassword,
      });
      setSuccess(
        result.revokedSessions === 0
          ? "Password changed. This device remains signed in."
          : `Password changed. Signed out ${result.revokedSessions} other ${result.revokedSessions === 1 ? "device" : "devices"}.`,
      );
      resetForm();
      setOpen(false);
    } catch {
      // The server error remains visible so the caregiver can correct it.
    }
  };

  return (
    <div className="caregiver-access password-panel">
      <button
        className="btn btn-small"
        type="button"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          setSuccess(null);
          if (open) resetForm();
          setOpen((value) => !value);
        }}
      >
        Change my password
      </button>
      {open && (
        <form id={formId} className="caregiver-access-list" onSubmit={submit}>
          <label htmlFor={currentId}>Current password</label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={currentPassword}
            disabled={change.isPending}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor={nextId}>New password</label>
          <input
            id={nextId}
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={256}
            value={newPassword}
            disabled={change.isPending}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <label htmlFor={confirmationId}>Confirm new password</label>
          <input
            id={confirmationId}
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={256}
            value={confirmation}
            disabled={change.isPending}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {(validationError || change.error) && (
            <div className="auth-error" role="alert">
              {validationError ?? (change.error as Error).message}
            </div>
          )}
          <div className="profile-actions">
            <button
              className="btn btn-small"
              type="submit"
              disabled={
                change.isPending ||
                !currentPassword ||
                !newPassword ||
                !confirmation
              }
            >
              {change.isPending ? "Changing…" : "Change password"}
            </button>
            <button
              className="btn btn-small"
              type="button"
              disabled={change.isPending}
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {success && <div role="status">{success}</div>}
    </div>
  );
}
