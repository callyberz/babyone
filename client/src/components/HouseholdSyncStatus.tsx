import { useEffect, useRef, useState } from "react";

interface HouseholdSyncStatusProps {
  hasSynced: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  updatedAt: number;
  onRetry: () => Promise<unknown> | unknown;
}

const onlineNow = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unable to reach the household server";
};

const updatedTime = (updatedAt: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(updatedAt);

export function HouseholdSyncStatus({
  hasSynced,
  isFetching,
  isError,
  error,
  updatedAt,
  onRetry,
}: HouseholdSyncStatusProps) {
  const [isOnline, setIsOnline] = useState(onlineNow);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showRecovered, setShowRecovered] = useState(false);
  const issueUpdatedAt = useRef<number | null>(null);
  const wasOffline = useRef(!isOnline);

  const retry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } catch {
      // The query owns and exposes the error state; keep this event handler
      // from creating an unhandled rejection for alternate retry functions.
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      void retry();
    }
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline || isError) {
      issueUpdatedAt.current ??= updatedAt;
      setShowRecovered(false);
      return;
    }
    if (
      issueUpdatedAt.current !== null &&
      hasSynced &&
      updatedAt > issueUpdatedAt.current &&
      !isFetching
    ) {
      issueUpdatedAt.current = null;
      setShowRecovered(true);
    }
  }, [hasSynced, isError, isFetching, isOnline, updatedAt]);

  useEffect(() => {
    if (!showRecovered) return;
    const timeout = window.setTimeout(() => setShowRecovered(false), 5_000);
    return () => window.clearTimeout(timeout);
  }, [showRecovered]);

  if (!isOnline) {
    return (
      <div className="sync-status sync-status-warn" role="alert">
        <span className="sync-status-dot" aria-hidden="true" />
        {hasSynced
          ? "Offline · Showing saved household data"
          : "Offline · Waiting to sync household data"}
      </div>
    );
  }

  if (!hasSynced && isFetching && !isError) {
    return (
      <div className="sync-status" role="status">
        <span className="sync-status-dot is-active" aria-hidden="true" />
        Syncing household data…
      </div>
    );
  }

  if (isRetrying || (isError && isFetching)) {
    return (
      <div className="sync-status" role="status">
        <span className="sync-status-dot is-active" aria-hidden="true" />
        Retrying household sync…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="sync-status-row">
        <div className="sync-status sync-status-warn" role="alert">
          <span className="sync-status-dot" aria-hidden="true" />
          Sync paused · {errorMessage(error)}
        </div>
        <button className="sync-status-retry" type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  if (showRecovered) {
    return (
      <div className="sync-status sync-status-ok" role="status">
        <span className="sync-status-dot" aria-hidden="true" />
        Household sync recovered · Updated just now
      </div>
    );
  }

  if (hasSynced && updatedAt > 0) {
    const dateTime = new Date(updatedAt).toISOString();
    return (
      <div className="sync-status sync-status-ok">
        <span className="sync-status-dot" aria-hidden="true" />
        Household synced ·{" "}
        <time dateTime={dateTime}>Updated {updatedTime(updatedAt)}</time>
      </div>
    );
  }

  return null;
}
