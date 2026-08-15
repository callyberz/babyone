/** Generate an opaque identifier suitable for durable API idempotency. */
export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const entropy = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${entropy}`;
}
