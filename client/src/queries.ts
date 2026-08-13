import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import type {
  Baby,
  ChatMessage,
  HouseholdSync,
  RoutineRecord,
  RoutineRecordDraft,
} from "@babyone/contracts";
import { useMe } from "./auth/useAuth";

export const recordsKey = ["records"] as const;
export const messagesKey = ["messages"] as const;
export const babyKey = ["baby"] as const;
export const syncKey = ["household-sync"] as const;

const sortRecords = (rs: RoutineRecord[]) =>
  [...rs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export function useRecords() {
  return useQuery({
    queryKey: recordsKey,
    queryFn: api.listRecords,
    select: sortRecords,
    enabled: false,
  });
}

export function useMessages() {
  return useQuery({
    queryKey: messagesKey,
    queryFn: api.listMessages,
    enabled: false,
  });
}

const mergeById = <T extends { id: number }>(
  current: T[] | undefined,
  incoming: T[],
  deletedIds: number[],
): T[] => {
  const deleted = new Set(deletedIds);
  const byId = new Map(
    (current ?? [])
      .filter((item) => !deleted.has(item.id))
      .map((item) => [item.id, item]),
  );
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
};

export function applyHouseholdSync(
  qc: Pick<QueryClient, "setQueryData">,
  sync: HouseholdSync,
): void {
  qc.setQueryData<RoutineRecord[]>(recordsKey, (current) =>
    sortRecords(
      sync.full
        ? sync.records
        : mergeById(current, sync.records, sync.deletedRecordIds),
    ),
  );
  qc.setQueryData<ChatMessage[]>(messagesKey, (current) =>
    (sync.full
      ? sync.messages
      : mergeById(current, sync.messages, sync.deletedMessageIds)
    ).sort((a, b) =>
      a.at === b.at ? a.id - b.id : a.at.localeCompare(b.at),
    ),
  );
}

export function useHouseholdSync() {
  const me = useMe();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: syncKey,
    queryFn: () => {
      const previous = qc.getQueryData<HouseholdSync>(syncKey);
      return api.sync(previous?.cursor);
    },
    enabled: !!me.data,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (query.data) applyHouseholdSync(qc, query.data);
  }, [qc, query.data]);

  return query;
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
      qc.setQueryData<RoutineRecord[]>(recordsKey, (records) =>
        sortRecords(
          mergeById(
            records,
            [...res.created, ...res.updated],
            res.deleted,
          ),
        ),
      );
    },
  });
}
