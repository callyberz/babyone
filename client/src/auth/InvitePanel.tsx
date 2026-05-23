import { useState } from "react";
import { useCreateInvite } from "./useAuth";

export function InvitePanel() {
  const create = useCreateInvite();
  const [copied, setCopied] = useState(false);
  const url = create.data?.url;

  return (
    <div className="invite-panel">
      <button
        className="btn"
        onClick={() => {
          setCopied(false);
          create.mutate();
        }}
        disabled={create.isPending}
      >
        {create.isPending ? "Generating…" : "Invite caregiver"}
      </button>
      {url && (
        <div className="invite-result">
          <code>{url}</code>
          <button
            className="btn btn-small"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <div className="invite-hint">Expires in 24h</div>
        </div>
      )}
      {create.error && (
        <div className="auth-error">{(create.error as Error).message}</div>
      )}
    </div>
  );
}
