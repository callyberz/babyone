import type { Baby, ChatMessage, RoutineRecord } from "./types";

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
};

export const api = {
  baby: () => fetch("/api/baby").then((r) => json<Baby>(r)),
  updateBaby: (b: Baby) =>
    fetch("/api/baby", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => json<Baby>(r)),
  listRecords: () =>
    fetch("/api/records").then((r) => json<RoutineRecord[]>(r)),
  updateRecord: (rec: RoutineRecord) =>
    fetch(`/api/records/${rec.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rec),
    }).then((r) => json<RoutineRecord>(r)),
  deleteRecord: (id: number) =>
    fetch(`/api/records/${id}`, { method: "DELETE" }).then((r) =>
      json<{ ok: boolean }>(r),
    ),
  listMessages: () =>
    fetch("/api/messages").then((r) => json<ChatMessage[]>(r)),
  chat: (text: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) =>
      json<{
        userMsg: ChatMessage;
        botMsg: ChatMessage;
        created: RoutineRecord[];
        updated: RoutineRecord[];
        deleted: number[];
      }>(r),
    ),
};

export interface ChatResult {
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}
