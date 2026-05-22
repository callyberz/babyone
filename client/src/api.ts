import type { Baby, ChatMessage, RoutineRecord, User } from "./types";

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

const json = async <T>(r: Response): Promise<T> => {
  if (r.status === 401) throw new UnauthenticatedError();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
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

export const api = {
  baby: () => req("/api/baby").then((r) => json<Baby>(r)),
  listRecords: () => req("/api/records").then((r) => json<RoutineRecord[]>(r)),
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
  listMessages: () => req("/api/messages").then((r) => json<ChatMessage[]>(r)),
  brief: () =>
    post("/api/brief/today", {
      localDate: new Date().toLocaleDateString("en-CA"),
      tzOffsetMin: new Date().getTimezoneOffset(),
    }).then((r) => json<{ message: ChatMessage | null }>(r)),
  chat: (text: string) =>
    post("/api/chat", { text }).then((r) =>
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
};
