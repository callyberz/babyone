import { useState } from "react";
import { useResetPassword } from "./useAuth";

function resetCode(): string {
  return new URLSearchParams(window.location.search).get("code") ?? "";
}

function resetError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "invalid_reset") {
    return "This reset link is invalid or has expired. Ask your administrator for a new one.";
  }
  if (error.message === "weak_password") {
    return "Use a password with at least 8 characters.";
  }
  return error.message;
}

export function ResetPasswordPage() {
  const reset = useResetPassword();
  const [code] = useState(resetCode);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch = confirmation.length > 0 && password !== confirmation;

  if (!code) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Reset link required</h1>
          <p>
            Ask your household administrator for a fresh password reset link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        <p>This one-time link will sign out your other devices.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) return;
            reset.mutate({ code, password });
          }}
        >
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "password-mismatch" : undefined}
            />
          </label>
          {mismatch && (
            <div id="password-mismatch" className="auth-error" role="alert">
              Passwords do not match.
            </div>
          )}
          {reset.error && (
            <div className="auth-error" role="alert">
              {resetError(reset.error)}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={reset.isPending || mismatch || password.length < 8}
          >
            {reset.isPending ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
    </div>
  );
}
