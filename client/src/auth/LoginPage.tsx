import { useState } from "react";
import { useLogin } from "./useAuth";

export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const errMsg =
    login.error instanceof Error
      ? login.error.message === "401 Unauthorized"
        ? "Wrong email or password."
        : login.error.message
      : null;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Sign in</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate({ email, password });
          }}
        >
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
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {errMsg && <div className="auth-error">{errMsg}</div>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={login.isPending}
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
