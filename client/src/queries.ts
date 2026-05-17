import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { ChatMessage, RoutineRecord } from "./types";

export const recordsKey = ["records"] as const;
export const messagesKey = ["messages"] as const;
export const babyKey = ["baby"] as const;

const sortRecords = (rs: RoutineRecord[]) =>
  [...rs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export function useRecords() {
  return useQuery({
    queryKey: recordsKey,
    queryFn: api.listRecords,
    select: sortRecords,
  });
}

export function useMessages() {
  return useQuery({ queryKey: messagesKey, queryFn: api.listMessages });
}

export function useBaby() {
  return useQuery({ queryKey: babyKey, queryFn: api.baby });
}

export function useUpdateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateRecord,
    onSuccess: (saved) => {
      qc.setQueryData<RoutineRecord[]>(recordsKey, (rs) =>
        (rs ?? []).map((r) => (r.id === saved.id ? saved : r)),
      );
    },
  });
}

export function useDeleteRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteRecord,
    onSuccess: (_res, id) => {
      qc.setQueryData<RoutineRecord[]>(recordsKey, (rs) =>
        (rs ?? []).filter((r) => r.id !== id),
      );
    },
  });
}

export function useBrief() {
  // Date in the key so it re-fires once the calendar day rolls over.
  return useQuery({
    queryKey: ["brief", new Date().toLocaleDateString("en-CA")],
    queryFn: api.brief,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.chat,
    onSuccess: (res) => {
      qc.setQueryData<ChatMessage[]>(messagesKey, (ms) => [
        ...(ms ?? []),
        res.userMsg,
        res.botMsg,
      ]);
      qc.invalidateQueries({ queryKey: recordsKey });
    },
  });
}
