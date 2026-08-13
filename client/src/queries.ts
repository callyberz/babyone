import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Baby,
  ChatMessage,
  RoutineRecord,
  RoutineRecordDraft,
} from "@babyone/contracts";
import { useMe } from "./auth/useAuth";

export const recordsKey = ["records"] as const;
export const messagesKey = ["messages"] as const;
export const babyKey = ["baby"] as const;

const sortRecords = (rs: RoutineRecord[]) =>
  [...rs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export function useRecords() {
  const me = useMe();
  return useQuery({
    queryKey: recordsKey,
    queryFn: api.listRecords,
    select: sortRecords,
    enabled: !!me.data,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useMessages() {
  const me = useMe();
  return useQuery({
    queryKey: messagesKey,
    queryFn: api.listMessages,
    enabled: !!me.data,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useUpdateBaby() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateBaby,
    onSuccess: (baby: Baby) => qc.setQueryData(babyKey, baby),
  });
}

export function useCreateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (record: RoutineRecordDraft) => api.createRecord(record),
    onSuccess: (created) => {
      qc.setQueryData<RoutineRecord[]>(recordsKey, (records) =>
        sortRecords([
          created,
          ...(records ?? []).filter((record) => record.id !== created.id),
        ]),
      );
    },
  });
}

export function useBaby() {
  const me = useMe();
  return useQuery({
    queryKey: babyKey,
    queryFn: api.baby,
    enabled: !!me.data,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
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

export function useBulkDeleteRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.bulkDeleteRecords,
    onSuccess: (res) => {
      const deleted = new Set(res.deleted);
      qc.setQueryData<RoutineRecord[]>(recordsKey, (rs) =>
        (rs ?? []).filter((r) => !deleted.has(r.id)),
      );
    },
  });
}

export function useBrief() {
  const me = useMe();
  // Date in the key so it re-fires once the calendar day rolls over.
  return useQuery({
    queryKey: ["brief", new Date().toLocaleDateString("en-CA")],
    queryFn: api.brief,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!me.data,
  });
}

export function useChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.chat,
    onSuccess: (res) => {
      qc.setQueryData<ChatMessage[]>(messagesKey, (ms) => {
        const incoming = [res.userMsg, res.botMsg];
        const incomingIds = new Set(incoming.map((message) => message.id));
        return [
          ...(ms ?? []).filter((message) => !incomingIds.has(message.id)),
          ...incoming,
        ];
      });
      qc.invalidateQueries({ queryKey: recordsKey });
    },
  });
}
