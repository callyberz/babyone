import type {
  Baby,
  ChatMessage,
  HouseholdSync,
  RoutineRecord,
  RoutineRecordDraft,
  User,
} from "@babyone/contracts";

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

const json = async <T>(r: Response): Promise<T> => {
  if (r.status === 401) throw new UnauthenticatedError();
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as
      | { error?: string; issues?: string[] }
      | null;
    throw new Error(body?.issues?.join(". ") ?? body?.error ?? `${r.status} ${r.statusText}`);
  }
  return (await r.json()) as T;
};

const req = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(path, { credentials: "include", ...init });

const post = (path: string, body: unknown): Promise<Response> =>
  req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const exportFilename = (response: Response): string => {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  const plain = disposition.match(/filename=([^;]+)/i)?.[1];
  let decoded: string | undefined;
  if (encoded) {
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      decoded = undefined;
    }
  }
  const candidate =
    decoded ?? quoted ?? plain?.trim() ?? "babyone-household-export.json";
  return candidate.split(/[\\/]/).pop() || "babyone-household-export.json";
};

const downloadResponse = async (response: Response): Promise<void> => {
  if (response.status === 401) throw new UnauthenticatedError();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  const filename = exportFilename(response);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
};

export const api = {
  baby: () => req("/api/baby").then((r) => json<Baby>(r)),
  updateBaby: (baby: Baby) =>
    req("/api/baby", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baby),
    }).then((r) => json<Baby>(r)),
  listRecords: () => req("/api/records").then((r) => json<RoutineRecord[]>(r)),
  createRecord: (record: RoutineRecordDraft) =>
    post("/api/records", record).then((r) => json<RoutineRecord>(r)),
  updateRecord: (rec: RoutineRecord) =>
    req(`/api/records/${rec.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rec),
    }).then((r) => json<RoutineRecord>(r)),
  deleteRecord: (id: number) =>
    req(`/api/records/${id}`, { method: "DELETE" }).then((r) =>
      json<{ ok: boolean }>(r),
    ),
  bulkDeleteRecords: (ids: number[]) =>
    post("/api/records/bulk-delete", { ids }).then((r) =>
      json<{ deleted: number[] }>(r),
    ),
  listMessages: () => req("/api/messages").then((r) => json<ChatMessage[]>(r)),
  sync: (after?: number) =>
    req(after === undefined ? "/api/sync" : `/api/sync?after=${after}`).then(
      (r) => json<HouseholdSync>(r),
    ),
  brief: () =>
    post("/api/brief/today", {
      localDate: new Date().toLocaleDateString("en-CA"),
      tzOffsetMin: new Date().getTimezoneOffset(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).then((r) => json<{ message: ChatMessage | null }>(r)),
  chat: ({ text, requestId }: { text: string; requestId: string }) =>
    post("/api/chat", {
      text,
      requestId,
      tzOffsetMin: new Date().getTimezoneOffset(),
    }).then((r) =>
      json<{
        userMsg: ChatMessage;
        botMsg: ChatMessage;
        created: RoutineRecord[];
        updated: RoutineRecord[];
        deleted: number[];
      }>(r),
    ),

  // Auth
  me: () => req("/api/auth/me").then((r) => json<{ user: User }>(r)),
  login: (email: string, password: string) =>
    post("/api/auth/login", { email, password }).then((r) =>
      json<{ user: User }>(r),
    ),
  signup: (input: {
    code: string;
    email: string;
    password: string;
    displayName: string;
  }) => post("/api/auth/signup", input).then((r) => json<{ user: User }>(r)),
  logout: () =>
    post("/api/auth/logout", {}).then((r) => json<{ ok: boolean }>(r)),
  createInvite: () =>
    post("/api/invites", {}).then((r) =>
      json<{ code: string; expiresAt: string; url: string }>(r),
    ),
  downloadExport: () => req("/api/export").then(downloadResponse),
};
