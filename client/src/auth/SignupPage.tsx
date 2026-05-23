import { useState } from "react";
import { useSignup } from "./useAuth";

function readInviteCode(): string {
  const m = window.location.search.match(/[?&]code=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function SignupPage() {
  const signup = useSignup();
  const [code] = useState(readInviteCode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const errMsg = signup.error instanceof Error ? signup.error.message : null;

  if (!code) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Need an invite link</h1>
          <p>
            Ask the person who already uses babyone to send you a fresh invite
            link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Create your account</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            signup.mutate({ code, email, password, displayName });
          }}
        >
          <label>
            Display name
            <input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password (8+ chars)
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {errMsg && <div className="auth-error">{errMsg}</div>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={signup.isPending}
          >
            {signup.isPending ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
