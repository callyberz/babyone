import { useId, useState } from "react";
import {
  useCaregivers,
  useCreatePasswordReset,
} from "./useAuth";

export function CaregiverAccessPanel({
  currentUserId,
}: {
  currentUserId: number;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [resetLink, setResetLink] = useState<{
    userId: number;
    url: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const caregivers = useCaregivers(open);
  const createReset = useCreatePasswordReset();

  const generate = async (userId: number) => {
    setCopied(false);
    setResetLink(null);
    try {
      const result = await createReset.mutateAsync(userId);
      setResetLink({ userId, url: result.url });
    } catch {
      // The mutation's error is rendered below.
    }
  };

  return (
    <div className="caregiver-access">
      <button
        className="btn btn-small"
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        Manage caregiver access
      </button>
      {open && (
        <div id={listId} className="caregiver-access-list">
          {caregivers.isLoading && <div role="status">Loading caregivers…</div>}
          {caregivers.error && (
            <div className="auth-error" role="alert">
              {(caregivers.error as Error).message}
            </div>
          )}
          {caregivers.data?.map((caregiver) => (
            <div className="caregiver-access-row" key={caregiver.id}>
              <div>
                <strong>{caregiver.displayName}</strong>
                <span>{caregiver.email}</span>
              </div>
              <button
                className="btn btn-small"
                type="button"
                aria-label={`Create password reset link for ${caregiver.displayName}`}
                disabled={createReset.isPending}
                onClick={() => void generate(caregiver.id)}
              >
                {caregiver.id === currentUserId
                  ? "Create my reset link"
                  : "Create reset link"}
              </button>
              {resetLink?.userId === caregiver.id && (
                <div className="caregiver-reset-link">
                  <code>{resetLink.url}</code>
                  <button
                    className="btn btn-small"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(resetLink.url);
                      setCopied(true);
                    }}
                  >
                    {copied ? "Copied" : "Copy reset link"}
                  </button>
                  <span>This link expires in one hour and works once.</span>
                </div>
              )}
            </div>
          ))}
          {createReset.error && (
            <div className="auth-error" role="alert">
              {(createReset.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
